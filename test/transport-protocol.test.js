'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFrameProtocol } = require('../src/transport/protocol');

function frame(data, { opcode = 1, fin = true, masked = true, rsv = 0 } = {}) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const extended = payload.length >= 126;
  const header = Buffer.alloc(extended ? 4 : 2);
  header[0] = (fin ? 0x80 : 0) | rsv | opcode;
  header[1] = (masked ? 0x80 : 0) | (extended ? 126 : payload.length);
  if (extended) header.writeUInt16BE(payload.length, 2);
  if (!masked) return Buffer.concat([header, payload]);
  const mask = Buffer.from([1, 2, 3, 4]);
  return Buffer.concat([header, mask, Buffer.from(payload.map((value, index) => value ^ mask[index % 4]))]);
}

function fixture(limits = {}) {
  const output = { commands: [], closes: [], errors: [], frames: [] };
  const client = { socket: { destroyed: false }, closing: false, buffer: Buffer.alloc(0),
    fragments: [], fragmented: false, fragmentBytes: 0, awaitingPong: true, pingSentAt: 1 };
  const protocol = createFrameProtocol({ maxJsonBytes: 1024, maxWsFrameBytes: 2048, ...limits }, {
    onCommand: (_peer, command) => output.commands.push(command),
    closeClient: (peer, code, reason) => { peer.closing = true; output.closes.push({ code, reason }); },
    sendError: (_peer, code, message) => output.errors.push({ code, message }),
    sendFrame: (_socket, payload, opcode) => output.frames.push({ payload, opcode })
  });
  return { client, output, consume: (chunk) => protocol.consumeFrames(client, chunk) };
}

test('frame parser assembles split TCP reads without requiring HTTP or a socket', () => {
  const { consume, output } = fixture();
  const command = { type: 'message', text: '中文'.repeat(60) };
  for (const byte of frame(JSON.stringify(command))) consume(Buffer.from([byte]));
  assert.deepEqual(output.commands, [command]);
  assert.deepEqual(output.closes, []);
});

test('fragmented text permits interleaved ping and updates pong state', () => {
  const { client, consume, output } = fixture();
  consume(frame('{"type":', { fin: false }));
  consume(frame('ping-body', { opcode: 9 }));
  consume(frame('"typing","active":true}', { opcode: 0 }));
  consume(frame('', { opcode: 10 }));
  assert.deepEqual(output.commands, [{ type: 'typing', active: true }]);
  assert.deepEqual(output.frames, [{ payload: Buffer.from('ping-body'), opcode: 10 }]);
  assert.equal(client.fragmented, false);
  assert.equal(client.awaitingPong, false);
  assert.equal(client.pingSentAt, 0);
});

test('invalid UTF-8 and malformed JSON preserve distinct error paths', () => {
  const utf8 = fixture();
  utf8.consume(frame(Buffer.from([0xff])));
  assert.deepEqual(utf8.output.closes, [{ code: 1007, reason: 'invalid utf-8' }]);
  const json = fixture();
  json.consume(frame('{'));
  json.consume(frame('{"type":"leave"}'));
  assert.equal(json.output.errors[0].code, 'BAD_JSON');
  assert.deepEqual(json.output.commands, [{ type: 'leave' }]);
});

for (const [name, bytes, code] of [
  ['unmasked', frame('{}', { masked: false }), 1002],
  ['RSV', frame('{}', { rsv: 0x40 }), 1002],
  ['fragmented control', frame('x', { opcode: 9, fin: false }), 1002],
  ['oversized control', frame('x'.repeat(126), { opcode: 9 }), 1002],
  ['unexpected continuation', frame('{}', { opcode: 0 }), 1002],
  ['binary', frame('x', { opcode: 2 }), 1003],
  ['reserved opcode', frame('{}', { opcode: 3 }), 1002],
  ['close', frame('', { opcode: 8 }), 1000],
]) {
  test(`frame parser closes ${name} frames with the baseline code`, () => {
    const { consume, output } = fixture();
    consume(bytes);
    assert.equal(output.closes[0].code, code);
    assert.deepEqual(output.commands, []);
  });
}

test('frame and accumulated message budgets are enforced before dispatch', () => {
  const oversized = fixture({ maxWsFrameBytes: 32 });
  oversized.consume(frame('x'.repeat(33)));
  assert.equal(oversized.output.closes[0].code, 1009);
  const fragments = fixture({ maxJsonBytes: 10 });
  fragments.consume(frame('123456', { fin: false }));
  fragments.consume(frame('123456', { opcode: 0 }));
  assert.equal(fragments.output.closes[0].code, 1009);
  assert.deepEqual(fragments.output.commands, []);
  const longHeader = fixture();
  const bytes = Buffer.alloc(10);
  bytes[0] = 0x81;
  bytes[1] = 0xff;
  bytes.writeBigUInt64BE(2049n, 2);
  longHeader.consume(bytes);
  assert.equal(longHeader.output.closes[0].code, 1009);
});
