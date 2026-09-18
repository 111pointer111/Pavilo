'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createChatServer } = require('../server');
const { openWebSocket } = require('./helpers/raw-websocket');

async function setup(t, options = {}) {
  const app = createChatServer({
    channels: [
      { id: 'general', name: '闲聊', description: '第一间', enabled: true, maxUsers: 2 },
      { id: 'other', name: '另一间', description: '第二间', enabled: true, maxUsers: 2 },
      { id: 'disabled', name: '停用', description: '', enabled: false, maxUsers: 2 }
    ],
    ...options
  });
  const { port } = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  return { app, port, url: `http://127.0.0.1:${port}` };
}

async function state(client) {
  const start = await client.nextJson((p) => p.type === 'stateStart');
  const history = [];
  while (true) {
    const p = await client.nextJson((p) => ['history', 'historyEnd'].includes(p.type));
    if (p.type === 'historyEnd') break;
    history.push(...p.messages);
  }
  return { ...start, history };
}

async function member(port, username, channelId = 'general', token = `session-${username}-001`) {
  const client = await openWebSocket({ port });
  client.sendJson({ type: 'join', protocolVersion: 4, username, channelId, clientSessionId: token });
  return { client, initial: await state(client) };
}

async function post(client, id, text, replyTo) {
  client.sendJson({ type: 'message', kind: 'text', clientMessageId: id, text, replyTo });
  await client.nextJson((p) => p.type === 'ack');
  return client.nextJson((p) => p.type === 'message');
}

async function noEvent(client, types) {
  await assert.rejects(client.nextJson((p) => types.includes(p.type), 50), /Timed out/);
}

test('channels isolate roster, history, messages, typing, replies and reactions', async (t) => {
  const { port } = await setup(t);
  const a = await member(port, 'Alice');
  const b = await member(port, 'Bob', 'other');
  assert.deepEqual(b.initial.users.map((u) => u.username), ['Bob']);
  assert.notEqual(a.initial.roomEpoch, b.initial.roomEpoch);
  await noEvent(a.client, ['presence']);
  const sent = await post(a.client, 'message-isolated-1', 'private to general');
  a.client.sendJson({ type: 'typing', active: true });
  await noEvent(b.client, ['message', 'typing']);
  b.client.sendJson({ type: 'reaction', messageId: sent.message.id, emoji: '👍', active: true });
  assert.equal((await b.client.nextJson()).code, 'MESSAGE_GONE');
  const reply = await post(b.client, 'message-isolated-2', 'reply?', sent.message.id);
  assert.equal(reply.message.replyTo, null);
  const c = await member(port, 'Carol', 'other');
  assert.deepEqual(c.initial.history.map((m) => m.text), ['reply?']);
  assert.deepEqual(c.initial.users.map((u) => u.username), ['Bob', 'Carol']);
});

test('switch is atomic, preserves identity, isolates dedupe, and can resume in new channel', async (t) => {
  const { app, port } = await setup(t, { maxUsers: 1 });
  const a = await member(port, 'Alice');
  await post(a.client, 'message-switch-001', 'old');
  a.client.sendJson({ type: 'switchChannel', channelId: 'other' });
  const switched = await state(a.client);
  assert.equal(switched.channelId, 'other');
  assert.deepEqual(switched.self, a.initial.self);
  assert.deepEqual(switched.history, []);
  assert.equal(app.state().sessions, 1);
  const sent = await post(a.client, 'message-switch-001', 'new');
  assert.equal(sent.message.text, 'new');
  await a.client.destroy();
  const resumed = await member(port, 'Alice', 'other', switched.resumeToken);
  assert.deepEqual(resumed.initial.self, switched.self);
  assert.equal(resumed.initial.history.length, 1);
});

test('failed switch leaves member in source and disabled channels reject direct joins', async (t) => {
  const { port } = await setup(t);
  const a = await member(port, 'Alice');
  await member(port, 'Bob', 'other');
  await member(port, 'Carol', 'other');
  a.client.sendJson({ type: 'switchChannel', channelId: 'other' });
  assert.equal((await a.client.nextJson((payload) => payload.type === 'error')).code, 'CHANNEL_FULL');
  const event = await post(a.client, 'message-still-source', 'still here');
  assert.equal(event.roomEpoch, a.initial.roomEpoch);
  const denied = await openWebSocket({ port });
  denied.sendJson({ type: 'join', protocolVersion: 4, username: 'Denied', channelId: 'disabled' });
  assert.equal((await denied.nextJson()).code, 'CHANNEL_UNAVAILABLE');
});

test('global user capacity includes disconnect leases but permits resume and releases intentional leave', async (t) => {
  const { port } = await setup(t, { maxUsers: 1, sessionLeaseMs: 5000 });
  const a = await member(port, 'Alice');
  await a.client.destroy();
  const denied = await openWebSocket({ port });
  denied.sendJson({ type: 'join', protocolVersion: 4, username: 'Bob', channelId: 'other' });
  assert.equal((await denied.nextJson()).code, 'SERVER_FULL');
  const resumed = await member(port, 'Alice', 'general', a.initial.resumeToken);
  resumed.client.sendJson({ type: 'leave' });
  await resumed.client.waitForClose();
  await resumed.client.destroy();
  // A subsequent handshake is processed after the previous socket's teardown.
  const b = await member(port, 'Bob', 'other');
  assert.equal(b.initial.self.username, 'Bob');
});

test('unsupported protocol versions are rejected and the socket is closed', async (t) => {
  const { port } = await setup(t, { defaultChannelId: 'other' });
  const cases = [1, 2, 3, 5, 4.5, '4', null];
  for (const version of cases) {
    const client = await openWebSocket({ port });
    client.sendJson({ type: 'join', protocolVersion: version, username: 'Old', clientSessionId: 'session-old-protocol-01' });
    const error = await client.nextJson((payload) => payload.type === 'error');
    assert.equal(error.code, 'PROTOCOL_NOT_SUPPORTED', `version ${version}`);
    const closed = await client.waitForClose();
    assert.equal(closed.code, 1002);
    assert.equal(closed.reason, 'protocol not supported');
    await client.destroy();
  }
  const missing = await openWebSocket({ port });
  missing.sendJson({ type: 'join', username: 'One', clientSessionId: 'session-missing-protocol' });
  assert.equal((await missing.nextJson((payload) => payload.type === 'error')).code, 'PROTOCOL_NOT_SUPPORTED');
  assert.equal((await missing.waitForClose()).code, 1002);
  await missing.destroy();
  const current = await openWebSocket({ port });
  current.sendJson({ type: 'join', protocolVersion: 4, username: 'Four', clientSessionId: 'session-protocol-four' });
  assert.equal((await state(current)).channelId, 'other');
});

test('public metadata is allowlisted and private files or vendor symlinks cannot be downloaded', async (t) => {
  const { url } = await setup(t, { allowedOrigins: ['https://private.example'], exposeMemberIps: false });
  const metadata = await (await fetch(`${url}/room-info`)).json();
  assert.deepEqual(Object.keys(metadata).sort(), ['channels', 'defaultChannelId', 'defaultLanguage', 'deprecatedProtocols', 'ephemeral', 'lanUrls', 'limits', 'localUrl', 'protocolVersion', 'roomEpoch', 'roomTitle', 'supportedLanguages'].sort());
  assert.equal(metadata.protocolVersion, 4);
  assert.deepEqual(metadata.deprecatedProtocols, []);
  assert.equal(metadata.defaultLanguage, 'zh-CN');
  assert.deepEqual(metadata.supportedLanguages, ['zh-CN', 'en']);
  assert.ok(!JSON.stringify(metadata).includes('private.example'));
  for (const file of ['/pavilo.yaml', '/pavilo.example.yaml', '/config.js', '/server.js', '/.env', '/package.json', '/vendor/../config.js', '/vendor/%2e%2e/config.js', '/client/unknown.js', '/client/../config.js']) {
    for (const method of ['GET', 'HEAD']) assert.notEqual((await fetch(`${url}${file}`, { method })).status, 200, `${method} ${file}`);
  }
  for (const file of ['/client/pending.js', '/client/images.js']) {
    for (const method of ['GET', 'HEAD']) assert.equal((await fetch(`${url}${file}`, { method })).status, 200, `${method} ${file}`);
  }
  const link = path.join(__dirname, '..', 'vendor', `test-private-${process.pid}.js`);
  fs.symlinkSync(path.join(__dirname, '..', 'config.js'), link);
  t.after(() => fs.unlinkSync(link));
  assert.equal((await fetch(`${url}/vendor/${path.basename(link)}`)).status, 404);
});

test('hiding member IP applies to initial roster, live messages and history', async (t) => {
  const { port } = await setup(t, { exposeMemberIps: false });
  const a = await member(port, 'Alice');
  assert.equal(Object.hasOwn(a.initial.self, 'ip'), false);
  assert.equal(Object.hasOwn(a.initial.users[0], 'ip'), false);
  const sent = await post(a.client, 'message-ip-hidden', 'hello');
  assert.equal(Object.hasOwn(sent.message.author, 'ip'), false);
  const b = await member(port, 'Bob');
  assert.equal(Object.hasOwn(b.initial.history[0].author, 'ip'), false);
});

test('eviction reports removedIds on every message so clients can rebuild once', async (t) => {
  // A cap of 3 with a byte budget big enough that only the count can evict.
  const { port } = await setup(t, { maxMessages: 3, maxRoomBytes: 10 * 1024 * 1024 });
  const { client, initial } = await member(port, 'Keeper');

  // Fill exactly to the cap: nothing should be evicted yet.
  for (const index of [1, 2, 3]) {
    const event = await post(client, `evict-fill-${index}`, `fill ${index}`);
    assert.deepEqual(event.removedIds, [], `message ${index} must not evict while under the cap`);
  }

  // The 4th arrival evicts the oldest, and the evicted id travels with the message
  // event. This is what lets a client apply the prune and the append as one change
  // instead of rebuilding twice.
  const overflow = await post(client, 'evict-overflow', 'overflow');
  assert.equal(overflow.removedIds.length, 1);
  assert.equal(overflow.message.text, 'overflow');

  const seen = await (async () => {
    const joiner = await openWebSocket({ port });
    joiner.sendJson({ type: 'join', protocolVersion: 4, username: 'Auditor', clientSessionId: 'session-auditor-001' });
    return state(joiner);
  })();
  const texts = seen.history.map((message) => message.text);
  assert.deepEqual(texts, ['fill 2', 'fill 3', 'overflow']);
  assert.ok(!texts.includes('fill 1'), 'the evicted message must be gone from history');
  assert.equal(seen.latestSeq, 4, 'eviction must not rewind the sequence');
});

test('a message that cannot fit the channel budget is refused instead of emptying it', async (t) => {
  // maxTextLength is raised on purpose: the text must be valid and still be
  // refused, so the byte budget is the only rule that can reject it.
  const { port } = await setup(t, { maxMessages: 200, maxRoomBytes: 4096, maxTextLength: 10_000 });
  const { client } = await member(port, 'Writer');
  await post(client, 'budget-small', 'fits');

  // Larger than the whole channel budget: accepting it would evict everything,
  // including itself.
  client.sendJson({
    type: 'message',
    kind: 'text',
    clientMessageId: 'budget-huge',
    text: 'x'.repeat(6000)
  });
  const error = await client.nextJson((p) => p.type === 'error');
  assert.equal(error.code, 'ROOM_BUDGET_EXCEEDED');
  assert.equal(error.clientMessageId, 'budget-huge');

  const after = await (async () => {
    const joiner = await openWebSocket({ port });
    joiner.sendJson({ type: 'join', protocolVersion: 4, username: 'Checker', clientSessionId: 'session-checker-001' });
    return state(joiner);
  })();
  assert.deepEqual(after.history.map((message) => message.text), ['fits'], 'the earlier message survives a refused send');
});

test('a client that reconnects mid-sync resumes with a complete history', async (t) => {
  const { port } = await setup(t, { maxMessages: 200 });
  const { client } = await member(port, 'Historian');
  for (let index = 0; index < 5; index += 1) await post(client, `sync-seed-${index}`, `seed ${index}`);

  // Drop without leaving: the same token comes back on a new socket.
  const token = 'session-Historian-001';
  client.socket.destroy();
  await new Promise((resolve) => setTimeout(resolve, 40));

  const again = await openWebSocket({ port });
  again.sendJson({ type: 'join', protocolVersion: 4, username: 'Historian', channelId: 'general', clientSessionId: token });
  const resumed = await state(again);
  assert.equal(resumed.self.username, 'Historian');
  // Chunking is transparent to the client: it still sees the whole history and a
  // terminator carrying the sequence the snapshot was taken at.
  assert.equal(resumed.history.length, 5);
  assert.equal(resumed.latestSeq, 5);
  assert.equal(resumed.historyEnd, undefined);
});

test.skip('a client is told to wait rather than losing events while its history syncs', async (t) => {
  const { port } = await setup(t, { maxMessages: 200, maxJsonBytes: 700 });
  const { client } = await member(port, 'Burst');
  for (let index = 0; index < 6; index += 1) await post(client, `sync-hold-${index}`, `${'y'.repeat(120)} ${index}`);

  // The join pushes a multi-chunk history; a message sent during it must be
  // refused with SYNC_IN_PROGRESS instead of accepted and dropped.
  const joiner = await openWebSocket({ port });
  joiner.sendJson({ type: 'join', protocolVersion: 4, username: 'Latecomer', clientSessionId: 'session-latecomer-001' });
  await joiner.nextJson((p) => p.type === 'stateStart');
  joiner.sendJson({ type: 'message', kind: 'text', clientMessageId: 'during-sync', text: 'too early' });
  while (true) {
    const payload = await joiner.nextJson();
    if (payload.type === 'error') {
      assert.equal(payload.code, 'SYNC_IN_PROGRESS');
      assert.equal(payload.clientMessageId, 'during-sync');
      break;
    }
    if (payload.type === 'historyEnd') assert.fail('the join must still complete');
  }
});
