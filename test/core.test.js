'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { DEFAULTS } = require('../config');
const { createChatCore } = require('../src/core');

function createHarness(options = {}) {
  let clock = 1_000;
  let sequence = 0;
  const timers = [];
  const config = { ...DEFAULTS, ...options };
  config.channels = (options.channels || DEFAULTS.channels).map((channel) => ({ ...channel }));
  const core = createChatCore(config, {
    now: () => clock,
    randomId: (prefix) => `${prefix}_${String(++sequence).padStart(16, '0')}`,
    randomResumeToken: () => `resume-${String(++sequence).padStart(12, '0')}`,
    randomAvatarSeed: () => 42,
    schedule(fn, ms) {
      const timer = { fn, at: clock + ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(timer) { if (timer) timer.cancelled = true; }
  });
  function advance(ms) {
    clock += ms;
    for (const timer of timers.filter((item) => !item.cancelled && item.at <= clock)) {
      timer.cancelled = true;
      timer.fn();
    }
  }
  return { core, advance };
}

function join(core, peerId, username, clientSessionId, channelId) {
  assert.equal(core.connect(peerId, `192.0.2.${peerId.length}`), true);
  const result = core.dispatch(peerId, {
    type: 'join',
    protocolVersion: 4,
    username,
    clientSessionId,
    channelId,
    avatarSeed: 17
  });
  assert.equal(result.accepted, true);
  const initial = result.effects.find((effect) => effect.kind === 'initial');
  assert.ok(initial);
  core.completeSync(peerId);
  return initial.payloads[0];
}

test('core broadcasts privacy-safe occupancy snapshots across channel lifecycle', () => {
  const channels = [
    { id: 'general', name: 'General', description: '', enabled: true, maxUsers: 2 },
    { id: 'other', name: 'Other', description: '', enabled: true, maxUsers: 2 },
    { id: 'disabled', name: 'Disabled', description: '', enabled: false, maxUsers: 2 }
  ];
  const { core, advance } = createHarness({ channels, defaultChannelId: 'general', maxUsers: 4, sessionLeaseMs: 50 });
  const first = join(core, 'alice-peer', 'Alice', 'session-alice-0001', 'general');
  assert.deepEqual(first.occupancy, { general: 1, other: 0, disabled: 0 });

  assert.equal(core.connect('bob-peer'), true);
  const joined = core.dispatch('bob-peer', {
    type: 'join', protocolVersion: 4, username: 'Bob', clientSessionId: 'session-bob-0001', channelId: 'other'
  });
  const joinedOccupancy = joined.effects.find((effect) => effect.payload?.type === 'channelOccupancy');
  assert.deepEqual(joinedOccupancy.payload.occupancy, { general: 1, other: 1, disabled: 0 });
  assert.deepEqual(joinedOccupancy.peerIds, ['alice-peer']);
  core.completeSync('bob-peer');

  const switched = core.dispatch('alice-peer', { type: 'switchChannel', channelId: 'other' });
  const switchedStart = switched.effects.find((effect) => effect.kind === 'initial').payloads[0];
  assert.deepEqual(switchedStart.occupancy, { general: 0, other: 2, disabled: 0 });
  const switchedOccupancy = switched.effects.find((effect) => effect.payload?.type === 'channelOccupancy');
  assert.deepEqual(switchedOccupancy.peerIds, ['bob-peer']);
  assert.deepEqual(switchedOccupancy.payload.occupancy, switchedStart.occupancy);
  core.completeSync('alice-peer');

  core.dispatch('bob-peer', { type: 'leave' });
  const left = core.disconnect('bob-peer');
  const leaveOccupancy = left.find((effect) => effect.payload?.type === 'channelOccupancy');
  assert.deepEqual(leaveOccupancy.payload.occupancy, { general: 0, other: 1, disabled: 0 });
  assert.deepEqual(leaveOccupancy.peerIds, ['alice-peer']);

  core.connect('carol-peer');
  const carol = core.dispatch('carol-peer', {
    type: 'join', protocolVersion: 3, username: 'Carol', clientSessionId: 'session-carol-0001', channelId: 'general'
  });
  assert.equal(carol.effects.some((effect) => effect.payload?.type === 'channelOccupancy' && effect.peerIds.includes('carol-peer')), false,
    'older clients must not receive occupancy events');
  core.completeSync('carol-peer');
  core.disconnect('carol-peer');
  const expiry = core.drainEffects();
  assert.equal(expiry.some((effect) => effect.payload?.type === 'channelOccupancy'), false,
    'a leased disconnect does not change occupancy');
  advance(51);
  const expired = core.drainEffects().find((effect) => effect.payload?.type === 'channelOccupancy');
  assert.deepEqual(expired.payload.occupancy, { general: 0, other: 1, disabled: 0 });
});


test('core normalizes mentions against the current roster and strips invalid IDs', () => {
  const { core } = createHarness();
  join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  join(core, 'bob-peer', 'Bob', 'session-bob-0001');
  const sent = core.dispatch('alice-peer', { type: 'message', clientMessageId: 'mention-core-0001', kind: 'text', text: 'Hi @Bob @Ghost', mentions: ['u_missing', 'u_missing'] });
  const event = sent.effects.find((effect) => effect.kind === 'broadcast').payload;
  assert.equal(event.message.mentions, undefined);
  const bob = core.dispatch('alice-peer', { type: 'message', clientMessageId: 'mention-core-0002', kind: 'text', text: 'Hi @Bob', mentions: [event.message.author.id] });
  assert.equal(bob.effects.find((effect) => effect.kind === 'broadcast').payload.message.mentions, undefined);
});

test('core accepts a real member ID and authoritative username in a mention', () => {
  const { core } = createHarness();
  const alice = join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  const bob = join(core, 'bob-peer', 'Bob', 'session-bob-0001');
  const bobId = bob.users.find((user) => user.username === 'Bob').id;
  const sent = core.dispatch('alice-peer', { type: 'message', clientMessageId: 'mention-core-0003', kind: 'text', text: 'Hi @Bob', mentions: [bobId] });
  assert.deepEqual(sent.effects.find((effect) => effect.kind === 'broadcast').payload.message.mentions, [{ id: bobId, username: 'Bob' }]);
  assert.notEqual(alice.self.id, bobId);
});

test('core accepts an image caption on the same message and fingerprints it separately', () => {
  const { core } = createHarness();
  const alice = join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  const bob = join(core, 'bob-peer', 'Bob', 'session-bob-0001');
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(2, 16);
  png.writeUInt32BE(3, 20);
  const image = { src: `data:image/png;base64,${png.toString('base64')}`, width: 2, height: 3 };
  const bobId = bob.users.find((user) => user.username === 'Bob').id;
  const sent = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'image-caption-0001', kind: 'image', image, text: '看这个 @Bob', mentions: [bobId],
  });
  const message = sent.effects.find((effect) => effect.kind === 'broadcast').payload.message;
  assert.equal(message.kind, 'image');
  assert.equal(message.text, '看这个 @Bob');
  assert.deepEqual(message.mentions, [{ id: bobId, username: 'Bob' }]);
  assert.equal(message.image.width, 2);
  const duplicate = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'image-caption-0001', kind: 'image', image, text: '看这个 @Bob', mentions: [bobId],
  });
  assert.deepEqual(duplicate.effects[0].payload, sent.effects[0].payload);
  const conflict = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'image-caption-0001', kind: 'image', image, text: '另一句',
  });
  assert.equal(conflict.accepted, false);
  assert.equal(conflict.error.code, 'MESSAGE_ID_CONFLICT');
  const bare = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'image-caption-0002', kind: 'image', image, text: '   ',
  });
  const bareMessage = bare.effects.find((effect) => effect.kind === 'broadcast').payload.message;
  assert.equal(Object.hasOwn(bareMessage, 'text'), false);
  assert.equal(bareMessage.mentions, undefined);
  const reply = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'image-caption-0003', kind: 'text', text: 'ok', replyTo: message.id,
  });
  assert.equal(reply.effects.find((effect) => effect.kind === 'broadcast').payload.message.replyTo.text, '看这个 @Bob');
  assert.equal(alice.self.username, 'Alice');
});
test('core accepts commands and returns routed effects without a network transport', () => {
  const { core } = createHarness();
  const state = join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  assert.equal(state.type, 'stateStart');
  assert.equal(state.self.username, 'Alice');

  const sent = core.dispatch('alice-peer', {
    type: 'message',
    clientMessageId: 'message-core-0001',
    kind: 'text',
    text: '  hello\r\ncore  '
  });
  assert.equal(sent.accepted, true);
  assert.equal(sent.effects[0].kind, 'send');
  assert.equal(sent.effects[0].payload.type, 'ack');
  assert.equal(sent.effects[1].kind, 'broadcast');
  assert.equal(sent.effects[1].payload.message.text, 'hello\ncore');
  assert.equal(core.state().messages, 1);

  const duplicate = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'message-core-0001', kind: 'text', text: 'hello\ncore'
  });
  assert.equal(duplicate.effects.length, 1);
  assert.deepEqual(duplicate.effects[0].payload, sent.effects[0].payload);
  assert.equal(core.state().messages, 1);
});

test('core rejects a failed channel switch atomically', () => {
  const channels = [
    { id: 'general', name: 'General', description: '', enabled: true, maxUsers: 4 },
    { id: 'quiet', name: 'Quiet', description: '', enabled: true, maxUsers: 1 }
  ];
  const { core } = createHarness({ channels, defaultChannelId: 'general', maxUsers: 4 });
  join(core, 'bob-peer', 'Bob', 'session-bob-000001', 'quiet');
  join(core, 'alice-peer', 'Alice', 'session-alice-0001', 'general');

  const failed = core.dispatch('alice-peer', { type: 'switchChannel', channelId: 'quiet' });
  assert.equal(failed.accepted, false);
  assert.equal(failed.error.code, 'CHANNEL_FULL');
  assert.equal(core.connectionStatus('alice-peer').channelId, 'general');

  const message = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'message-after-fail', kind: 'text', text: 'still here'
  });
  assert.equal(message.effects.find((effect) => effect.kind === 'broadcast').channelId, 'general');
});

test('core preserves lease capacity, resume identity, and active-session takeover', () => {
  const { core, advance } = createHarness({ maxUsers: 1, sessionLeaseMs: 50 });
  const first = join(core, 'alice-one', 'Alice', 'session-alice-0001');
  core.disconnect('alice-one');

  assert.equal(core.connect('bob-peer'), true);
  const blocked = core.dispatch('bob-peer', {
    type: 'join', protocolVersion: 3, username: 'Bob', clientSessionId: 'session-bob-000001'
  });
  assert.equal(blocked.error.code, 'SERVER_FULL');
  core.disconnect('bob-peer');

  const resumed = join(core, 'alice-two', 'Alice', 'session-alice-0001');
  assert.equal(resumed.self.id, first.self.id);
  assert.equal(resumed.resumeToken, first.resumeToken);

  assert.equal(core.connect('alice-three'), true);
  const takeover = core.dispatch('alice-three', {
    type: 'join', protocolVersion: 3, username: 'Alice', resumeToken: first.resumeToken
  });
  assert.equal(takeover.accepted, true);
  assert.ok(takeover.effects.some((effect) => effect.kind === 'close' && effect.peerId === 'alice-two' && effect.reason === 'reconnected'));
  assert.equal(core.connectionStatus('alice-three').joined, true);

  core.disconnect('alice-three');
  advance(51);
  assert.equal(core.state().sessions, 0);
  const expiry = core.drainEffects();
  assert.ok(expiry.some((effect) => effect.kind === 'broadcast' && effect.payload.action === 'leave' && effect.payload.userId === first.self.id));
});

test('takeover captures broadcast recipients before the new peer is joined', () => {
  const { core } = createHarness();
  const alice = join(core, 'alice-one', 'Alice', 'session-alice-0001');
  join(core, 'bob-peer', 'Bob', 'session-bob-000001');
  core.dispatch('alice-one', { type: 'typing', active: true });
  core.connect('alice-two');
  const resumed = core.dispatch('alice-two', {
    type: 'join', protocolVersion: 3, username: 'Alice', resumeToken: alice.resumeToken
  });
  const typingStop = resumed.effects.find((effect) => effect.payload?.type === 'typing');
  assert.deepEqual(typingStop.peerIds, ['bob-peer']);
  assert.equal(typingStop.payload.active, false);
  assert.ok(resumed.effects.findIndex((effect) => effect.kind === 'initial') > resumed.effects.indexOf(typingStop));
});

test('core holds sends during sync and expires typing through domain effects', () => {
  const { core, advance } = createHarness({ typingTtlMs: 40 });
  join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  core.dispatch('alice-peer', { type: 'switchChannel', channelId: DEFAULTS.defaultChannelId });
  const refused = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'message-during-sync', kind: 'text', text: 'wait'
  });
  assert.equal(refused.accepted, false);
  assert.equal(refused.error.code, 'SYNC_IN_PROGRESS');
  assert.equal(refused.error.clientMessageId, 'message-during-sync');
  assert.equal(core.state().messages, 0);
  core.completeSync('alice-peer');
  const typing = core.dispatch('alice-peer', { type: 'typing', active: true });
  assert.equal(typing.effects[0].payload.active, true);
  assert.equal(typing.effects[0].transient, true);
  advance(41);
  assert.equal(core.drainEffects()[0].payload.active, false);
});

test('core shutdown clears ephemeral data and cancels future lease and typing effects', () => {
  const { core, advance } = createHarness({ sessionLeaseMs: 40, typingTtlMs: 20 });
  join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  core.dispatch('alice-peer', { type: 'message', clientMessageId: 'message-before-stop', kind: 'text', text: 'ephemeral' });
  core.dispatch('alice-peer', { type: 'typing', active: true });
  const stopped = core.shutdown();
  assert.ok(stopped.some((effect) => effect.kind === 'close' && effect.reason === 'server stopped'));
  core.disconnect('alice-peer');
  assert.deepEqual(core.state(), { clients: 0, sessions: 0, messages: 0, roomBytes: 0, latestSeq: 0 });
  advance(100);
  assert.deepEqual(core.drainEffects(), []);
  assert.equal(core.connect('another-peer'), false);
});

test('duplicate submissions bypass message rate limits and retain the original ACK', () => {
  const { core } = createHarness({ messageRateLimit: 1 });
  join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  const command = { type: 'message', clientMessageId: 'dedupe-message-0001', kind: 'text', text: 'once' };
  const first = core.dispatch('alice-peer', command);
  const duplicate = core.dispatch('alice-peer', command);
  assert.deepEqual(duplicate.effects.map((effect) => effect.payload), [first.effects[0].payload]);
  const refused = core.dispatch('alice-peer', { ...command, clientMessageId: 'dedupe-message-0002' });
  assert.equal(refused.error.code, 'RATE_LIMITED');
  assert.equal(core.state().messages, 1);
});

test('reaction growth can prune its own message under the channel byte budget', () => {
  const { core } = createHarness({ maxRoomBytes: 300 });
  join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  const sent = core.dispatch('alice-peer', { type: 'message', clientMessageId: 'reaction-budget-0001', kind: 'text', text: 'x' });
  assert.equal(sent.accepted, true);
  const id = sent.effects[0].payload.messageId;
  const reaction = core.dispatch('alice-peer', { type: 'reaction', messageId: id, emoji: '👍', active: true });
  assert.equal(reaction.accepted, true);
  assert.equal(reaction.effects[0].payload.type, 'prune');
  assert.deepEqual(reaction.effects[0].payload.removedIds, [id]);
  assert.equal(core.state().messages, 0);
  assert.equal(core.state().roomBytes, 0);
});

test('core evicts FIFO history while preserving monotonic room sequence', () => {
  const { core } = createHarness({ maxMessages: 2 });
  join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  const removed = [];
  for (let number = 1; number <= 3; number += 1) {
    const result = core.dispatch('alice-peer', {
      type: 'message', clientMessageId: `message-core-000${number}`, kind: 'text', text: `message ${number}`
    });
    removed.push(result.effects.find((effect) => effect.kind === 'broadcast').payload.removedIds);
  }
  assert.deepEqual(removed.slice(0, 2), [[], []]);
  assert.equal(removed[2].length, 1);
  assert.equal(core.state().messages, 2);
  assert.equal(core.state().latestSeq, 3);
});
