'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: immediate } = require('node:timers/promises');
const { test } = require('node:test');
const { DEFAULTS } = require('../config');
const { createWebSocketTransport } = require('../src/transport/websocket');

function fixture(t, overrides = {}) {
  const server = new EventEmitter();
  server.listening = false;
  const seen = { connects: [], complete: [], closes: [], disconnected: [] };
  const core = {
    roomEpoch: 'room-test',
    connect: (id, ip) => seen.connects.push({ id, ip }),
    completeSync: (id) => seen.complete.push(id),
    markClosing: (id) => seen.closes.push(id),
    disconnect: (id) => { seen.disconnected.push(id); return []; },
    dispatch: () => ({ effects: [] }),
    shutdown: () => [], pruneDedupe() {}, state: () => ({})
  };
  const transport = createWebSocketTransport(server, { ...DEFAULTS, ...overrides }, core);
  const socket = new EventEmitter();
  Object.assign(socket, { remoteAddress: '::ffff:127.0.0.1', writableLength: 0, destroyed: false,
    writableEnded: false, backpressure: false, writes: [], setNoDelay() {}, setKeepAlive() {},
    write(data) { this.writes.push(data); return !this.backpressure; },
    end() { this.writableEnded = true; },
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('close'); }
  });
  server.emit('upgrade', { url: '/ws', headers: { host: 'localhost', origin: 'http://localhost',
    'sec-websocket-key': 'AAAAAAAAAAAAAAAAAAAAAA==', 'sec-websocket-version': '13',
    upgrade: 'websocket', connection: 'Upgrade' } }, socket, Buffer.alloc(0));
  t.after(() => transport.stop());
  const id = seen.connects[0].id;
  function payloads() {
    return socket.writes.filter(Buffer.isBuffer).filter((data) => (data[0] & 0x0f) === 1).map((data) => {
      const length = data[1] & 0x7f;
      return JSON.parse(data.subarray(length < 126 ? 2 : length === 126 ? 4 : 10).toString());
    });
  }
  return { transport, socket, seen, id, payloads };
}

test('transport pauses on write(false), then drains snapshot and live events in order', async (t) => {
  const { transport, socket, seen, id, payloads } = fixture(t);
  const snapshot = [{ type: 'stateStart' }, { type: 'history', messages: [] }, { type: 'historyEnd' }];
  socket.backpressure = true;
  transport.deliver([{ kind: 'initial', peerId: id, payloads: snapshot }]);
  transport.deliver([{ kind: 'broadcast', peerIds: [id], channelId: 'general', payload: { type: 'message', message: { id: 'live' } } }]);
  await immediate();
  assert.deepEqual(payloads(), [snapshot[0]], 'write(false) is queued once, not retried');
  assert.deepEqual(seen.complete, [], 'snapshot cannot finish before drain');
  socket.backpressure = false;
  socket.emit('drain');
  for (let turn = 0; turn < 8 && !seen.complete.length; turn += 1) await immediate();
  assert.deepEqual(payloads().map((payload) => payload.type), ['stateStart', 'history', 'historyEnd', 'message']);
  assert.deepEqual(seen.complete, [id]);
  transport.deliver([{ kind: 'broadcast', peerIds: [id], payload: { type: 'typing', active: true } }]);
  assert.equal(payloads().at(-1).type, 'typing');
});

test('sync queue budget closes the slow connection without reporting completed sync', async (t) => {
  const { transport, socket, seen, id } = fixture(t, { maxWritableBytes: 150 });
  socket.backpressure = true;
  transport.deliver([{ kind: 'initial', peerId: id, payloads: [{ type: 'stateStart' }] }]);
  transport.deliver([{ kind: 'broadcast', peerIds: [id], payload: { type: 'message', text: 'x'.repeat(200) } }]);
  assert.equal(socket.writableEnded, true);
  assert.deepEqual(seen.closes, [id]);
  const close = socket.writes.find((data) => Buffer.isBuffer(data) && (data[0] & 0x0f) === 8);
  assert.equal(close.readUInt16BE(2), 1008);
  assert.equal(close.subarray(4).toString(), 'sync overflow');
  socket.emit('drain');
  await immediate();
  assert.deepEqual(seen.complete, []);
});

test('hard writable budget destroys only that socket and disconnects its logical peer', (t) => {
  const { transport, socket, seen, id } = fixture(t, { maxWritableBytes: 80 });
  transport.deliver([{ kind: 'send', peerId: id, payload: { type: 'message', text: 'x'.repeat(100) } }]);
  assert.equal(socket.destroyed, true);
  assert.deepEqual(seen.disconnected, [id]);
  socket.emit('error', new Error('already disconnected'));
  assert.deepEqual(seen.disconnected, [id], 'socket error/end/close cleanup stays idempotent');
});
