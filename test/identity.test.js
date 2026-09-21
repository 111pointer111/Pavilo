'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { DEFAULTS } = require('../config');
const { createChatCore } = require('../src/core');
const { signHs256, authenticate } = require('../src/identity');
const { actorKey } = require('../src/core/capabilities');

const SECRET = 'identity-secret-key-32-chars-min';
const ISSUER = { id: 'app', alg: 'HS256', secret: SECRET };

function identityConfig(overrides = {}) {
  return {
    guests: true,
    audience: 'pavilo',
    clockSkewSec: 60,
    issuers: [ISSUER],
    ...overrides
  };
}

function createHarness(options = {}) {
  let clock = options.clock || 1_700_000_000_000;
  let sequence = 0;
  const config = {
    ...DEFAULTS,
    ...options,
    identity: options.identity || identityConfig(),
    channels: options.channels || [
      { id: 'general', name: '大厅', description: '', enabled: true, readOnly: false, maxUsers: 8, welcome: '', access: 'open' },
      { id: 'staff', name: '内部', description: '', enabled: true, readOnly: false, maxUsers: 8, welcome: '', access: 'authenticated' }
    ],
    defaultChannelId: options.defaultChannelId || 'general'
  };
  const core = createChatCore(config, {
    now: () => clock,
    randomId: (prefix) => `${prefix}_${String(++sequence).padStart(16, '0')}`,
    randomResumeToken: () => `resume-${String(++sequence).padStart(12, '0')}`,
    randomAvatarSeed: () => 42,
    log() {}
  });
  return {
    core,
    config,
    now: () => clock,
    advance(ms) { clock += ms; }
  };
}

function token(claims = {}) {
  const nowSec = Math.floor((claims.now || 1_700_000_000_000) / 1000);
  return signHs256({
    iss: 'app',
    aud: 'pavilo',
    sub: 'user-1',
    name: '北岸的猫',
    channels: ['general', 'staff'],
    iat: nowSec,
    exp: nowSec + 600,
    ...claims
  }, SECRET);
}

function join(core, peerId, command) {
  assert.equal(core.connect(peerId, '192.0.2.10'), true);
  const result = core.dispatch(peerId, {
    type: 'join',
    protocolVersion: 4,
    username: '访客',
    clientSessionId: `session-${peerId}-0001`,
    channelId: 'general',
    avatarSeed: 17,
    ...command
  });
  if (result.accepted) core.completeSync(peerId);
  return result;
}

test('authenticate accepts a pinned HS256 token and rejects operator tokens', () => {
  const config = { ...DEFAULTS, identity: identityConfig(), operator: { enabled: false, token: 'o'.repeat(32) } };
  const ok = authenticate(config, token(), { now: 1_700_000_000_000 });
  assert.equal(ok.userKey, 'user-1');
  assert.equal(ok.name, '北岸的猫');
  assert.deepEqual(ok.channels, ['general', 'staff']);
  assert.equal(authenticate(config, config.operator.token, { now: 1_700_000_000_000 }).error, 'IDENTITY_INVALID');
  assert.equal(authenticate(config, token({ aud: 'other' }), { now: 1_700_000_000_000 }).error, 'IDENTITY_INVALID');
  assert.equal(authenticate(config, token({ exp: Math.floor(1_700_000_000_000 / 1000) - 120 }), { now: 1_700_000_000_000 }).error, 'IDENTITY_EXPIRED');
});

test('guests join open channels and cannot join authenticated ones', () => {
  const { core } = createHarness();
  const guest = join(core, 'guest-peer', {});
  assert.equal(guest.accepted, true);
  const staff = core.dispatch('guest-peer', { type: 'switchChannel', channelId: 'staff' });
  assert.equal(staff.error?.code, 'CHANNEL_FORBIDDEN');
});

test('host token can enter granted authenticated channels and not others', () => {
  const { core } = createHarness();
  const limited = token({ channels: ['staff'] });
  const denied = join(core, 'host-peer', { identityToken: limited, channelId: 'general' });
  assert.equal(denied.error?.code, 'CHANNEL_FORBIDDEN');
  const allowed = join(core, 'staff-peer', { identityToken: limited, channelId: 'staff', username: '北岸的猫' });
  assert.equal(allowed.accepted, true);
  const start = allowed.effects.find((effect) => effect.kind === 'initial').payloads[0];
  assert.equal(start.self.username, '北岸的猫');
  assert.deepEqual(start.channels.map((channel) => channel.id), ['staff']);
  assert.equal(JSON.stringify(start).includes(SECRET), false);
});

test('guests false requires a token and bad tokens do not fall back', () => {
  const { core } = createHarness({ identity: identityConfig({ guests: false }) });
  const missing = join(core, 'anon-peer', {});
  assert.equal(missing.error?.code, 'IDENTITY_REQUIRED');
  const bad = join(core, 'bad-peer', { identityToken: 'not-a-jwt' });
  assert.equal(bad.error?.code, 'IDENTITY_INVALID');
});

test('resume requires the same stable user and rejects a swapped sub', () => {
  const { core } = createHarness();
  const first = join(core, 'one-peer', { identityToken: token({ sub: 'user-1' }) });
  assert.equal(first.accepted, true);
  const start = first.effects.find((effect) => effect.kind === 'initial').payloads[0];
  core.disconnect('one-peer');
  const conflict = join(core, 'two-peer', {
    identityToken: token({ sub: 'user-2', name: '别人' }),
    resumeToken: start.resumeToken,
    username: '北岸的猫'
  });
  assert.equal(conflict.error?.code, 'SESSION_CONFLICT');
  const resume = join(core, 'three-peer', {
    identityToken: token({ sub: 'user-1' }),
    resumeToken: start.resumeToken
  });
  assert.equal(resume.accepted, true);
});

test('expired host identity refuses later commands and closes the seat', () => {
  const { core, advance } = createHarness();
  const short = token({ exp: Math.floor(1_700_000_000_000 / 1000) + 2 });
  const joined = join(core, 'exp-peer', { identityToken: short });
  assert.equal(joined.accepted, true);
  core.completeSync('exp-peer');
  advance(5_000);
  const sent = core.dispatch('exp-peer', {
    type: 'message', clientMessageId: 'message-expired-01', kind: 'text', text: 'hi'
  });
  assert.equal(sent.error?.code, 'IDENTITY_EXPIRED');
  assert.ok(sent.effects.some((effect) => effect.kind === 'close' && effect.reason === 'identity_expired'));
});

test('play private snapshots key off userKey so the same sub resumes the actor', () => {
  const session = { id: 'u_old', userKey: 'user-1', username: '猫' };
  assert.equal(actorKey(session), 'user-1');
  assert.equal(actorKey({ id: 'u_guest' }), 'u_guest');
});
