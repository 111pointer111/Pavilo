'use strict';

const crypto = require('node:crypto');
const { createFrameProtocol } = require('./protocol');
const { localAddresses } = require('./http');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function getAddress(socket) {
  const address = socket.remoteAddress || 'unknown';
  if (address === '::1') return '127.0.0.1';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}
function createWebSocketTransport(server, config, core) {
  const clients = new Set();
  const connections = new Map();
  let peerSequence = 0;
  const roomEpoch = core.roomEpoch;
  let shuttingDown = false;
  let lifecycle = 'created';
  let heartbeat;
  let pendingStartup = null;
  function serialize(payload) {
    return Buffer.from(JSON.stringify(payload));
  }

  function sendFrame(socket, payload, opcode) {
    if (socket.destroyed || socket.writableEnded) return false;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let header;
    if (data.length < 126) {
      header = Buffer.alloc(2);
      header[1] = data.length;
    } else if (data.length < 65_536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    header[0] = 0x80 | (opcode & 0x0f);
    if (socket.writableLength + header.length + data.length > config.maxWritableBytes) {
      socket.destroy();
      return false;
    }
    return socket.write(Buffer.concat([header, data]));
  }

  function sendJson(client, payload) {
    if (!client || client.closing || client.socket.destroyed || client.socket.writableEnded) return false;
    const body = serialize(payload);
    if (body.length > config.maxJsonBytes) {
      const fallback = serialize({ type: 'error', code: 'PAYLOAD_TOO_LARGE', message: '内容太大，图片请压缩后再发送。' });
      if (fallback.length > config.maxJsonBytes) {
        closeClient(client, 1009, 'payload too large');
        return false;
      }
      return sendFrame(client.socket, fallback, 0x1);
    }
    return sendFrame(client.socket, body, 0x1);
  }

  function flushSyncQueue(client) {
    if (client.closing) return;
    const writeNext = () => {
      if (client.closing) return;
      const body = client.syncQueue.shift();
      if (!body) {
        client.syncQueueBytes = 0;
        if (client.syncTimer) clearTimeout(client.syncTimer);
        client.syncTimer = null;
        client.syncing = false;
        core.completeSync(client.id);
        return;
      }
      client.syncQueueBytes = Math.max(0, client.syncQueueBytes - body.length - 14);
      const canContinue = sendFrame(client.socket, body, 0x1);
      if (client.closing || client.socket.destroyed) return;
      if (canContinue) setImmediate(writeNext);
      else client.socket.once('drain', () => {
        refreshSyncTimeout(client);
        writeNext();
      });
    };
    writeNext();
  }

  function queueSyncEvent(client, body) {
    const overhead = body.length + 14;
    if (client.syncQueueBytes + overhead + client.socket.writableLength > config.maxWritableBytes) {
      closeClient(client, 1008, 'sync overflow');
      return;
    }
    client.syncQueueBytes += overhead;
    client.syncQueue.push(body);
  }

  function closeClient(client, code = 1000, reason = '') {
    if (!client || client.closing || client.socket.destroyed) return;
    client.closing = true;
    core.markClosing(client.id);
    if (client.syncTimer) clearTimeout(client.syncTimer);
    const reasonBuffer = Buffer.from(reason).subarray(0, 120);
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    sendFrame(client.socket, payload, 0x8);
    client.socket.end();
    if (!client.destroyTimer) {
      client.destroyTimer = setTimeout(() => {
        if (!client.socket.destroyed) client.socket.destroy();
      }, 1000);
      client.destroyTimer.unref?.();
    }
  }

  function refreshSyncTimeout(client) {
    if (client.syncTimer) clearTimeout(client.syncTimer);
    client.syncTimer = setTimeout(() => closeClient(client, 1008, 'sync timeout'), config.joinTimeoutMs);
    client.syncTimer.unref?.();
  }

  function queueInitialPayloads(client, payloads, index = 0) {
    if (client.closing) return;
    if (index >= payloads.length) {
      flushSyncQueue(client);
      return;
    }
    const canContinue = sendJson(client, payloads[index]);
    if (client.closing) return;
    refreshSyncTimeout(client);
    if (canContinue) {
      setImmediate(() => queueInitialPayloads(client, payloads, index + 1));
    } else {
      client.socket.once('drain', () => {
        refreshSyncTimeout(client);
        queueInitialPayloads(client, payloads, index + 1);
      });
    }
  }


  function sendError(client, code, message) { sendJson(client, { type: 'error', code, message }); }
  function deliver(effects) {
    for (const effect of effects) {
      if (effect.kind === 'broadcast') {
        const body = serialize(effect.payload);
        for (const peerId of effect.peerIds) {
          const client = connections.get(peerId);
          if (client && !client.closing) {
            if (client.syncing) queueSyncEvent(client, body);
            else sendFrame(client.socket, body, 0x1);
          }
        }
        continue;
      }
      const client = connections.get(effect.peerId);
      if (!client) continue;
      if (effect.kind === 'send') {
        // Errors (especially SYNC_IN_PROGRESS) must bypass the sync queue
        // so the client knows why its command was rejected
        const isError = effect.payload && effect.payload.type === 'error';
        if (isError || !client.syncing) sendJson(client, effect.payload);
        else queueSyncEvent(client, serialize(effect.payload));
      } else if (effect.kind === 'close') closeClient(client, effect.code, effect.reason);
      else if (effect.kind === 'initial') {
        client.syncing = true;
        client.syncQueue.length = 0;
        client.syncQueueBytes = 0;
        refreshSyncTimeout(client);
        if (effect.legacy) { sendJson(client, effect.payloads[0]); flushSyncQueue(client); }
        else queueInitialPayloads(client, effect.payloads);
      }
    }
  }
  const { consumeFrames } = createFrameProtocol(config, { sendFrame, closeClient, sendError,
    onCommand: (client, command) => deliver(core.dispatch(client.id, command).effects) });
  function removeClient(client) {
    if (!client || client.removed) return;
    client.removed = true;
    clients.delete(client);
    connections.delete(client.id);
    if (client.syncTimer) clearTimeout(client.syncTimer);
    if (client.destroyTimer) clearTimeout(client.destroyTimer);
    client.syncQueue.length = 0;
    client.syncQueueBytes = 0;
    deliver(core.disconnect(client.id));
  }
  function validOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return config.allowNoOrigin;
    if (Array.isArray(config.allowedOrigins) && config.allowedOrigins.includes(origin)) return true;
    let parsed;
    try { parsed = new URL(origin); } catch { return false; }
    const host = request.headers.host;
    return Boolean(host) && parsed.host === host && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  }

  function rejectUpgrade(socket, status = '400 Bad Request') {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  server.on('upgrade', (request, socket, head) => {
    let requestUrl;
    try { requestUrl = new URL(request.url, `http://${request.headers.host || 'invalid'}`); }
    catch { rejectUpgrade(socket); return; }
    const key = request.headers['sec-websocket-key'];
    const version = request.headers['sec-websocket-version'];
    const upgrade = String(request.headers.upgrade || '').toLowerCase();
    const connectionTokens = String(request.headers.connection || '').toLowerCase().split(',').map((item) => item.trim());
    const validKey = typeof key === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(key);
    if (shuttingDown || requestUrl.pathname !== '/ws' || !validKey || version !== '13' || upgrade !== 'websocket' || !connectionTokens.includes('upgrade') || !validOrigin(request)) {
      rejectUpgrade(socket, shuttingDown ? '503 Service Unavailable' : '403 Forbidden');
      return;
    }
    const ip = getAddress(socket);
    const perIp = [...clients].filter((client) => client.ip === ip).length;
    if (clients.size >= config.maxClients || perIp >= config.maxClientsPerIp) {
      rejectUpgrade(socket, '503 Service Unavailable');
      return;
    }
    const accept = crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ].join('\r\n'));
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    const client = {
      id: `peer-${++peerSequence}`,
      socket,
      ip,
      closing: false,
      removed: false,
      buffer: Buffer.alloc(0),
      fragments: [],
      fragmented: false,
      fragmentBytes: 0,
      lastPong: Date.now(),
      pingSentAt: 0,
      awaitingPong: false,
      syncing: false,
      syncQueue: [],
      syncQueueBytes: 0,
      syncTimer: null,
      destroyTimer: null
    };
    core.connect(client.id, ip);
    clients.add(client);
    connections.set(client.id, client);
    socket.on('data', (chunk) => consumeFrames(client, chunk));
    socket.on('error', () => removeClient(client));
    socket.on('end', () => { removeClient(client); socket.destroy(); });
    socket.on('close', () => removeClient(client));
    if (head?.length) consumeFrames(client, head);
  });

  server.on('clientError', (_error, socket) => {
    if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  function startHeartbeat() {
    heartbeat = setInterval(() => {
      const now = Date.now();
      core.pruneDedupe();
      for (const client of clients) {
        if (client.socket.destroyed) {
          removeClient(client);
          continue;
        }
        if (client.awaitingPong && now - client.pingSentAt > config.heartbeatTimeoutMs) {
          closeClient(client, 1001, 'heartbeat timeout');
          continue;
        }
        if (!client.awaitingPong) {
          client.awaitingPong = true;
          client.pingSentAt = now;
          sendFrame(client.socket, Buffer.alloc(0), 0x9);
        }
      }
    }, config.heartbeatIntervalMs);
    heartbeat.unref?.();
  }

  function listen(port = config.port, host = config.host) {
    if (lifecycle !== 'created') return Promise.reject(new Error(`server cannot listen while ${lifecycle}`));
    lifecycle = 'starting';
    const startup = new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        pendingStartup = null;
        callback(value);
      };
      const onError = (error) => {
        server.off('listening', onListening);
        if (!shuttingDown) lifecycle = 'created';
        settle(reject, error);
      };
      const onListening = () => {
        server.off('error', onError);
        lifecycle = 'listening';
        if (shuttingDown) {
          server.close(() => {});
        } else {
          startHeartbeat();
        }
        settle(resolve, server.address());
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    pendingStartup = startup;
    startup.finally(() => {
      if (pendingStartup === startup) pendingStartup = null;
    }).catch(() => {});
    return startup;
  }

  async function stop(signal) {
    if (lifecycle === 'stopped' || lifecycle === 'stopping') return;
    const wasStarting = lifecycle === 'starting';
    shuttingDown = true;
    lifecycle = 'stopping';
    if (wasStarting && pendingStartup) {
      try {
        await Promise.race([
          pendingStartup,
          new Promise((resolve) => setTimeout(resolve, 1500).unref())
        ]);
      } catch { /* startup failed; continue cleanup */ }
    }
    if (pendingStartup) pendingStartup = null;
    if (heartbeat) clearInterval(heartbeat);
    deliver(core.shutdown());
    await new Promise((resolve) => {
      if (!server.listening) { resolve(); return; }
      server.close(resolve);
      setTimeout(resolve, 1500).unref();
    });
    for (const client of clients) {
      client.socket.destroy();
      removeClient(client);
    }
    clients.clear();
    connections.clear();
    lifecycle = 'stopped';
    if (signal) process.stdout.write(`\n${signal}: 语亭房间已清空，服务已停止。\n`);
  }

  return {
    server,
    deliver,
    listen,
    stop,
    roomEpoch,
    localAddresses,
    config,
    state: core.state
  };
}

module.exports = { createWebSocketTransport };
