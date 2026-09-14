'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createInitialState, reduce, createStore } = require('../client/state');
const self = { id: 'alice', username: 'Alice', avatarSeed: 1 };
const other = { id: 'bob', username: 'Bob', avatarSeed: 2 };
const message = (id, author = self) => ({ id, seq: 1, createdAt: 1, kind: 'text', text: id, author, clientMessageId: 'same-client-id' });
function joined() {
  return reduce(createInitialState(), { type: 'state', self, users: [self, other], messages: [], roomEpoch: 'room-one' });
}
function snapshot(state, messages, epoch = 'room-one') {
  state = reduce(state, { type: 'stateStart', self, users: [self], roomEpoch: epoch, latestSeq: messages.length });
  state = reduce(state, { type: 'history', roomEpoch: epoch, messages });
  return reduce(state, { type: 'historyEnd', roomEpoch: epoch, latestSeq: messages.length });
}

test('client correlation IDs are author-scoped and cannot settle another user pending', () => {
  let state = reduce(joined(), { type: 'pending/add', item: { id: 'same-client-id', text: 'own' } });
  state = reduce(state, { type: 'message', message: message('other', other) });
  assert.ok(state.pending['same-client-id']);
  state = reduce(state, { type: 'message', message: message('own') });
  assert.deepEqual(state.messages.map((item) => item.id), ['other', 'own']);
  assert.deepEqual(state.pending, {});
});

test('snapshot reconciles own canonical messages before the display cap', () => {
  let state = { ...joined(), maxMessages: 1 };
  state = reduce(state, { type: 'pending/add', item: { id: 'same-client-id', text: 'own' } });
  state = snapshot(state, [message('own'), { ...message('other', other), clientMessageId: 'other-client-id', seq: 2 }]);
  assert.deepEqual(state.messages.map((item) => item.id), ['other']);
  assert.deepEqual(state.pending, {});
});

test('leave then a successful new join resets the intentional disconnect flag', () => {
  let state = reduce(joined(), { type: 'connection/leave' });
  state = reduce(state, { type: 'connection/connect' });
  state = reduce(state, { type: 'connection/open' });
  state = snapshot(state, []);
  state = reduce(state, { type: 'connection/close', code: 1006 });
  assert.equal(state.connection.status, 'reconnecting');
});

test('reconnect identity failure clears the room left visible during joining', () => {
  let state = { ...joined(), messages: [message('old')], unread: 3 };
  for (const type of ['connection/close', 'connection/connect', 'connection/open']) state = reduce(state, { type });
  state = reduce(state, { type: 'error', code: 'SESSION_CONFLICT', message: 'conflict' });
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.users, []);
  assert.equal(state.unread, 0);
});

test('prune received during sync cannot be resurrected by later history chunks', () => {
  const old = message('pruned-before-history', other);
  let state = joined({ messages: [old] });
  state = reduce(state, { type: 'stateStart', self, users: [self], roomEpoch: 'room-one', latestSeq: 1 });
  state = reduce(state, { type: 'prune', roomEpoch: 'room-one', removedIds: [old.id] });
  state = reduce(state, { type: 'history', roomEpoch: 'room-one', messages: [old] });
  state = reduce(state, { type: 'historyEnd', roomEpoch: 'room-one', latestSeq: 1 });
  assert.deepEqual(state.messages, []);
});

test('new epoch learned through history clears old unread', () => {
  const state = snapshot({ ...joined(), unread: 3 }, [], 'room-new');
  assert.equal(state.unread, 0);
});


test('nested subscriber dispatch cannot notify newer state before stale state', () => {
  const store = createStore();
  const seen = [];
  store.subscribe((_next, event) => { if (event.type === 'connection/connect') store.dispatch({ type: 'connection/open' }); });
  store.subscribe((next) => seen.push(next.connection.status));
  const next = store.dispatch({ type: 'connection/connect' });
  assert.deepEqual(seen, ['connecting', 'joining']);
  assert.equal(next.connection.status, 'joining');
});
