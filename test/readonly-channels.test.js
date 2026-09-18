'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createChatCore } = require('../src/core');

function createHarness(options = {}) {
  let time = 0;
  const timers = new Map();
  let timerId = 0;

  const runtime = {
    now: () => time,
    randomId: (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2, 11)}`,
    randomResumeToken: () => Math.random().toString(36).slice(2, 18),
    schedule: (callback, delayMs) => {
      const id = ++timerId;
      timers.set(id, { callback, at: time + delayMs });
      return id;
    },
    cancel: (id) => timers.delete(id)
  };

  const config = {
    maxUsers: 4,
    messageRateLimit: 8,
    reactionRateLimit: 20,
    typingRateLimit: 12,
    rateLimitWindowMs: 5000,
    sessionLeaseMs: 50,
    maxTextLength: 2000,
    maxImageBytes: 300000,
    maxImageDimension: 1600,
    maxImagePixels: 4000000,
    maxJsonBytes: 512 * 1024,
    maxRoomBytes: 32 * 1024 * 1024,
    maxMessages: 300,
    ...options,
    channels: options.channels || [
      { id: 'general', name: 'General', description: '', enabled: true, readOnly: false, maxUsers: options.maxUsers || 4, welcome: '' },
      { id: 'readonly', name: 'ReadOnly', description: '', enabled: true, readOnly: true, maxUsers: options.maxUsers || 4, welcome: 'This is a read-only channel.' }
    ],
    defaultChannelId: options.defaultChannelId || 'general'
  };

  const core = createChatCore(config, runtime);

  function advance(ms) {
    time += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= time) {
        timers.delete(id);
        timer.callback();
      }
    }
  }

  function join(name, channelId = config.defaultChannelId, ip = '127.0.0.1') {
    const peerId = runtime.randomId('peer');
    core.connect(peerId, ip);
    const result = core.dispatch(peerId, { type: 'join', username: name, channelId, protocolVersion: 4 }, ip);
    if (result.accepted) {
      core.completeSync(peerId);
    }
    return { peerId, result };
  }

  return { core, config, runtime, advance, join };
}

test('read-only channel rejects text and image messages with CHANNEL_READ_ONLY', () => {
  const { core, join } = createHarness();
  const alice = join('Alice', 'readonly');
  assert.ok(alice.result.accepted);

  const textResult = core.dispatch(alice.peerId, {
    type: 'message',
    kind: 'text',
    text: 'Hello',
    clientMessageId: 'msg1'
  });
  assert.equal(textResult.accepted, false);
  assert.equal(textResult.error.code, 'CHANNEL_READ_ONLY');
  assert.equal(textResult.error.clientMessageId, 'msg1');
  assert.equal(textResult.error.message, '这个频道是只读频道，不能发送消息。');

  const imageResult = core.dispatch(alice.peerId, {
    type: 'message',
    kind: 'image',
    image: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', mime: 'image/png', width: 1, height: 1, bytes: 68 },
    clientMessageId: 'msg2'
  });
  assert.equal(imageResult.accepted, false);
  assert.equal(imageResult.error.code, 'CHANNEL_READ_ONLY');
  assert.equal(imageResult.error.clientMessageId, 'msg2');

  // Verify no messages were stored
  assert.equal(core.state().messages, 0);

  // A message without clientMessageId still reports CHANNEL_READ_ONLY, not a missing-id error
  const legacyResult = core.dispatch(alice.peerId, {
    type: 'message',
    kind: 'text',
    text: 'Legacy'
  });
  assert.equal(legacyResult.accepted, false);
  assert.equal(legacyResult.error.code, 'CHANNEL_READ_ONLY');
  assert.equal(legacyResult.error.clientMessageId, undefined);
});

test('typing is silently dropped in a read-only channel', () => {
  const { core, join } = createHarness();
  const alice = join('Alice', 'readonly');

  const result = core.dispatch(alice.peerId, { type: 'typing', active: true });
  assert.equal(result.accepted, true);

  const typingBroadcasts = result.effects.filter(e => e.kind === 'broadcast' && e.payload?.type === 'typing');
  assert.equal(typingBroadcasts.length, 0);
});

test('reactions remain allowed in a read-only channel, blocked only by MESSAGE_GONE', () => {
  const { core, join } = createHarness();
  const alice = join('Alice', 'readonly');

  const result = core.dispatch(alice.peerId, {
    type: 'reaction',
    messageId: 'nonexistent',
    emoji: '👍',
    active: true
  });
  assert.equal(result.accepted, false);
  assert.ok(result.error);
  assert.equal(result.error.code, 'MESSAGE_GONE');
});

test('read-only channel remains joinable and switchable with normal roster and occupancy', () => {
  const { core, join } = createHarness();
  const alice = join('Alice', 'readonly');
  assert.ok(alice.result.accepted);

  const bob = join('Bob', 'general');
  assert.ok(bob.result.accepted);

  const switchResult = core.dispatch(bob.peerId, { type: 'switchChannel', channelId: 'readonly' });
  assert.ok(switchResult.accepted);
  core.completeSync(bob.peerId);

  // Verify both are in the readonly channel
  assert.equal(core.state().sessions, 2);
});

test('roomInfo exposes readOnly and welcome for every channel', () => {
  const { core } = createHarness();
  const info = core.roomInfo();

  const readonlyChannel = info.channels.find(c => c.id === 'readonly');
  assert.ok(readonlyChannel);
  assert.equal(readonlyChannel.readOnly, true);
  assert.equal(readonlyChannel.welcome, 'This is a read-only channel.');

  const generalChannel = info.channels.find(c => c.id === 'general');
  assert.ok(generalChannel);
  assert.equal(generalChannel.readOnly, false);
  assert.equal(generalChannel.welcome, '');
  assert.equal(info.defaultLanguage, 'zh-CN');
  assert.deepEqual(info.supportedLanguages, ['zh-CN', 'en']);
});
