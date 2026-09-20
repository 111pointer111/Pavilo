'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const stateApi = require('../client/state');
const { createInitialState, reduce, createStore, sortAndDedupeMessages, EPOCH_ERROR, TYPING_EXPIRY } = stateApi;

const alice = { id: 'u_alice_00000001', username: 'Alice', avatarSeed: 'alice', joinedAt: 100 };
const bob = { id: 'u_bob_000000002', username: 'Bob', avatarSeed: 'bob', joinedAt: 101 };
function message(id, seq, overrides = {}) {
  return { id, seq, clientMessageId: `client_${id}_0001`, kind: 'text', author: bob,
    createdAt: 1_000 + seq, text: id, replyTo: null, reactions: {}, ...overrides };
}
function joined(overrides = {}) {
  const initial = createInitialState({ maxMessages: overrides.maxMessages || 300 });
  return { ...initial, self: alice, channelId: 'general', users: [alice, bob],
    room: { ...initial.room, epoch: 'epoch-one', latestSeq: 0, resumeToken: 'token-0001' },
    connection: { ...initial.connection, status: 'joined', joined: true }, ...overrides };
}

test('UMD exposes matching browser and Node APIs without DOM access', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/state'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.PaviloState).sort(), Object.keys(stateApi).sort());
  assert.equal(typeof browser.PaviloState.createStore, 'function');
  assert.equal(browser.document, undefined);
});

test('initial state is complete, isolated per call, and honors a positive message cap', () => {
  const first = createInitialState({ maxMessages: 2 });
  const second = createInitialState({ maxMessages: -1 });
  assert.deepEqual(first.connection, { status: 'idle', joined: false, attempt: 0, intentionalLeave: false });
  assert.deepEqual(first.room, { epoch: null, startedAt: null, latestSeq: 0, resumeToken: null, capabilities: [] });
  assert.deepEqual(first.channel, { switching: false, requestedId: null });
  assert.deepEqual(first.channelOccupancy, {});
  const occupancy = reduce(first, { type: 'channelOccupancy', occupancy: { general: 2, games: 0 } });
  assert.deepEqual(occupancy.channelOccupancy, { general: 2, games: 0 });
  assert.deepEqual(reduce(occupancy, { type: 'stateStart', self: alice, users: [alice], occupancy: { general: 1 } }).channelOccupancy, { general: 1 });
  assert.deepEqual(first.sync, { active: false, epoch: null, messages: [], deferred: [], latestSeq: 0 });
  assert.deepEqual(first.pending, {});
  assert.deepEqual(first.typing, {});
  assert.equal(first.maxMessages, 2);
  assert.equal(second.maxMessages, 300);
  first.users.push(alice);
  assert.deepEqual(second.users, []);
});

test('message normalization keeps first server ID, sorts by seq/time, and keeps newest cap', () => {
  const same = message('same-id', 2, { text: 'first' });
  const result = sortAndDedupeMessages([
    message('third', 3), same, message('first', 1, { createdAt: 50 }), { ...same, text: 'duplicate' },
    null, {}, message('second-late', 2, { createdAt: 200 }), message('second-early', 2, { createdAt: 100 }),
  ], 4);
  assert.deepEqual(result.map((item) => item.id), ['second-early', 'second-late', 'same-id', 'third']);
  assert.equal(result.find((item) => item.id === 'same-id').text, 'first');
});

test('stateStart enters sync and a successful requested switch clears the old channel only then', () => {
  let state = joined({ messages: [message('old', 1)], typing: { [bob.id]: { username: 'Bob', expiresAt: 9 } }, unread: 3 });
  state = reduce(state, { type: 'channel/request', channelId: 'games' });
  assert.deepEqual(state.messages.map((item) => item.id), ['old'], 'request retains source view');
  state = reduce(state, { type: 'stateStart', channelId: 'games', roomEpoch: 'epoch-games', roomStartedAt: 200,
    latestSeq: 4, resumeToken: 'new-token-0001', self: alice, users: [alice], occupancy: { games: 1, general: 2 } });
  assert.equal(state.connection.status, 'syncing');
  assert.equal(state.connection.joined, false);
  assert.equal(state.channel.switching, true, 'switch is not finalized until historyEnd');
  assert.equal(state.channelId, 'games');
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.typing, {});
  assert.equal(state.unread, 0);
  assert.equal(state.room.epoch, null);
  assert.equal(state.room.latestSeq, 4);
  assert.equal(state.room.resumeToken, 'new-token-0001');
  assert.deepEqual(state.sync, { active: true, epoch: 'epoch-games', messages: [], deferred: [], latestSeq: 4 });
});

test('history accepts matching and epoch-less chunks, ignores mismatches, then authoritatively replaces and caps', () => {
  let state = joined({ maxMessages: 2, messages: [message('stale', 99)] });
  state = reduce(state, { type: 'stateStart', roomEpoch: 'epoch-one', latestSeq: 8, self: alice, users: [alice, bob], channelId: 'general' });
  const ignored = reduce(state, { type: 'history', roomEpoch: 'epoch-other', messages: [message('wrong', 1)] });
  assert.equal(ignored, state);
  state = reduce(state, { type: 'history', roomEpoch: 'epoch-one', messages: [message('three', 3), message('one', 1)] });
  state = reduce(state, { type: 'history', messages: [message('two', 2), message('two', 2, { text: 'duplicate' })] });
  const beforeMismatchEnd = state;
  state = reduce(state, { type: 'historyEnd', roomEpoch: 'epoch-other', latestSeq: 20 });
  assert.equal(state, beforeMismatchEnd);
  state = reduce(state, { type: 'historyEnd', roomEpoch: 'epoch-one', latestSeq: 8 });
  assert.deepEqual(state.messages.map((item) => item.id), ['two', 'three']);
  assert.equal(state.room.epoch, 'epoch-one');
  assert.equal(state.room.latestSeq, 8);
  assert.equal(state.connection.status, 'joined');
  assert.equal(state.connection.joined, true);
  assert.equal(state.channel.switching, false);
  assert.equal(state.sync.active, false);
});

test('historyPage prepends older messages without dropping the live working set', () => {
  let state = reduce(joined({ maxMessages: 2 }), {
    type: 'stateStart', roomEpoch: 'epoch-one', latestSeq: 3, self: alice, users: [alice],
    channelId: 'general', capabilities: ['historyPage']
  });
  state = reduce(state, { type: 'history', roomEpoch: 'epoch-one', messages: [message('two', 2), message('three', 3)] });
  state = reduce(state, { type: 'historyEnd', roomEpoch: 'epoch-one', latestSeq: 3 });
  assert.deepEqual(state.messages.map((item) => item.id), ['two', 'three']);
  assert.equal(state.historyPage.exhausted, false);
  state = reduce(state, { type: 'historyPage/request' });
  assert.equal(state.historyPage.loading, true);
  state = reduce(state, { type: 'history', roomEpoch: 'epoch-one', messages: [message('one', 1)] });
  state = reduce(state, { type: 'historyPageEnd', roomEpoch: 'epoch-one', beforeSeq: 2, exhausted: true });
  assert.deepEqual(state.messages.map((item) => item.id), ['one', 'two', 'three']);
  assert.equal(state.historyPage.loading, false);
  assert.equal(state.historyPage.exhausted, true);
  assert.equal(state.historyPage.hasPaged, true);
});

test('legacy state performs immediate authoritative replacement and uses legacy epoch fallback', () => {
  const original = joined({ messages: [message('old', 1)], typing: { [bob.id]: { username: 'Bob', expiresAt: 99 } } });
  const next = reduce(original, { type: 'state', self: alice, users: [alice], messages: [message('fresh', 2)], channelId: 'general' });
  assert.deepEqual(next.messages.map((item) => item.id), ['fresh']);
  assert.equal(next.room.epoch, 'legacy');
  assert.equal(next.connection.status, 'joined');
  assert.deepEqual(next.typing, {});
});

test('sync defers exact live event set and replays it in order after authoritative history', () => {
  let state = reduce(joined(), { type: 'stateStart', roomEpoch: 'epoch-one', latestSeq: 1,
    self: alice, users: [alice], channelId: 'general' });
  const live = message('live', 2);
  state = reduce(state, { type: 'message', roomEpoch: 'epoch-one', message: live, removedIds: ['snapshot'] });
  state = reduce(state, { type: 'presence', action: 'join', user: bob, users: [alice, bob] });
  state = reduce(state, { type: 'typing', userId: bob.id, username: 'Bob', active: true, now: 100 });
  state = reduce(state, { type: 'error', code: 'TEMPORARY', message: 'later' });
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.users, [alice]);
  assert.deepEqual(state.sync.deferred.map((event) => event.type), ['message', 'presence', 'typing', 'error']);
  state = reduce(state, { type: 'history', roomEpoch: 'epoch-one', messages: [message('snapshot', 1)] });
  state = reduce(state, { type: 'historyEnd', roomEpoch: 'epoch-one', latestSeq: 1 });
  assert.deepEqual(state.messages.map((item) => item.id), ['live']);
  assert.deepEqual(state.users, [alice, bob]);
  assert.deepEqual(state.typing[bob.id], { username: 'Bob', expiresAt: 100 + TYPING_EXPIRY });
  assert.equal(state.error.code, 'TEMPORARY');
  assert.equal(state.room.latestSeq, 2);
});

test('prune is intentionally not deferred during sync', () => {
  const old = message('old', 1);
  let state = joined({ messages: [old] });
  state = reduce(state, { type: 'stateStart', roomEpoch: 'epoch-one', latestSeq: 1,
    self: alice, users: [alice], channelId: 'general' });
  state = reduce(state, { type: 'prune', roomEpoch: 'epoch-one', removedIds: [old.id] });
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.sync.deferred, []);
});

test('live message applies prune plus append atomically, dedupes IDs/correlation, sorts, caps, and advances seq', () => {
  const first = message('first', 1);
  const second = message('second', 2);
  let state = joined({ maxMessages: 2, messages: [first, second] });
  const third = message('third', 3);
  const next = reduce(state, { type: 'message', roomEpoch: 'epoch-one', removedIds: [first.id], message: third });
  assert.notEqual(next, state);
  assert.deepEqual(next.messages.map((item) => item.id), ['second', 'third']);
  assert.equal(next.room.latestSeq, 3);
  assert.deepEqual(state.messages.map((item) => item.id), ['first', 'second'], 'previous state remains unchanged');
  state = next;
  assert.equal(reduce(state, { type: 'message', roomEpoch: 'epoch-one', removedIds: [], message: third }), state);
  const duplicateCorrelation = message('other-id', 4, { clientMessageId: third.clientMessageId });
  const correlated = reduce(state, { type: 'message', roomEpoch: 'epoch-one', message: duplicateCorrelation, removedIds: [] });
  assert.deepEqual(correlated.messages.map((item) => item.id), ['second', 'third']);
  assert.equal(correlated.room.latestSeq, 4);
});

test('mismatched explicit epoch live events are ignored while epoch-less compatibility events apply', () => {
  const base = joined({ messages: [message('one', 1)] });
  for (const event of [
    { type: 'message', roomEpoch: 'wrong', message: message('two', 2), removedIds: [] },
    { type: 'reaction', roomEpoch: 'wrong', messageId: 'one', reactions: { '👍': { count: 1, userIds: [alice.id] } }, removedIds: [] },
    { type: 'prune', roomEpoch: 'wrong', removedIds: ['one'] },
  ]) assert.equal(reduce(base, event), base);
  const accepted = reduce(base, { type: 'message', message: message('two', 2), removedIds: [] });
  assert.deepEqual(accepted.messages.map((item) => item.id), ['one', 'two']);
});

test('reaction prunes first and replaces only a surviving target reaction summary', () => {
  const target = message('target', 1);
  const evicted = message('evicted', 2);
  const reactions = { '🔥': { count: 2, userIds: [alice.id, bob.id] } };
  const state = joined({ messages: [target, evicted] });
  const next = reduce(state, { type: 'reaction', roomEpoch: 'epoch-one', messageId: target.id,
    reactions, removedIds: [evicted.id] });
  assert.deepEqual(next.messages.map((item) => item.id), ['target']);
  assert.equal(next.messages[0].reactions, reactions);
  assert.equal(state.messages[0].reactions['🔥'], undefined);
  const removedTarget = reduce(state, { type: 'reaction', roomEpoch: 'epoch-one', messageId: target.id,
    reactions, removedIds: [target.id] });
  assert.deepEqual(removedTarget.messages.map((item) => item.id), ['evicted']);
});

test('presence authoritatively replaces roster and leave clears the user typing lease', () => {
  const base = joined({ typing: { [bob.id]: { username: 'Bob', expiresAt: 9 } } });
  const next = reduce(base, { type: 'presence', action: 'leave', userId: bob.id, username: 'Bob', users: [alice] });
  assert.deepEqual(next.users, [alice]);
  assert.deepEqual(next.typing, {});
  assert.ok(base.typing[bob.id]);
});

test('typing ignores self, refreshes leases, clears inactive users, and expires deterministically', () => {
  const base = joined();
  assert.equal(reduce(base, { type: 'typing', userId: alice.id, username: 'Alice', active: true, now: 10 }), base);
  let state = reduce(base, { type: 'typing', userId: bob.id, username: 'Bob', active: true, now: 10 });
  assert.deepEqual(state.typing[bob.id], { username: 'Bob', expiresAt: 10 + TYPING_EXPIRY });
  state = reduce(state, { type: 'typing', userId: bob.id, username: 'Robert', active: true, now: 20 });
  assert.deepEqual(state.typing[bob.id], { username: 'Robert', expiresAt: 20 + TYPING_EXPIRY });
  assert.equal(reduce(state, { type: 'typing/expire', now: 20 + TYPING_EXPIRY - 1 }), state);
  state = reduce(state, { type: 'typing/expire', now: 20 + TYPING_EXPIRY });
  assert.deepEqual(state.typing, {});
  assert.equal(reduce(state, { type: 'typing', userId: bob.id, username: 'Bob', active: false }), state);
});

test('pending ACK before echo becomes accepted; echo after ACK removes it without duplicating messages', () => {
  let state = joined();
  state = reduce(state, { type: 'pending/add', item: { id: 'client_pending_0001', kind: 'text', text: 'hello' } });
  const originalPending = state.pending.client_pending_0001;
  state = reduce(state, { type: 'ack', clientMessageId: 'client_pending_0001', messageId: 'server-one', seq: 1, createdAt: 101 });
  assert.equal(state.pending.client_pending_0001.status, 'accepted');
  assert.deepEqual(state.pending.client_pending_0001.ack, { messageId: 'server-one', seq: 1, createdAt: 101 });
  assert.equal(originalPending.status, 'sending');
  state = reduce(state, { type: 'message', roomEpoch: 'epoch-one', removedIds: [],
    message: message('server-one', 1, { clientMessageId: 'client_pending_0001', author: alice }) });
  assert.equal(state.pending.client_pending_0001, undefined);
  assert.deepEqual(state.messages.map((item) => item.id), ['server-one']);
  const afterDuplicate = reduce(state, { type: 'message', roomEpoch: 'epoch-one', removedIds: [],
    message: message('server-one', 1, { clientMessageId: 'client_pending_0001', author: alice }) });
  assert.equal(afterDuplicate, state);
});

test('canonical echo before ACK removes pending and late ACK is an immutable no-op', () => {
  let state = reduce(joined(), { type: 'pending/add', item: { id: 'client_pending_0002', kind: 'text', text: 'hello' } });
  state = reduce(state, { type: 'message', roomEpoch: 'epoch-one', removedIds: [],
    message: message('server-two', 1, { clientMessageId: 'client_pending_0002', author: alice }) });
  assert.deepEqual(state.pending, {});
  assert.equal(reduce(state, { type: 'ack', clientMessageId: 'client_pending_0002', messageId: 'server-two', seq: 1, createdAt: 101 }), state);
});

test('ACK and correlated errors respect pending IDs and explicit epochs', () => {
  let state = reduce(joined(), { type: 'pending/add', item: { id: 'client_pending_0003', epoch: 'epoch-one' } });
  const wrongEpoch = reduce(state, { type: 'ack', roomEpoch: 'epoch-two', clientMessageId: 'client_pending_0003', messageId: 'm_3', seq: 3, createdAt: 3 });
  assert.equal(wrongEpoch, state);
  assert.equal(reduce(state, { type: 'ack', clientMessageId: 'missing_pending', messageId: 'm_3', seq: 3, createdAt: 3 }), state);
  const next = reduce(state, { type: 'error', code: 'EMPTY_MESSAGE', message: 'empty', clientMessageId: 'client_pending_0003' });
  assert.equal(next.pending.client_pending_0003.status, 'error');
  assert.equal(next.pending.client_pending_0003.error, 'empty');
  assert.equal(next.pending.client_pending_0003.errorCode, 'EMPTY_MESSAGE');
  assert.equal(next.error.code, 'EMPTY_MESSAGE');
});

test('authoritative snapshot reconciles canonical pending and fails pending from an old epoch', () => {
  let state = joined({ pending: {
    client_pending_same: { id: 'client_pending_same', epoch: 'epoch-one', status: 'unconfirmed' },
    client_pending_old: { id: 'client_pending_old', epoch: 'old-epoch', status: 'unconfirmed' },
  } });
  state = reduce(state, { type: 'stateStart', roomEpoch: 'epoch-one', latestSeq: 1, self: alice, users: [alice], channelId: 'general' });
  state = reduce(state, { type: 'history', roomEpoch: 'epoch-one', messages: [message('accepted', 1, { clientMessageId: 'client_pending_same', author: alice })] });
  state = reduce(state, { type: 'historyEnd', roomEpoch: 'epoch-one', latestSeq: 1 });
  assert.equal(state.pending.client_pending_same, undefined);
  assert.equal(state.pending.client_pending_old.status, 'error');
  assert.equal(state.pending.client_pending_old.error, EPOCH_ERROR);
});

test('pending local actions copy entries, reject duplicates, update, replace and remove', () => {
  let state = joined();
  const item = { id: '__proto__', status: 'unconfirmed', attempts: 2 };
  state = reduce(state, { type: 'pending/add', item });
  assert.equal(Object.getPrototypeOf(state.pending), Object.prototype);
  assert.equal(Object.hasOwn(state.pending, '__proto__'), true);
  assert.equal(state.pending.__proto__.status, 'unconfirmed');
  assert.notEqual(state.pending.__proto__, item, 'store owns a copied pending entry');
  state = reduce(state, { type: 'pending/add', item: { id: 'pending-one', text: 'a' } });
  const duplicate = reduce(state, { type: 'pending/add', item: { id: 'pending-one', text: 'b' } });
  assert.equal(duplicate, state);
  state = reduce(state, { type: 'pending/update', id: 'pending-one', patch: { status: 'unconfirmed' } });
  assert.equal(state.pending['pending-one'].status, 'unconfirmed');
  state = reduce(state, { type: 'pending/replace', items: [{ id: '__proto__', status: 'accepted' }, { id: 'pending-two', status: 'error' }] });
  assert.equal(Object.hasOwn(state.pending, '__proto__'), true);
  assert.equal(state.pending.__proto__.status, 'accepted');
  assert.equal(state.pending['pending-two'].status, 'error');
  state = reduce(state, { type: 'pending/remove', id: '__proto__' });
  assert.equal(Object.hasOwn(state.pending, '__proto__'), false);
  state = reduce(state, { type: 'pending/remove', id: 'pending-two' });
  assert.deepEqual(state.pending, {});
});

test('room epoch changes clear authoritative view and prevent old pending auto-reuse', () => {
  const base = joined({ messages: [message('old', 1)], typing: { [bob.id]: { username: 'Bob', expiresAt: 9 } },
    unread: 4, pending: { pending_old: { id: 'pending_old', epoch: 'epoch-one', status: 'unconfirmed' } } });
  const same = reduce(base, { type: 'roomEpoch', roomEpoch: 'epoch-one' });
  assert.equal(same, base);
  const next = reduce(base, { type: 'roomEpoch', roomEpoch: 'epoch-two' });
  assert.equal(next.room.epoch, 'epoch-two');
  assert.equal(next.room.latestSeq, 0);
  assert.deepEqual(next.messages, []);
  assert.deepEqual(next.typing, {});
  assert.equal(next.unread, 0);
  assert.equal(next.pending.pending_old.status, 'error');
  assert.equal(next.pending.pending_old.error, EPOCH_ERROR);
});

test('connection lifecycle retains chat on ordinary close and clears it on exact service stop', () => {
  let state = joined({ messages: [message('one', 1)], unread: 2, typing: { [bob.id]: { username: 'Bob', expiresAt: 9 } },
    pending: { sending: { id: 'sending', status: 'sending' }, accepted: { id: 'accepted', status: 'accepted' } } });
  state = reduce(state, { type: 'connection/close', code: 1006, reason: '' });
  assert.equal(state.connection.status, 'reconnecting');
  assert.equal(state.connection.joined, false);
  assert.deepEqual(state.messages.map((item) => item.id), ['one']);
  assert.equal(state.pending.sending.status, 'unconfirmed');
  assert.equal(state.pending.accepted.status, 'accepted');
  assert.deepEqual(state.typing, {});
  const stopped = reduce(state, { type: 'connection/close', code: 1001, reason: 'server stopped' });
  assert.equal(stopped.connection.status, 'stopped');
  assert.equal(stopped.connection.intentionalLeave, true);
  assert.deepEqual(stopped.messages, []);
  assert.deepEqual(stopped.users, []);
  assert.deepEqual(stopped.pending, {});
  assert.equal(stopped.unread, 0);
  assert.equal(stopped.channelId, null);
  assert.equal(stopped.room.resumeToken, null);
  assert.equal(stopped.self, alice, 'exact baseline stop path keeps self until next join/login reset');
  assert.equal(stopped.room.epoch, 'epoch-one');
});

test('connection actions, room metadata, unread and explicit leave have stable reducer effects', () => {
  let state = createInitialState();
  state = reduce(state, { type: 'room/info', channels: [{ id: 'general' }], limits: { maxMessages: 7 } });
  assert.deepEqual(state.channels, [{ id: 'general' }]);
  assert.equal(state.maxMessages, 7);
  state = reduce(state, { type: 'connection/connect' });
  assert.equal(state.connection.status, 'connecting');
  state = reduce(state, { type: 'connection/open' });
  assert.equal(state.connection.status, 'joining');
  state = reduce(state, { type: 'connection/retry', attempt: 1, max: 10 });
  assert.equal(state.connection.status, 'reconnecting');
  assert.equal(state.connection.attempt, 1);
  state = { ...state, unread: 3 };
  state = reduce(state, { type: 'unread/clear' });
  assert.equal(state.unread, 0);
  state = reduce({ ...joined(), channels: state.channels, maxMessages: 7 }, { type: 'connection/leave' });
  assert.equal(state.connection.status, 'idle');
  assert.equal(state.connection.intentionalLeave, true);
  assert.deepEqual(state.channels, [{ id: 'general' }]);
  assert.equal(state.maxMessages, 7);
  assert.equal(state.self, null);
  assert.deepEqual(state.messages, []);
});

test('switch errors preserve current channel contents and reset only switch transaction', () => {
  let state = reduce(joined({ messages: [message('kept', 1)] }), { type: 'channel/request', channelId: 'full' });
  state = reduce(state, { type: 'error', code: 'CHANNEL_FULL', message: 'full' });
  assert.deepEqual(state.messages.map((item) => item.id), ['kept']);
  assert.equal(state.channelId, 'general');
  assert.deepEqual(state.channel, { switching: false, requestedId: null });
  assert.equal(state.connection.status, 'joined');
  assert.equal(state.error.code, 'CHANNEL_FULL');
});

test('identity errors clear visible room state while generic errors preserve it', () => {
  const base = joined({ messages: [message('one', 1)], pending: { p: { id: 'p' } }, unread: 2 });
  const generic = reduce(base, { type: 'error', code: 'UNKNOWN_COMMAND', message: 'unknown' });
  assert.deepEqual(generic.messages, base.messages);
  const conflict = reduce(base, { type: 'error', code: 'SESSION_CONFLICT', message: 'conflict' });
  assert.deepEqual(conflict.messages, []);
  assert.deepEqual(conflict.users, []);
  assert.deepEqual(conflict.pending, {});
  assert.equal(conflict.unread, 0);
  assert.equal(conflict.room.resumeToken, null);
  assert.equal(conflict.connection.status, 'idle');
});

test('message unread changes only when runtime supplies visibility and ignores own messages', () => {
  let state = joined();
  state = reduce(state, { type: 'message', message: message('bob-one', 1), canMarkRead: false });
  assert.equal(state.unread, 1);
  state = reduce(state, { type: 'message', message: message('alice-one', 2, { author: alice }), canMarkRead: false });
  assert.equal(state.unread, 1);
  state = reduce(state, { type: 'message', message: message('bob-two', 3), canMarkRead: true });
  assert.equal(state.unread, 0);
  state = reduce(state, { type: 'message', message: message('bob-three', 4) });
  assert.equal(state.unread, 0, 'DOM-free reducer does not guess page visibility');
});

test('deferred ACK/reaction/error events replay in arrival order against the completed snapshot', () => {
  let state = joined({ pending: {
    client_ack_first: { id: 'client_ack_first', status: 'sending', epoch: 'epoch-one' },
    client_error_last: { id: 'client_error_last', status: 'sending', epoch: 'epoch-one' },
  } });
  state = reduce(state, { type: 'stateStart', self: alice, users: [alice, bob], roomEpoch: 'epoch-one', latestSeq: 1 });
  state = reduce(state, { type: 'ack', clientMessageId: 'client_ack_first', messageId: 'canonical', seq: 2, createdAt: 20 });
  state = reduce(state, { type: 'message', roomEpoch: 'epoch-one', message: message('canonical', 2, {
    clientMessageId: 'client_ack_first', author: alice }), removedIds: [] });
  state = reduce(state, { type: 'reaction', roomEpoch: 'epoch-one', messageId: 'canonical',
    reactions: { '👍': { count: 1, userIds: [bob.id] } }, removedIds: ['snapshot'] });
  state = reduce(state, { type: 'ack', clientMessageId: 'client_error_last', messageId: 'not-yet-echoed', seq: 3, createdAt: 30 });
  state = reduce(state, { type: 'error', clientMessageId: 'client_error_last', code: 'MESSAGE_ID_CONFLICT', message: 'conflict' });
  assert.equal(state.pending.client_ack_first.status, 'sending');
  assert.equal(state.pending.client_error_last.status, 'sending');
  assert.deepEqual(state.sync.deferred.map((event) => event.type), ['ack', 'message', 'reaction', 'ack', 'error']);
  state = reduce(state, { type: 'history', roomEpoch: 'epoch-one', messages: [message('snapshot', 1)] });
  state = reduce(state, { type: 'historyEnd', roomEpoch: 'epoch-one', latestSeq: 1 });
  assert.equal(state.pending.client_ack_first, undefined);
  assert.equal(state.pending.client_error_last.status, 'error');
  assert.deepEqual(state.messages.map((item) => item.id), ['canonical']);
  assert.deepEqual(state.messages[0].reactions, { '👍': { count: 1, userIds: [bob.id] } });
});

test('new sync and ordinary disconnect discard interrupted chunks and deferred events', () => {
  let state = joined({ messages: [message('source', 1)] });
  state = reduce(state, { type: 'channel/request', channelId: 'games' });
  state = reduce(state, { type: 'stateStart', self: alice, users: [alice], channelId: 'games', roomEpoch: 'epoch-games', latestSeq: 8 });
  state = reduce(state, { type: 'history', roomEpoch: 'epoch-games', messages: [message('discard-chunk', 8)] });
  state = reduce(state, { type: 'message', roomEpoch: 'epoch-games', message: message('discard-live', 9), removedIds: [] });
  state = reduce(state, { type: 'connection/close', code: 1006, reason: '' });
  assert.equal(state.sync.active, false);
  assert.deepEqual(state.sync.messages, []);
  assert.deepEqual(state.sync.deferred, []);
  assert.deepEqual(state.channel, { switching: false, requestedId: null });
  assert.equal(reduce(state, { type: 'historyEnd', roomEpoch: 'epoch-games', latestSeq: 8 }), state);
  state = reduce(state, { type: 'stateStart', self: alice, users: [alice], channelId: 'games', roomEpoch: 'epoch-games', latestSeq: 10 });
  state = reduce(state, { type: 'history', roomEpoch: 'epoch-games', messages: [message('fresh-chunk', 10)] });
  state = reduce(state, { type: 'stateStart', self: alice, users: [alice], channelId: 'games', roomEpoch: 'epoch-games', latestSeq: 11 });
  assert.deepEqual(state.sync.messages, []);
  assert.deepEqual(state.sync.deferred, []);
  state = reduce(state, { type: 'historyEnd', roomEpoch: 'epoch-games', latestSeq: 11 });
  assert.deepEqual(state.messages, []);
});

test('heartbeat timeout and similar close reasons never trigger authoritative service-stop clearing', () => {
  const base = joined({ messages: [message('kept', 1)], pending: { p: { id: 'p', status: 'sending' } } });
  for (const close of [{ code: 1001, reason: 'heartbeat timeout' }, { code: 1006, reason: 'server stopped' },
    { code: 1001, reason: 'server stopped ' }]) {
    const next = reduce(base, { type: 'connection/close', ...close });
    assert.equal(next.connection.status, 'reconnecting');
    assert.deepEqual(next.messages.map((item) => item.id), ['kept']);
    assert.equal(next.room.resumeToken, 'token-0001');
    assert.equal(next.pending.p.status, 'unconfirmed');
  }
});

test('pure reducer accepts deeply frozen previous state for every state-changing wire event', () => {
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    }
    return value;
  }
  const base = freeze(joined({ messages: [message('target', 1)],
    typing: { [bob.id]: { username: 'Bob', expiresAt: 200 } },
    pending: { client_frozen: { id: 'client_frozen', epoch: 'epoch-one', status: 'sending' } } }));
  for (const event of [
    { type: 'message', roomEpoch: 'epoch-one', message: message('new', 2), removedIds: ['target'] },
    { type: 'reaction', roomEpoch: 'epoch-one', messageId: 'target', reactions: { '🔥': { count: 1, userIds: [bob.id] } }, removedIds: [] },
    { type: 'prune', roomEpoch: 'epoch-one', removedIds: ['target'] },
    { type: 'presence', action: 'leave', userId: bob.id, username: 'Bob', users: [alice] },
    { type: 'typing', userId: bob.id, username: 'Bob', active: true, now: 100 },
    { type: 'ack', clientMessageId: 'client_frozen', messageId: 'm_frozen', seq: 2, createdAt: 200 },
    { type: 'error', clientMessageId: 'client_frozen', code: 'RATE_LIMITED', message: 'retry' },
    { type: 'stateStart', self: alice, users: [alice], roomEpoch: 'epoch-one', latestSeq: 1 },
    { type: 'state', self: alice, users: [alice], roomEpoch: 'epoch-one', messages: [message('snapshot', 1)] },
    { type: 'connection/close', code: 1006, reason: '' },
    { type: 'serviceStopped' },
  ]) assert.notEqual(reduce(base, event), base, event.type);
  assert.deepEqual(base.messages.map((item) => item.id), ['target']);
  assert.equal(base.pending.client_frozen.status, 'sending');
});

test('store injects a clock for typing without making the reducer impure', () => {
  let now = 1_000;
  const store = createStore({ now: () => now });
  store.dispatch({ type: 'typing', userId: bob.id, username: 'Bob', active: true });
  assert.equal(store.getState().typing[bob.id].expiresAt, now + TYPING_EXPIRY);
  now += TYPING_EXPIRY;
  store.dispatch({ type: 'typing/expire' });
  assert.deepEqual(store.getState().typing, {});
  store.dispatch({ type: 'typing', userId: bob.id, username: 'Bob', active: true, now: 0 });
  assert.equal(store.getState().typing[bob.id].expiresAt, TYPING_EXPIRY);
});

test('store emits one combined message/prune change and one final snapshot/deferred replay change', () => {
  const store = createStore(joined({ messages: [message('old', 1)] }));
  const notifications = [];
  store.subscribe((next, event) => notifications.push({ ids: next.messages.map((item) => item.id), type: event.type }));
  store.dispatch({ type: 'message', roomEpoch: 'epoch-one', removedIds: ['old'], message: message('live', 2) });
  assert.deepEqual(notifications, [{ ids: ['live'], type: 'message' }]);
  store.dispatch({ type: 'stateStart', self: alice, users: [alice], roomEpoch: 'epoch-one', latestSeq: 3 });
  store.dispatch({ type: 'history', roomEpoch: 'epoch-one', messages: [message('snapshot', 3)] });
  store.dispatch({ type: 'message', roomEpoch: 'epoch-one', removedIds: ['snapshot'], message: message('after-sync', 4) });
  notifications.length = 0;
  store.dispatch({ type: 'historyEnd', roomEpoch: 'epoch-one', latestSeq: 3 });
  assert.deepEqual(notifications, [{ ids: ['after-sync'], type: 'historyEnd' }]);
});

test('createStore accepts options or state, notifies only on identity changes, and unsubscribe is stable', () => {
  const store = createStore({ maxMessages: 2 });
  const seen = [];
  const unsubscribe = store.subscribe((next, event, previous) => seen.push({ next, event, previous }));
  const initial = store.getState();
  assert.equal(store.dispatch({ type: 'unknown' }), initial);
  assert.equal(seen.length, 0);
  const next = store.dispatch({ type: 'connection/connect' });
  assert.equal(store.getState(), next);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].previous, initial);
  assert.equal(seen[0].next, next);
  assert.equal(seen[0].event.type, 'connection/connect');
  unsubscribe();
  store.dispatch({ type: 'connection/open' });
  assert.equal(seen.length, 1);
  assert.throws(() => store.subscribe(null), /Subscriber/);

  const supplied = joined();
  const suppliedStore = createStore(supplied);
  assert.equal(suppliedStore.getState(), supplied);
});
