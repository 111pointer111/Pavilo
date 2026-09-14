'use strict';

function createFrameProtocol(limits, { sendFrame, closeClient, sendError, onCommand }) {
  const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

  function processText(client, payload) {
    if (payload.length > limits.maxJsonBytes) return closeClient(client, 1009, 'payload too large');
    let text;
    try { text = TEXT_DECODER.decode(payload); }
    catch {
      closeClient(client, 1007, 'invalid utf-8');
      return;
    }
    let command;
    try { command = JSON.parse(text); }
    catch {
      sendError(client, 'BAD_JSON', '请求格式不正确。');
      return;
    }
    onCommand(client, command);
  }

  function consumeFrames(client, chunk) {
    if (client.closing) return;
    client.buffer = Buffer.concat([client.buffer, chunk]);
    let frames = 0;
    while (client.buffer.length >= 2 && !client.socket.destroyed && !client.closing) {
      if (++frames > 128) {
        closeClient(client, 1008, 'too many frames');
        return;
      }
      const first = client.buffer[0];
      const second = client.buffer[1];
      const fin = Boolean(first & 0x80);
      const rsv = first & 0x70;
      const opcode = first & 0x0f;
      const control = opcode >= 0x8;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (rsv || !masked || (control && (!fin || length > 125))) {
        closeClient(client, 1002, 'protocol error');
        return;
      }
      if (length === 126) {
        if (client.buffer.length < 4) return;
        length = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (client.buffer.length < 10) return;
        const longLength = client.buffer.readBigUInt64BE(2);
        if (longLength > BigInt(limits.maxWsFrameBytes)) {
          closeClient(client, 1009, 'payload too large');
          return;
        }
        length = Number(longLength);
        offset = 10;
      }
      if (control && length > 125) {
        closeClient(client, 1002, 'control frame too large');
        return;
      }
      if (length > limits.maxWsFrameBytes) {
        closeClient(client, 1009, 'payload too large');
        return;
      }
      if (client.buffer.length < offset + 4 + length) return;
      const mask = client.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
      client.buffer = client.buffer.subarray(offset + length);
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];

      if (opcode === 0x9) {
        sendFrame(client.socket, payload, 0xA);
        continue;
      }
      if (opcode === 0xA) {
        client.lastPong = Date.now();
        client.pingSentAt = 0;
        client.awaitingPong = false;
        continue;
      }
      if (opcode === 0x8) {
        closeClient(client, 1000, 'bye');
        return;
      }
      if (opcode === 0x2) {
        closeClient(client, 1003, 'text only');
        return;
      }
      if (opcode === 0x0) {
        if (!client.fragmented) {
          closeClient(client, 1002, 'unexpected continuation');
          return;
        }
        client.fragments.push(payload);
        client.fragmentBytes += payload.length;
        if (client.fragmentBytes > limits.maxJsonBytes) {
          closeClient(client, 1009, 'payload too large');
          return;
        }
        if (fin) {
          const complete = Buffer.concat(client.fragments);
          client.fragmented = false;
          client.fragments = [];
          client.fragmentBytes = 0;
          processText(client, complete);
        }
        continue;
      }
      if (opcode !== 0x1 || client.fragmented) {
        closeClient(client, 1002, 'unsupported opcode');
        return;
      }
      if (fin) processText(client, payload);
      else {
        client.fragmented = true;
        client.fragments = [payload];
        client.fragmentBytes = payload.length;
      }
    }
  }


  return { consumeFrames };
}
module.exports = { createFrameProtocol };
