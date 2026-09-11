'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function clientFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | body.length;
  } else if (body.length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  header[0] = 0x80 | (opcode & 0x0f);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(body.length);
  for (let index = 0; index < body.length; index += 1) masked[index] = body[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}

class RawWebSocket {
  constructor(socket, initialData = Buffer.alloc(0), { autoPong = true } = {}) {
    this.socket = socket;
    this.autoPong = autoPong;
    this.buffer = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.closeWaiters = [];
    this.socketCloseWaiters = [];
    this.closeInfo = null;
    this.socketClosed = false;
    this.error = null;

    socket.on('data', (chunk) => this.consume(chunk));
    socket.on('error', (error) => { this.error = error; });
    socket.on('close', () => {
      this.socketClosed = true;
      if (!this.closeInfo) this.closeInfo = { code: null, reason: '', hadFrame: false };
      this.resolveCloseWaiters();
      for (const resolve of this.socketCloseWaiters.splice(0)) resolve();
      this.rejectFrameWaiters(this.error || new Error('WebSocket closed'));
    });

    if (initialData.length) this.consume(initialData);
  }

  sendFrame(payload, opcode = 0x1) {
    if (this.socket.destroyed || this.socket.writableEnded) throw new Error('WebSocket is not writable');
    this.socket.write(clientFrame(payload, opcode));
  }

  sendJson(value) {
    this.sendFrame(JSON.stringify(value), 0x1);
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const longLength = this.buffer.readBigUInt64BE(2);
        if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Frame is too large');
        length = Number(longLength);
        offset = 10;
      }

      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskBytes;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }

      const frame = { fin, opcode, payload };
      if (opcode === 0x9 && this.autoPong && !this.socket.destroyed) this.sendFrame(payload, 0xA);
      if (opcode === 0x8) {
        this.closeInfo = {
          code: payload.length >= 2 ? payload.readUInt16BE(0) : null,
          reason: payload.length > 2 ? payload.subarray(2).toString('utf8') : '',
          hadFrame: true
        };
        this.resolveCloseWaiters();
      }
      this.dispatch(frame);
    }
  }

  dispatch(frame) {
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(frame));
    if (waiterIndex === -1) {
      this.frames.push(frame);
      return;
    }
    const [waiter] = this.waiters.splice(waiterIndex, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(frame);
  }

  nextFrame(predicate = () => true, timeoutMs = 1500) {
    const frameIndex = this.frames.findIndex(predicate);
    if (frameIndex !== -1) return Promise.resolve(this.frames.splice(frameIndex, 1)[0]);
    if (this.socketClosed) return Promise.reject(this.error || new Error('WebSocket closed'));

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for a WebSocket frame after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async nextJson(predicate = () => true, timeoutMs = 1500) {
    const frame = await this.nextFrame((candidate) => {
      if (candidate.opcode !== 0x1) return false;
      if (!Object.hasOwn(candidate, 'json')) {
        try { candidate.json = JSON.parse(candidate.payload.toString('utf8')); }
        catch { candidate.json = undefined; }
      }
      return candidate.json !== undefined && predicate(candidate.json);
    }, timeoutMs);
    return frame.json;
  }

  waitForClose(timeoutMs = 1500) {
    if (this.closeInfo) return Promise.resolve(this.closeInfo);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.closeWaiters.indexOf(waiter);
        if (index !== -1) this.closeWaiters.splice(index, 1);
        reject(new Error(`Timed out waiting for WebSocket close after ${timeoutMs}ms`));
      }, timeoutMs);
      this.closeWaiters.push(waiter);
    });
  }

  resolveCloseWaiters() {
    if (!this.closeInfo) return;
    for (const waiter of this.closeWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve(this.closeInfo);
    }
  }

  rejectFrameWaiters(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  waitForSocketClose() {
    if (this.socketClosed) return Promise.resolve();
    return new Promise((resolve) => this.socketCloseWaiters.push(resolve));
  }

  async close(code = 1000, reason = '') {
    if (this.socketClosed) return;
    const reasonBytes = Buffer.from(reason).subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    if (!this.socket.destroyed && !this.socket.writableEnded) this.sendFrame(payload, 0x8);
    try { await this.waitForClose(500); } catch {}
    if (!this.socket.destroyed) this.socket.destroy();
    await this.waitForSocketClose();
  }

  async destroy() {
    if (!this.socket.destroyed) this.socket.destroy();
    await this.waitForSocketClose();
  }
}

function openWebSocket({
  host = '127.0.0.1',
  port,
  path = '/ws',
  origin,
  headers = {},
  autoPong = true,
  timeoutMs = 1500
}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    let response = Buffer.alloc(0);
    let settled = false;

    const timer = setTimeout(() => finish(new Error(`Timed out opening WebSocket after ${timeoutMs}ms`)), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onPrematureClose);
    };
    const finish = (error, client) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        if (!socket.destroyed) socket.destroy();
        reject(error);
      } else {
        resolve(client);
      }
    };
    const onError = (error) => finish(error);
    const onPrematureClose = () => finish(new Error('Socket closed before the WebSocket handshake completed'));
    const onData = (chunk) => {
      response = Buffer.concat([response, chunk]);
      const boundary = response.indexOf('\r\n\r\n');
      if (boundary === -1) return;
      socket.pause();
      const head = response.subarray(0, boundary).toString('latin1');
      const remaining = response.subarray(boundary + 4);
      const lines = head.split('\r\n');
      const statusCode = Number(/^HTTP\/1\.1 (\d{3})/.exec(lines[0])?.[1]);
      const responseHeaders = Object.create(null);
      for (const line of lines.slice(1)) {
        const separator = line.indexOf(':');
        if (separator !== -1) responseHeaders[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
      }
      if (statusCode !== 101) {
        const error = new Error(`WebSocket upgrade rejected with HTTP ${statusCode || 'unknown'}`);
        error.statusCode = statusCode;
        error.responseHeaders = responseHeaders;
        finish(error);
        return;
      }
      if (responseHeaders['sec-websocket-accept'] !== expectedAccept) {
        finish(new Error('WebSocket handshake returned an invalid accept key'));
        return;
      }
      cleanup();
      settled = true;
      const client = new RawWebSocket(socket, remaining, { autoPong });
      socket.resume();
      resolve(client);
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onPrematureClose);
    socket.once('connect', () => {
      const requestHeaders = {
        Host: `${host}:${port}`,
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        ...headers
      };
      if (origin !== undefined) requestHeaders.Origin = origin;
      const lines = [`GET ${path} HTTP/1.1`];
      for (const [name, value] of Object.entries(requestHeaders)) lines.push(`${name}: ${value}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
  });
}

module.exports = { RawWebSocket, clientFrame, openWebSocket };
