'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const protocol = require('../client/protocol');
const { parseServerEvent, PROTOCOL_VERSION, COMMANDS, EVENTS } = protocol;

const user = { id: 'u_aabbccddeeff0011', username: 'Alice', avatarSeed: 123456, joinedAt: 123 };
const epoch = 'room-general_aabbccddeeff0011';
function message(overrides = {}) {
  return { id: 'm1_aabbccddeeff0011', seq: 1, clientMessageId: 'cm_message_0001', kind: 'text',
    author: user, createdAt: 124, text: 'hello', replyTo: null, reactions: {}, ...overrides };
}
function frames() {
  return [
    { type: 'stateStart', protocolVersion: 4, capabilities: ['ack', 'historyChunks', 'channelOccupancy'], roomEpoch: epoch,
      roomStartedAt: 100, latestSeq: 1, resumeToken: 'abcdefghijkl', self: user, users: [user], channelId: 'general',
      occupancy: { general: 1, quiet: 0 } },
    { type: 'history', roomEpoch: epoch, messages: [message()] },
    { type: 'historyEnd', roomEpoch: epoch, latestSeq: 1 },
    { type: 'state', self: user, users: [user], messages: [message()], roomEpoch: epoch, channelId: 'general' },
    { type: 'presence', action: 'join', user, users: [user] },
    { type: 'presence', action: 'reconnect', user, users: [user] },
    { type: 'presence', action: 'leave', userId: user.id, username: user.username, users: [] },
    { type: 'channelOccupancy', occupancy: { general: 1, quiet: 0 } },
    { type: 'message', roomEpoch: epoch, message: message(), removedIds: [] },
    { type: 'reaction', roomEpoch: epoch, messageId: message().id, reactions: { '👍': { count: 1, userIds: [user.id] } }, removedIds: [] },
    { type: 'prune', roomEpoch: epoch, removedIds: [message().id] },
    { type: 'typing', userId: user.id, username: user.username, active: true },
    { type: 'ack', clientMessageId: message().clientMessageId, messageId: message().id, seq: 1, createdAt: 124 },
    { type: 'error', code: 'SYNC_IN_PROGRESS', message: 'Retry later', clientMessageId: message().clientMessageId },
  ];
}

test('UMD exposes matching browser/Node API without accessing DOM', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/protocol'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.PaviloProtocol).sort(), Object.keys(protocol).sort());
  assert.equal(browser.PaviloProtocol.PROTOCOL_VERSION, PROTOCOL_VERSION);
  assert.equal(browser.document, undefined);
  assert.equal(browser.PaviloProtocol.parseServerEvent(JSON.stringify(frames()[0])).type, 'stateStart');
});

test('protocol version and frozen command/event names match wire contract', () => {
  assert.equal(PROTOCOL_VERSION, 4);
  assert.deepEqual(Object.values(COMMANDS), ['join', 'message', 'reaction', 'typing', 'switchChannel', 'leave']);
  assert.deepEqual(Object.values(EVENTS), ['stateStart', 'history', 'historyEnd', 'state', 'presence', 'message', 'reaction', 'prune', 'typing', 'channelOccupancy', 'ack', 'error']);
  assert.deepEqual(protocol.ACK_FIELDS, ['clientMessageId', 'messageId', 'seq', 'createdAt']);
  assert.deepEqual(protocol.ERROR_FIELDS, ['code', 'message', 'clientMessageId']);
  assert.deepEqual(protocol.SYNC_EVENTS, ['stateStart', 'history', 'historyEnd']);
  assert.ok(!protocol.DEFERRED_EVENTS.includes('prune'));
  assert.ok(Object.isFrozen(COMMANDS));
  assert.ok(Object.isFrozen(EVENTS));
});

test('all current server frames parse from strings and objects without rewriting payloads', () => {
  for (const frame of frames()) {
    assert.equal(parseServerEvent(frame), frame, frame.type);
    assert.deepEqual(parseServerEvent(JSON.stringify(frame)), frame);
  }
  const image = message({ kind: 'image', image: { src: 'data:image/png;base64,AA==', mime: 'image/png', width: 1, height: 1, bytes: 1 } });
  assert.equal(parseServerEvent({ type: 'message', message: image }).message, image);
});

test('malformed JSON, non-object frames, unsupported types and missing event fields return null', () => {
  for (const raw of ['', '{', 'null', 'true', '7', '[]', '"message"', null, undefined, true, 7, [], {}, { type: 'join' }, { type: 'serviceStopped' }]) {
    assert.equal(parseServerEvent(raw), null, String(raw));
  }
  for (const frame of frames()) {
    for (const field of ({ stateStart: ['self', 'users', 'latestSeq'], history: ['messages'], historyEnd: ['latestSeq'],
      state: ['self', 'users', 'messages'], presence: ['users', 'action'], channelOccupancy: ['occupancy'], message: ['message'], reaction: ['messageId', 'reactions'],
      prune: ['removedIds'], typing: ['userId', 'username', 'active'], ack: ['clientMessageId', 'messageId', 'seq', 'createdAt'],
      error: ['code', 'message'] })[frame.type]) {
      const invalid = { ...frame };
      delete invalid[field];
      assert.equal(parseServerEvent(invalid), null, `${frame.type} missing ${field}`);
    }
  }
});

test('IDs respect server client-message and configuration channel boundaries', () => {
  for (const id of ['12345678', 'a'.repeat(96), 'cm_abc-123']) assert.ok(protocol.isClientMessageId(id));
  for (const id of ['short', 'a'.repeat(97), 'abcdefgh!', ' abcdefgh', '', 5, null]) assert.equal(protocol.isClientMessageId(id), false);
  for (const id of ['general', '1', 'a'.repeat(32), 'a_b-1']) assert.ok(protocol.isChannelId(id));
  for (const id of ['A', '_general', '-general', 'a'.repeat(33), 'a/b', '', null]) assert.equal(protocol.isChannelId(id), false);
  assert.ok(protocol.isRoomEpoch(epoch));
  assert.equal(protocol.isRoomEpoch('room/general'), false);
  assert.equal(protocol.isId('bad id'), false);
  for (const frame of frames()) {
    assert.equal(parseServerEvent({ ...frame, roomEpoch: '' }), null);
    assert.equal(parseServerEvent({ ...frame, channelId: '../secret' }), null);
  }
});

test('epoch-less compatibility frames remain valid; sync metadata and sequences are checked', () => {
  for (const frame of frames()) {
    const legacy = { ...frame };
    delete legacy.roomEpoch;
    delete legacy.channelId;
    assert.ok(parseServerEvent(legacy));
  }
  assert.ok(parseServerEvent({ ...frames()[0], resumeToken: null }));
  for (const latestSeq of [-1, '1', NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseServerEvent({ ...frames()[0], latestSeq }), null);
    assert.equal(parseServerEvent({ type: 'historyEnd', latestSeq }), null);
  }
  assert.equal(parseServerEvent({ ...frames()[0], capabilities: 'ack' }), null);
  assert.equal(parseServerEvent({ ...frames()[0], capabilities: [1] }), null);
  assert.equal(parseServerEvent({ ...frames()[0], resumeToken: 'not a token' }), null);
  assert.equal(parseServerEvent({ ...frames()[0], protocolVersion: 0 }), null);
});

test('nested messages/history, replies, removed IDs and reactions reject invalid models', () => {
  for (const invalid of [message({ id: null }), message({ clientMessageId: 'tiny' }), message({ author: {} }),
    message({ seq: -1 }), message({ createdAt: '123' }), message({ text: null }), message({ kind: 'unknown' }),
    message({ replyTo: { id: 'm_1', username: 'Bob', kind: 'text' } }),
    message({ kind: 'image', image: { src: 'data:x', width: 0, height: 2 } }),
    message({ reactions: { '👍': { count: 1, userIds: [null] } } })]) {
    assert.equal(parseServerEvent({ type: 'message', message: invalid }), null);
    assert.equal(parseServerEvent({ type: 'history', messages: [invalid] }), null);
  }
  for (const removedIds of [null, 'm_1', [null], ['m 1']]) {
    assert.equal(parseServerEvent({ type: 'prune', removedIds }), null);
    assert.equal(parseServerEvent({ type: 'message', message: message(), removedIds }), null);
  }
  for (const reactions of [null, [], { '✅': { count: 1, userIds: [user.id] } }, { '👍': { count: -1, userIds: [] } }]) {
    assert.equal(parseServerEvent({ type: 'reaction', messageId: 'm_1', reactions }), null);
  }
});

test('ACK validates correlation fields, but errors can echo invalid submission IDs', () => {
  const ack = frames().find((frame) => frame.type === 'ack');
  for (const patch of [{ clientMessageId: 'tiny' }, { messageId: '' }, { seq: '1' }, { createdAt: Infinity }]) {
    assert.equal(parseServerEvent({ ...ack, ...patch }), null);
  }
  assert.ok(parseServerEvent({ type: 'error', code: 'INVALID_MESSAGE_ID', message: 'invalid ID', clientMessageId: 'tiny' }));
  assert.ok(parseServerEvent({ type: 'error', code: 'INVALID_MESSAGE_ID', message: 'invalid ID', clientMessageId: '' }));
  assert.equal(parseServerEvent({ type: 'error', code: 'INVALID_MESSAGE_ID', message: 'invalid ID', clientMessageId: 7 }), null);
  assert.equal(parseServerEvent({ type: 'typing', userId: user.id, username: user.username, active: 1 }), null);
});
