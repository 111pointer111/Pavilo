'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createChatServer, PROTOCOL_VERSION } = require('../server');
const { openWebSocket } = require('./helpers/raw-websocket');

async function startServer(t, options = {}) {
  const app = createChatServer({ host: '127.0.0.1', ...options });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  return { app, port: address.port, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function join(client, {
  username = 'Alice',
  clientSessionId = 'session-alice-0001',
  avatarSeed = 17
} = {}) {
  client.sendJson({ type: 'join', protocolVersion: PROTOCOL_VERSION, username, clientSessionId, avatarSeed });
  const stateStart = await client.nextJson();
  const history = await client.nextJson();
  const historyEnd = await client.nextJson();
  assert.equal(stateStart.type, 'stateStart');
  assert.equal(history.type, 'history');
  assert.equal(historyEnd.type, 'historyEnd');
  return { stateStart, history, historyEnd };
}

test('serves the room, health, and room metadata over GET and HEAD', async (t) => {
  const { app, baseUrl, port } = await startServer(t);

  const index = await fetch(`${baseUrl}/`);
  const indexBody = await index.text();
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html;/);
  assert.match(index.headers.get('cache-control'), /no-store/);
  assert.ok(indexBody.length > 100);

  const indexHead = await fetch(`${baseUrl}/index.html`, { method: 'HEAD' });
  assert.equal(indexHead.status, 200);
  assert.equal(await indexHead.text(), '');
  assert.equal(Number(indexHead.headers.get('content-length')), Buffer.byteLength(indexBody));

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    users: 0,
    messages: 0,
    roomBytes: 0,
    clients: 0,
    ephemeral: true
  });
  const healthHead = await fetch(`${baseUrl}/healthz`, { method: 'HEAD' });
  assert.equal(healthHead.status, 200);
  assert.equal(await healthHead.text(), '');
  assert.ok(Number(healthHead.headers.get('content-length')) > 0);

  const roomInfo = await fetch(`${baseUrl}/room-info`);
  assert.equal(roomInfo.status, 200);
  const metadata = await roomInfo.json();
  assert.equal(metadata.protocolVersion, PROTOCOL_VERSION);
  assert.equal(metadata.roomEpoch, app.roomEpoch);
  assert.equal(metadata.localUrl, `http://localhost:${port}`);
  assert.equal(metadata.ephemeral, true);
  assert.ok(Array.isArray(metadata.lanUrls));

  const roomInfoHead = await fetch(`${baseUrl}/room-info`, { method: 'HEAD' });
  assert.equal(roomInfoHead.status, 200);
  assert.equal(await roomInfoHead.text(), '');
  assert.ok(Number(roomInfoHead.headers.get('content-length')) > 0);
});

test('protocol v2 sends stateStart, history, and historyEnd in order', async (t) => {
  const { app, port } = await startServer(t);
  const client = await openWebSocket({ port });

  const initial = await join(client);
  assert.equal(initial.stateStart.protocolVersion, PROTOCOL_VERSION);
  assert.equal(initial.stateStart.roomEpoch, app.roomEpoch);
  assert.equal(initial.stateStart.latestSeq, 0);
  assert.deepEqual(initial.stateStart.capabilities, [
    'ack',
    'historyChunks',
    'roomEpoch',
    'reconnect',
    'reactions',
    'typingLease'
  ]);
  assert.equal(initial.stateStart.self.username, 'Alice');
  assert.deepEqual(initial.stateStart.users, [initial.stateStart.self]);
  assert.equal(initial.history.roomEpoch, app.roomEpoch);
  assert.deepEqual(initial.history.messages, []);
  assert.deepEqual(initial.historyEnd, { type: 'historyEnd', roomEpoch: app.roomEpoch, latestSeq: 0 });
});

test('accepted messages receive an ACK and a canonical room echo', async (t) => {
  const { app, port } = await startServer(t);
  const client = await openWebSocket({ port });
  const { stateStart } = await join(client);
  const clientMessageId = 'message-ack-0001';

  client.sendJson({
    type: 'message',
    clientMessageId,
    kind: 'text',
    text: '  hello\r\nworld  '
  });
  const ack = await client.nextJson();
  const event = await client.nextJson();

  assert.equal(ack.type, 'ack');
  assert.equal(ack.clientMessageId, clientMessageId);
  assert.equal(ack.seq, 1);
  assert.match(ack.messageId, /^m1_/);
  assert.equal(event.type, 'message');
  assert.equal(event.roomEpoch, app.roomEpoch);
  assert.equal(event.message.id, ack.messageId);
  assert.equal(event.message.clientMessageId, clientMessageId);
  assert.equal(event.message.seq, ack.seq);
  assert.equal(event.message.createdAt, ack.createdAt);
  assert.equal(event.message.kind, 'text');
  assert.equal(event.message.text, 'hello\nworld');
  assert.deepEqual(event.message.author, stateStart.self);
  assert.equal(event.message.replyTo, null);
  assert.deepEqual(event.message.reactions, {});
  assert.equal(app.state().messages, 1);
});

test('same message ID deduplicates identical content and rejects conflicting content', async (t) => {
  const { app, port } = await startServer(t);
  const client = await openWebSocket({ port });
  await join(client);
  const command = {
    type: 'message',
    clientMessageId: 'message-dedupe-0001',
    kind: 'text',
    text: 'send exactly once'
  };

  client.sendJson(command);
  const firstAck = await client.nextJson((payload) => payload.type === 'ack');
  await client.nextJson((payload) => payload.type === 'message');

  client.sendJson(command);
  const duplicateAck = await client.nextJson();
  assert.deepEqual(duplicateAck, firstAck);
  assert.deepEqual(app.state(), {
    clients: 1,
    sessions: 1,
    messages: 1,
    roomBytes: app.state().roomBytes,
    latestSeq: 1
  });

  client.sendJson({ ...command, text: 'different content' });
  const conflict = await client.nextJson();
  assert.deepEqual(conflict, {
    type: 'error',
    code: 'MESSAGE_ID_CONFLICT',
    message: '消息标识已用于其他内容，请重新发送。',
    clientMessageId: command.clientMessageId
  });
  assert.equal(app.state().messages, 1);
  assert.equal(app.state().latestSeq, 1);
});

test('validation errors preserve the client message correlation ID', async (t) => {
  const { port } = await startServer(t);
  const client = await openWebSocket({ port });
  await join(client);
  const clientMessageId = 'message-invalid-0001';

  client.sendJson({ type: 'message', clientMessageId, kind: 'text', text: ' \r\n ' });
  const error = await client.nextJson();
  assert.deepEqual(error, {
    type: 'error',
    code: 'EMPTY_MESSAGE',
    message: '写点内容再发送。',
    clientMessageId
  });
});

test('reconnecting with a clientSessionId retains the same public identity', async (t) => {
  const { app, port } = await startServer(t, { sessionLeaseMs: 1000 });
  const clientSessionId = 'session-reconnect-0001';
  const first = await openWebSocket({ port });
  const firstState = await join(first, { username: 'Reconnect', clientSessionId, avatarSeed: 123 });
  await first.destroy();

  const second = await openWebSocket({ port });
  const secondState = await join(second, { username: 'Reconnect', clientSessionId, avatarSeed: 999 });

  assert.deepEqual(secondState.stateStart.self, firstState.stateStart.self);
  assert.deepEqual(secondState.stateStart.users, [firstState.stateStart.self]);
  assert.equal(app.state().sessions, 1);
});

test('reaction updates are idempotent and expose canonical counts', async (t) => {
  const { port } = await startServer(t);
  const client = await openWebSocket({ port });
  const { stateStart } = await join(client);

  client.sendJson({
    type: 'message',
    clientMessageId: 'message-reaction-0001',
    kind: 'text',
    text: 'react here'
  });
  const ack = await client.nextJson((payload) => payload.type === 'ack');
  await client.nextJson((payload) => payload.type === 'message');
  const reaction = { type: 'reaction', messageId: ack.messageId, emoji: '👍', active: true };

  client.sendJson(reaction);
  const firstActive = await client.nextJson();
  assert.deepEqual(firstActive.reactions, {
    '👍': { count: 1, userIds: [stateStart.self.id] }
  });

  client.sendJson(reaction);
  const secondActive = await client.nextJson();
  assert.deepEqual(secondActive.reactions, firstActive.reactions);

  client.sendJson({ ...reaction, active: false });
  const firstInactive = await client.nextJson();
  assert.deepEqual(firstInactive.reactions, {});

  client.sendJson({ ...reaction, active: false });
  const secondInactive = await client.nextJson();
  assert.deepEqual(secondInactive.reactions, {});
});

test('rejects WebSocket upgrades from a foreign Origin', async (t) => {
  const { port } = await startServer(t);

  await assert.rejects(
    openWebSocket({ port, origin: 'https://attacker.example' }),
    (error) => error.statusCode === 403
  );
});

test('a fresh server instance has a new room and an empty message sequence', async (t) => {
  const firstServer = await startServer(t);
  const firstClient = await openWebSocket({ port: firstServer.port });
  await join(firstClient, { clientSessionId: 'session-reset-one' });
  firstClient.sendJson({
    type: 'message',
    clientMessageId: 'message-reset-0001',
    kind: 'text',
    text: 'temporary'
  });
  const firstAck = await firstClient.nextJson((payload) => payload.type === 'ack');
  await firstClient.nextJson((payload) => payload.type === 'message');
  assert.equal(firstAck.seq, 1);
  assert.equal(firstServer.app.state().messages, 1);
  const oldEpoch = firstServer.app.roomEpoch;
  await firstServer.app.stop();

  const secondServer = await startServer(t);
  const secondClient = await openWebSocket({ port: secondServer.port });
  const freshState = await join(secondClient, { clientSessionId: 'session-reset-two' });
  assert.notEqual(secondServer.app.roomEpoch, oldEpoch);
  assert.equal(freshState.stateStart.latestSeq, 0);
  assert.deepEqual(freshState.history.messages, []);
  assert.equal(freshState.historyEnd.latestSeq, 0);
  assert.equal(secondServer.app.state().messages, 0);

  secondClient.sendJson({
    type: 'message',
    clientMessageId: 'message-reset-0002',
    kind: 'text',
    text: 'first in the new room'
  });
  const freshAck = await secondClient.nextJson((payload) => payload.type === 'ack');
  assert.equal(freshAck.seq, 1);
});

test('delivers live messages after the initial history terminator', async (t) => {
  const { port } = await startServer(t, { maxJsonBytes: 700 });
  const sender = await openWebSocket({ port });
  await join(sender, { username: 'Sender', clientSessionId: 'session-sync-sender' });
  for (let index = 0; index < 7; index += 1) {
    sender.sendJson({
      type: 'message',
      clientMessageId: `message-history-${String(index).padStart(4, '0')}`,
      kind: 'text',
      text: `history ${index} ${'x'.repeat(120)}`
    });
    await sender.nextJson((payload) => payload.type === 'ack');
    await sender.nextJson((payload) => payload.type === 'message');
  }

  const joining = await openWebSocket({ port });
  joining.sendJson({ type: 'join', protocolVersion: PROTOCOL_VERSION, username: 'Joiner', clientSessionId: 'session-sync-joiner', avatarSeed: 5 });
  const start = await joining.nextJson((payload) => payload.type === 'stateStart');
  assert.equal(start.type, 'stateStart');
  sender.sendJson({ type: 'message', clientMessageId: 'message-during-sync', kind: 'text', text: 'arrived during sync' });
  await sender.nextJson((payload) => payload.type === 'ack');
  await sender.nextJson((payload) => payload.type === 'message');

  const received = [];
  while (!received.some((payload) => payload.type === 'historyEnd')) received.push(await joining.nextJson());
  const live = await joining.nextJson((payload) => payload.type === 'message');
  assert.equal(live.message.text, 'arrived during sync');
  assert.equal(received.some((payload) => payload.type === 'message'), false);
});

test('closes clients that do not join before the configured deadline', async (t) => {
  const { port } = await startServer(t, { joinTimeoutMs: 50 });
  const client = await openWebSocket({ port });

  const closed = await client.waitForClose(1000);
  assert.deepEqual(closed, { code: 1008, reason: 'join timeout', hadFrame: true });
});

test('closes clients that do not answer heartbeat pings', async (t) => {
  const { port } = await startServer(t, {
    heartbeatIntervalMs: 20,
    heartbeatTimeoutMs: 45,
    joinTimeoutMs: 1000
  });
  const client = await openWebSocket({ port, autoPong: false });
  await join(client);

  const closed = await client.waitForClose(1000);
  assert.equal(closed.code, 1001);
  assert.equal(closed.reason, 'heartbeat timeout');
});

test('exchanges ping and pong control frames during heartbeat operation', async (t) => {
  const { port } = await startServer(t, {
    heartbeatIntervalMs: 30,
    heartbeatTimeoutMs: 200,
    joinTimeoutMs: 1000
  });
  const client = await openWebSocket({ port });
  await join(client);

  const heartbeatPing = await client.nextFrame((frame) => frame.opcode === 0x9, 1000);
  assert.equal(heartbeatPing.payload.length, 0);

  client.sendFrame('probe', 0x9);
  const pong = await client.nextFrame((frame) => frame.opcode === 0xA, 1000);
  assert.equal(pong.payload.toString(), 'probe');
});
