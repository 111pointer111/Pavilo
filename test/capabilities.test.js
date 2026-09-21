'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { DEFAULTS } = require('../config');
const { createChatCore } = require('../src/core');
const { effectiveFeatures, protocolCapabilities } = require('../src/core/capabilities');

function createHarness(options = {}) {
  let sequence = 0;
  const config = { ...DEFAULTS, ...options };
  config.channels = (options.channels || DEFAULTS.channels).map((channel) => ({ ...channel }));
  const core = createChatCore(config, {
    now: () => 1_000,
    randomId: (prefix) => `${prefix}_${String(++sequence).padStart(16, '0')}`,
    randomResumeToken: () => `resume-${String(++sequence).padStart(12, '0')}`,
    randomAvatarSeed: () => 42,
    log() {}
  });
  return core;
}

function join(core, peerId, username, clientSessionId, channelId) {
  assert.equal(core.connect(peerId, '192.0.2.10'), true);
  const result = core.dispatch(peerId, {
    type: 'join',
    protocolVersion: 4,
    username,
    clientSessionId,
    channelId,
    avatarSeed: 17
  });
  assert.equal(result.accepted, true, result.error?.code);
  core.completeSync(peerId);
  return result.effects.find((effect) => effect.kind === 'initial').payloads[0];
}

test('omitted features stay on and match the v1.3 capability list', () => {
  const features = effectiveFeatures({});
  assert.equal(features.images, true);
  assert.deepEqual(protocolCapabilities({}), [
    'ack', 'historyChunks', 'roomEpoch', 'reconnect', 'reactions', 'typingLease', 'mentions', 'channelOccupancy', 'historyPage'
  ]);
  const core = createHarness();
  const start = join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  assert.equal(start.features.images, true);
  assert.ok(start.capabilities.includes('historyPage'));
  assert.ok(start.capabilities.includes('reactions'));
});

test('disabled features are refused even if the client sends the command', () => {
  const channels = [{
    id: 'general', name: '大厅', description: '', enabled: true, readOnly: false, maxUsers: 8, welcome: '',
    access: 'open',
    features: { images: false, replies: false, reactions: false, mentions: false, typing: true, history: false }
  }];
  const core = createHarness({ channels, defaultChannelId: 'general' });
  const start = join(core, 'alice-peer', 'Alice', 'session-alice-0001');
  assert.equal(start.features.images, false);
  assert.equal(start.features.history, false);
  assert.equal(start.capabilities.includes('historyPage'), false);
  assert.equal(start.capabilities.includes('reactions'), false);

  const image = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'message-image-0001', kind: 'image',
    image: { src: 'data:image/png;base64,aaaa', width: 1, height: 1 }
  });
  assert.equal(image.error?.code, 'FEATURE_DISABLED');

  const reply = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'message-reply-0001', kind: 'text', text: 'hi', replyTo: 'm1'
  });
  assert.equal(reply.error?.code, 'FEATURE_DISABLED');

  const mentions = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'message-mention001', kind: 'text', text: 'hi',
    mentions: [{ id: start.self.id, username: 'Alice' }]
  });
  assert.equal(mentions.error?.code, 'FEATURE_DISABLED');

  const reaction = core.dispatch('alice-peer', {
    type: 'reaction', messageId: 'missing', emoji: '👍', active: true
  });
  assert.equal(reaction.error?.code, 'FEATURE_DISABLED');

  const page = core.dispatch('alice-peer', { type: 'historyPage', beforeSeq: 1, limit: 10 });
  assert.equal(page.error?.code, 'FEATURE_DISABLED');

  const text = core.dispatch('alice-peer', {
    type: 'message', clientMessageId: 'message-text-00001', kind: 'text', text: 'plain'
  });
  assert.equal(text.accepted, true);
});

test('room-info hides authenticated channels from unauthenticated callers', () => {
  const secret = 'k'.repeat(32);
  const channels = [
    { id: 'general', name: '大厅', description: '', enabled: true, readOnly: false, maxUsers: 8, welcome: '', access: 'open' },
    { id: 'staff', name: '内部', description: '', enabled: true, readOnly: false, maxUsers: 8, welcome: '', access: 'authenticated' }
  ];
  const core = createHarness({
    channels,
    defaultChannelId: 'general',
    identity: { guests: true, audience: 'pavilo', clockSkewSec: 60, issuers: [{ id: 'app', alg: 'HS256', secret }] }
  });
  const info = core.roomInfo();
  assert.deepEqual(info.channels.map((channel) => channel.id), ['general']);
  assert.equal(info.identity.guests, true);
  assert.equal(JSON.stringify(info).includes(secret), false);
});
