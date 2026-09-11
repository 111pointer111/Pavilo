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

// `app.state()` reflects socket teardown, which lands a tick or two after the
// client observes the close frame. Wait for the room to actually settle.
async function waitForState(app, predicate, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = app.state();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return app.state();
}

test('serves the room, health, and room metadata over GET and HEAD', async (t) => {
  const { app, baseUrl, port } = await startServer(t);

  const index = await fetch(`${baseUrl}/`);
  const indexBody = await index.text();
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html;/);
  assert.match(index.headers.get('cache-control'), /no-cache/);
  assert.ok(index.headers.get('etag'), 'index.html should expose an ETag so reloads can revalidate');
  assert.ok(indexBody.length > 100);

  // `/chat` is the address members keep in their history; a reload must land back
  // in the room rather than on a 404.
  const chat = await fetch(`${baseUrl}/chat`);
  assert.equal(chat.status, 200);
  assert.equal(await chat.text(), indexBody);

  const indexHead = await fetch(`${baseUrl}/index.html`, { method: 'HEAD' });
  assert.equal(indexHead.status, 200);
  assert.equal(await indexHead.text(), '');
  // `fetch` negotiates gzip and transparently decodes the body, so Content-Length
  // is the compressed size while `indexBody` is the decoded text. The two must
  // still agree on which encoding they agreed to use.
  assert.equal(Number(indexHead.headers.get('content-length')), Number(index.headers.get('content-length')));
  assert.equal(indexHead.headers.get('content-encoding'), index.headers.get('content-encoding'));

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

test('a resume token brings a reloaded page back as the same member', async (t) => {
  const { app, port } = await startServer(t);
  const clientSessionId = 'session-reload-0001';
  const first = await openWebSocket({ port });
  const firstState = await join(first, { username: 'Reloader', clientSessionId, avatarSeed: 4242 });
  const resumeToken = firstState.stateStart.resumeToken;
  assert.equal(typeof resumeToken, 'string');
  assert.equal(resumeToken, clientSessionId, 'the session key doubles as the resume token');
  await first.destroy();

  const second = await openWebSocket({ port });
  second.sendJson({
    type: 'join',
    protocolVersion: PROTOCOL_VERSION,
    username: 'Reloader',
    clientSessionId: 'session-reload-0002',
    resumeToken,
    avatarSeed: 999
  });
  const secondState = await second.nextJson();
  assert.equal(secondState.type, 'stateStart');
  assert.deepEqual(secondState.self, firstState.stateStart.self, 'identity survives the reload');
  assert.equal(secondState.resumeToken, resumeToken, 'the token carries forward');
  await second.nextJson((payload) => payload.type === 'history');
  await second.nextJson((payload) => payload.type === 'historyEnd');
  assert.equal(app.state().sessions, 1);
});

test('a member still on the roster wins its name over a name-only claim', async (t) => {
  const { port } = await startServer(t);
  const member = await openWebSocket({ port });
  await join(member, { username: 'Present', clientSessionId: 'session-present-0001' });

  const impostor = await openWebSocket({ port });
  impostor.sendJson({
    type: 'join',
    protocolVersion: PROTOCOL_VERSION,
    username: 'Present',
    clientSessionId: 'session-present-0002'
  });
  const error = await impostor.nextJson((payload) => payload.type === 'error');
  assert.equal(error.code, 'NAME_TAKEN');
});

test('a name cannot be taken while its session is only leased', async (t) => {
  const { app, port } = await startServer(t, { sessionLeaseMs: 60_000 });
  const clientSessionId = 'session-leaver-0001';
  const first = await openWebSocket({ port });
  const firstState = await join(first, { username: 'Leaver', clientSessionId });
  await first.destroy();
  // The socket is gone but the member still holds the name, so nobody else can claim
  // it and a stale "you left" presence is not announced yet.
  const settled = await waitForState(app, (state) => state.clients === 0);
  assert.equal(settled.sessions, 0);
  assert.equal(settled.clients, 0);

  const stranger = await openWebSocket({ port });
  stranger.sendJson({ type: 'join', protocolVersion: PROTOCOL_VERSION, username: 'Leaver', clientSessionId: 'session-stranger-01' });
  const error = await stranger.nextJson((payload) => payload.type === 'error');
  assert.equal(error.code, 'NAME_TAKEN');
  await stranger.destroy();

  // Reloading that same page comes back as the same member, not a new one.
  const second = await openWebSocket({ port });
  second.sendJson({
    type: 'join',
    protocolVersion: PROTOCOL_VERSION,
    username: 'Leaver',
    clientSessionId,
    resumeToken: firstState.stateStart.resumeToken
  });
  const secondState = await second.nextJson();
  assert.equal(secondState.type, 'stateStart');
  assert.deepEqual(secondState.self, firstState.stateStart.self, 'a reload is the same member');
  assert.equal(secondState.resumeToken, firstState.stateStart.resumeToken);
});

test('a known token with a different name is refused instead of silently restarting', async (t) => {
  const { port } = await startServer(t);
  const clientSessionId = 'session-conflict-0001';
  const first = await openWebSocket({ port });
  await join(first, { username: 'Original', clientSessionId });

  const other = await openWebSocket({ port });
  other.sendJson({
    type: 'join',
    protocolVersion: PROTOCOL_VERSION,
    username: 'SomeoneElse',
    clientSessionId,
    resumeToken: clientSessionId
  });
  const error = await other.nextJson((payload) => payload.type === 'error');
  assert.equal(error.code, 'SESSION_CONFLICT');
});

test('two tabs of the same member do not break each other', async (t) => {
  const { app, port } = await startServer(t);
  const clientSessionId = 'session-tabs-0001';
  const first = await openWebSocket({ port });
  const firstState = await join(first, { username: 'TwoTabs', clientSessionId, avatarSeed: 77 });

  const second = await openWebSocket({ port });
  second.sendJson({
    type: 'join',
    protocolVersion: PROTOCOL_VERSION,
    username: 'TwoTabs',
    clientSessionId,
    resumeToken: firstState.stateStart.resumeToken,
    avatarSeed: 77
  });
  const secondState = await second.nextJson();
  assert.equal(secondState.type, 'stateStart');
  assert.deepEqual(secondState.self, firstState.stateStart.self);
  assert.equal(app.state().sessions, 1, 'the roster keeps one entry for the member');
  assert.equal(app.state().clients, 2, 'both sockets stay open until the older one closes');
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

test('reactions only accept the six fixed emoji', async (t) => {
  const { port } = await startServer(t);
  const { REACTION_EMOJIS } = require('../server');
  const client = await openWebSocket({ port });
  const { stateStart } = await join(client);

  client.sendJson({
    type: 'message',
    clientMessageId: 'message-reaction-fixed-set',
    kind: 'text',
    text: 'react here too'
  });
  const ack = await client.nextJson((payload) => payload.type === 'ack');
  client.nextJson((payload) => payload.type === 'message');

  for (const emoji of REACTION_EMOJIS) {
    client.sendJson({ type: 'reaction', messageId: ack.messageId, emoji, active: true });
    const event = await client.nextJson((payload) => payload.type === 'reaction');
    assert.equal(event.reactions[emoji].count, 1, `${emoji} should be accepted`);
    assert.equal(event.reactions[emoji].userIds[0], stateStart.self.id);
  }

  const rejected = ['hello', '你好', '👨‍👩‍👧‍👦', '🇨🇳', '👍🏻', '1️⃣', ''];
  for (const emoji of rejected) {
    client.sendJson({ type: 'reaction', messageId: ack.messageId, emoji, active: true });
    const error = await client.nextJson((payload) => payload.type === 'error');
    assert.equal(error.code, 'INVALID_REACTION', JSON.stringify(emoji));
  }
});

test('serves vendored emoji picker assets without path traversal', async (t) => {
  const { baseUrl, port } = await startServer(t);
  const http = require('node:http');

  const picker = await fetch(`${baseUrl}/vendor/emoji-picker/picker.js`);
  assert.equal(picker.status, 200);
  assert.match(picker.headers.get('content-type'), /^text\/javascript/);
  assert.ok((await picker.text()).includes('customElements.define'));

  const data = await fetch(`${baseUrl}/vendor/emoji-picker/data.json`);
  assert.equal(data.status, 200);
  assert.match(data.headers.get('content-type'), /^application\/json/);
  assert.ok(data.headers.get('etag'), 'data.json should expose an ETag for the picker cache');
  assert.ok((await data.json()).length > 1000);

  // Raw request keeps `..` intact on the wire; the server must not serve source files.
  const rawPath = (path) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  const traversal = await rawPath('/vendor/../server.js');
  assert.notEqual(traversal.status, 200);
  assert.ok(!traversal.body.includes('createChatServer'));

  const missing = await fetch(`${baseUrl}/vendor/emoji-picker/nope.js`);
  assert.equal(missing.status, 404);
});

test('negotiates gzip for static assets without breaking identity clients', async (t) => {
  const { baseUrl } = await startServer(t);
  const http = require('node:http');

  // Raw request so the Accept-Encoding header is exactly what we set.
  const raw = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: Number(new URL(baseUrl).port), path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });

  const indexIdentity = await raw('/', { 'Accept-Encoding': 'identity' });
  assert.equal(indexIdentity.status, 200);
  assert.equal(indexIdentity.headers['content-encoding'], undefined);
  assert.equal(indexIdentity.body.length, Number(indexIdentity.headers['content-length']));
  assert.equal(indexIdentity.headers.vary, 'Accept-Encoding');

  const indexGzip = await raw('/', { 'Accept-Encoding': 'gzip' });
  assert.equal(indexGzip.status, 200);
  assert.equal(indexGzip.headers['content-encoding'], 'gzip');
  assert.equal(indexGzip.body.length, Number(indexGzip.headers['content-length']));
  assert.ok(indexGzip.body.length < indexIdentity.body.length, 'gzip should shrink the chat page');
  // The ETag identifies the resource, not the encoding; Vary is what keeps a
  // shared cache from crossing the two representations.
  assert.equal(indexGzip.headers.etag, indexIdentity.headers.etag);

  // `x-gzip` and a token inside a list must not be mistaken for plain `gzip`.
  const notGzip = await raw('/', { 'Accept-Encoding': 'identity, x-gzip' });
  assert.equal(notGzip.headers['content-encoding'], undefined);

  const vendorGzip = await raw('/vendor/lucide/icon-nodes.json', { 'Accept-Encoding': 'gzip' });
  assert.equal(vendorGzip.headers['content-encoding'], 'gzip');
  assert.ok(vendorGzip.body.length < 200_000, 'the icon set should compress to well under its 680 KB source');

  // Bodies too small to be worth the header are left alone.
  const tiny = await raw('/vendor/lucide/LICENSE', { 'Accept-Encoding': 'gzip' });
  assert.equal(tiny.status, 200);
  assert.equal(tiny.headers['content-encoding'], undefined);
});

test('serves the vendored Lucide icon set used by the interface', async (t) => {
  const { baseUrl } = await startServer(t);

  const module = await fetch(`${baseUrl}/vendor/lucide/index.js`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /^text\/javascript/);
  const source = await module.text();

  // Load the delivered module the way the browser does, then confirm the icons the
  // interface asks for actually produce drawable shapes.
  const context = { module: { exports: {} } };
  const load = new Function('module', 'globalThis', `${source}\nreturn module.exports;`);
  const createIcon = load(context.module, context.module.exports);
  assert.equal(typeof createIcon, 'function');
  assert.ok(createIcon.names.length > 1000, `expected a full icon set, got ${createIcon.names.length}`);

  const used = [...new Set([...source.matchAll(/data-icon="([a-z0-9-]+)"/g)].map((match) => match[1]))];
  const index = await fetch(`${baseUrl}/`);
  const indexBody = await index.text();
  const requested = [...new Set([...indexBody.matchAll(/data-icon="([a-z0-9-]+)"/g), ...indexBody.matchAll(/iconMarkup\('([a-z0-9-]+)'/g)].map((match) => match[1]))];
  assert.ok(requested.length >= 15, `expected the interface to use Lucide icons, saw ${requested.length}`);
  for (const name of requested) {
    const markup = createIcon(name);
    assert.ok(markup.includes('<'), `icon "${name}" renders nothing`);
    assert.match(markup, /^<(path|circle|rect|line|ellipse|polyline|polygon)\b/, `icon "${name}" uses an unsupported element`);
  }
  assert.deepEqual(used, [], 'the icon module itself should not declare data-icon hosts');

  const license = await fetch(`${baseUrl}/vendor/lucide/LICENSE`);
  assert.equal(license.status, 200);
  assert.match(await license.text(), /ISC License/);
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
