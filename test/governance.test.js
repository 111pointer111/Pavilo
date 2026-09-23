'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DEFAULTS } = require('../config');
const { createChatCore } = require('../src/core');
const { createChatServer } = require('../server');
const { signHs256 } = require('../src/identity');
const { createInitialState, reduce } = require('../client/state');
const { parseServerEvent } = require('../client/protocol');
const { openWebSocket } = require('./helpers/raw-websocket');

const SECRET = 'identity-secret-key-32-chars-min';
const TOKEN = 'a'.repeat(64);

function createHarness(options = {}) {
  let sequence = 0;
  const config = {
    ...DEFAULTS,
    ...options,
    identity: options.identity || {
      guests: true,
      audience: 'pavilo',
      clockSkewSec: 60,
      issuers: [{ id: 'app', alg: 'HS256', secret: SECRET }]
    },
    channels: options.channels || DEFAULTS.channels.map((channel) => ({ ...channel }))
  };
  const core = createChatCore(config, {
    now: () => 1_700_000_000_000,
    randomId: (prefix) => `${prefix}_${String(++sequence).padStart(16, '0')}`,
    randomResumeToken: () => `resume-${String(++sequence).padStart(12, '0')}`,
    randomAvatarSeed: () => 7,
    log() {}
  });
  return { core };
}

function join(core, peerId, command = {}) {
  assert.equal(core.connect(peerId, '192.0.2.40'), true);
  const result = core.dispatch(peerId, {
    type: 'join',
    protocolVersion: 4,
    username: '访客',
    clientSessionId: `session-${peerId}-01`,
    channelId: 'general',
    avatarSeed: 3,
    ...command
  });
  if (result.accepted) core.completeSync(peerId);
  return result;
}

function token(sub = 'user-1', nowMs = 1_700_000_000_000) {
  const nowSec = Math.floor(nowMs / 1000);
  return signHs256({
    iss: 'app', aud: 'pavilo', sub, name: '北岸的猫', channels: ['general'],
    iat: nowSec, exp: nowSec + 600
  }, SECRET);
}

test('memory mode refuses reports and a denied stable identity', () => {
  const { core } = createHarness({ userDenyList: ['user-1'] });
  const guest = join(core, 'guest');
  assert.equal(guest.accepted, true);
  assert.equal(guest.effects.find((effect) => effect.kind === 'initial').payloads[0].governance, undefined);
  const sent = core.dispatch('guest', {
    type: 'message', clientMessageId: 'govern-memory-0001', kind: 'text', text: 'hello'
  });
  const message = sent.effects.find((effect) => effect.payload?.type === 'message').payload.message;
  const report = core.dispatch('guest', { type: 'report', messageId: message.id });
  assert.equal(report.error.code, 'GOVERNANCE_UNAVAILABLE');

  const denied = join(core, 'denied', { identityToken: token('user-1') });
  assert.equal(denied.error.code, 'USER_DENIED');
  const closed = denied.effects.find((effect) => effect.kind === 'close');
  assert.equal(closed.code, 4011);
  assert.equal(closed.reason, 'user_denied');
});

test('a tombstone hides the body and reply preview from later readers', () => {
  const { core } = createHarness();
  const alice = join(core, 'alice', { username: 'Alice' });
  assert.equal(alice.accepted, true);
  const sent = core.dispatch('alice', {
    type: 'message', clientMessageId: 'govern-body-00001', kind: 'text', text: 'secret text'
  });
  const original = sent.effects.find((effect) => effect.payload?.type === 'message').payload.message;
  const reply = core.dispatch('alice', {
    type: 'message', clientMessageId: 'govern-reply-0001', kind: 'text', text: 'quoted', replyTo: original.id
  });
  const replyMessage = reply.effects.find((effect) => effect.payload?.type === 'message').payload.message;
  assert.equal(replyMessage.replyTo.text, 'secret text');

  const removed = core.removeMessage('general', original.id);
  assert.equal(removed.ok, true);
  assert.equal(removed.message.removed, true);
  assert.equal(removed.message.text, undefined);

  const reaction = core.dispatch('alice', { type: 'reaction', messageId: original.id, emoji: '👍', active: true });
  assert.equal(reaction.error.code, 'MESSAGE_REMOVED');
  const quoted = core.dispatch('alice', {
    type: 'message', clientMessageId: 'govern-again-0001', kind: 'text', text: 'again', replyTo: original.id
  });
  assert.equal(quoted.error.code, 'MESSAGE_REMOVED');

  const reader = join(core, 'reader', { username: 'Reader' });
  assert.equal(reader.accepted, true);
  const history = reader.effects.find((effect) => effect.kind === 'initial').payloads
    .filter((payload) => payload.type === 'history')
    .flatMap((payload) => payload.messages);
  const tombstone = history.find((message) => message.id === original.id);
  const quote = history.find((message) => message.id === replyMessage.id);
  assert.equal(tombstone.removed, true);
  assert.equal(tombstone.text, undefined);
  assert.deepEqual(quote.replyTo, { id: original.id, removed: true });
  assert.equal(parseServerEvent({ type: 'messageRemoved', channelId: 'general', messageId: original.id, message: tombstone }).type, 'messageRemoved');
});

test('client state replaces a removed message and its quotes', () => {
  const state = {
    ...createInitialState(),
    channelId: 'general',
    room: { ...createInitialState().room, epoch: 'epoch-one' },
    messages: [
      { id: 'm1', kind: 'text', text: 'secret', author: { id: 'u1', username: 'A' }, createdAt: 1, replyTo: null, reactions: {} },
      { id: 'm2', kind: 'text', text: 'see', author: { id: 'u2', username: 'B' }, createdAt: 2, replyTo: { id: 'm1', username: 'A', kind: 'text', text: 'secret' }, reactions: {} }
    ]
  };
  const next = reduce(state, {
    type: 'messageRemoved',
    roomEpoch: 'epoch-one',
    messageId: 'm1',
    message: { id: 'm1', author: state.messages[0].author, createdAt: 1, removed: true }
  });
  assert.equal(next.messages[0].removed, true);
  assert.equal(next.messages[0].text, undefined);
  assert.deepEqual(next.messages[1].replyTo, { id: 'm1', removed: true });
});

test('the operator console closes a report by removing the message', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-governance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = createChatServer({
    host: '127.0.0.1',
    operator: { token: TOKEN },
    storage: { driver: 'sqlite', sqlite: { path: path.join(directory, 'pavilo.db'), engine: 'auto', retentionDays: 30 } },
    identity: {
      guests: true,
      audience: 'pavilo',
      clockSkewSec: 60,
      issuers: [{ id: 'app', alg: 'HS256', secret: SECRET }]
    }
  });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  const origin = `http://127.0.0.1:${address.port}`;
  const client = await openWebSocket({ port: address.port });
  t.after(() => client.close());
  client.sendJson({
    type: 'join', protocolVersion: 4, username: '北岸的猫', identityToken: token('user-9', Date.now()),
    clientSessionId: 'session-govern-0001', channelId: 'general'
  });
  const start = await client.nextJson((payload) => payload.type === 'stateStart');
  assert.equal(start.governance, true);
  await client.nextJson((payload) => payload.type === 'historyEnd');
  client.sendJson({ type: 'message', clientMessageId: 'govern-live-00001', kind: 'text', text: '请删掉' });
  const posted = await client.nextJson((payload) => payload.type === 'message');
  client.sendJson({ type: 'report', messageId: posted.message.id, reason: '不合适' });
  const ack = await client.nextJson((payload) => payload.type === 'reportReceived' || payload.type === 'error');
  assert.equal(ack.messageId, posted.message.id);

  const login = await fetch(`${origin}/admin/api/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN })
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' };
  const people = await (await fetch(`${origin}/admin/api/people`, { headers })).json();
  assert.equal(people.reports.length, 1);
  const stored = await (await fetch(`${origin}/admin/api/people/${encodeURIComponent(start.self.id)}/messages?limit=50`, { headers })).json();
  assert.equal(stored.messages.length, 1);
  assert.equal(stored.messages[0].text, '请删掉');
  assert.equal(people.reports[0].excerpt, '请删掉');
  assert.equal(people.reports[0].reporterUserKey, 'user-9');

  const removed = await fetch(`${origin}/admin/api/reports/${encodeURIComponent(people.reports[0].id)}/remove`, {
    method: 'POST', headers, body: '{}'
  });
  assert.equal(removed.status, 200);
  const removedBody = await removed.json();
  assert.deepEqual(removedBody.reports, []);
  assert.ok(removedBody.log.some((entry) => entry.action === 'message-remove'));
  const event = await client.nextJson((payload) => payload.type === 'messageRemoved' || payload.type === 'error');
  assert.equal(event.type, 'messageRemoved', JSON.stringify(event));
  assert.equal(event.message.removed, true);
  assert.equal(event.message.text, undefined);

  const denied = await fetch(`${origin}/admin/api/moderation`, {
    method: 'PUT', headers, body: JSON.stringify({ userDenyList: ['user-9'] })
  });
  assert.equal(denied.status, 200);
  const close = await client.waitForClose();
  assert.equal(close.code, 4011);
  assert.equal(close.reason, 'user_denied');
  const after = await (await fetch(`${origin}/admin/api/people`, { headers })).json();
  assert.deepEqual(after.moderation.userDenyList, ['user-9']);
  assert.ok(after.log.some((entry) => entry.action === 'user-deny-save'));
});
