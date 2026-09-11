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
  client.sendJson({ type: 'join', protocolVersion: 3, username, channelId, clientSessionId: token });
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
  assert.equal((await a.client.nextJson()).code, 'CHANNEL_FULL');
  const event = await post(a.client, 'message-still-source', 'still here');
  assert.equal(event.roomEpoch, a.initial.roomEpoch);
  const denied = await openWebSocket({ port });
  denied.sendJson({ type: 'join', protocolVersion: 3, username: 'Denied', channelId: 'disabled' });
  assert.equal((await denied.nextJson()).code, 'CHANNEL_UNAVAILABLE');
});

test('global user capacity includes disconnect leases but permits resume and releases intentional leave', async (t) => {
  const { port } = await setup(t, { maxUsers: 1, sessionLeaseMs: 5000 });
  const a = await member(port, 'Alice');
  await a.client.destroy();
  const denied = await openWebSocket({ port });
  denied.sendJson({ type: 'join', protocolVersion: 3, username: 'Bob', channelId: 'other' });
  assert.equal((await denied.nextJson()).code, 'SERVER_FULL');
  const resumed = await member(port, 'Alice', 'general', a.initial.resumeToken);
  resumed.client.sendJson({ type: 'leave' });
  await resumed.client.waitForClose();
  await resumed.client.destroy();
  // A subsequent handshake is processed after the previous socket's teardown.
  const b = await member(port, 'Bob', 'other');
  assert.equal(b.initial.self.username, 'Bob');
});

test('v2 still receives chunked history, v1 gets legacy state, non-general default works', async (t) => {
  const { port } = await setup(t, { defaultChannelId: 'other' });
  const v2 = await openWebSocket({ port });
  v2.sendJson({ type: 'join', protocolVersion: 2, username: 'Two', clientSessionId: 'session-protocol-two' });
  assert.equal((await state(v2)).channelId, 'other');
  const v1 = await openWebSocket({ port });
  v1.sendJson({ type: 'join', username: 'One' });
  assert.equal((await v1.nextJson()).type, 'state');
});

test('public metadata is allowlisted and private files or vendor symlinks cannot be downloaded', async (t) => {
  const { url } = await setup(t, { allowedOrigins: ['https://private.example'], exposeMemberIps: false });
  const metadata = await (await fetch(`${url}/room-info`)).json();
  assert.deepEqual(Object.keys(metadata).sort(), ['channels', 'defaultChannelId', 'ephemeral', 'lanUrls', 'limits', 'localUrl', 'protocolVersion', 'roomEpoch', 'roomTitle'].sort());
  assert.ok(!JSON.stringify(metadata).includes('private.example'));
  for (const file of ['/pavilo.yaml', '/pavilo.example.yaml', '/config.js', '/server.js', '/.env', '/package.json', '/vendor/../config.js', '/vendor/%2e%2e/config.js']) {
    for (const method of ['GET', 'HEAD']) assert.notEqual((await fetch(`${url}${file}`, { method })).status, 200, `${method} ${file}`);
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
