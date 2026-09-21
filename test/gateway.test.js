'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { DEFAULTS } = require('../config');
const { createGateway } = require('../src/gateway');
const { completeChat } = require('../src/gateway/client');
const { createGatewayStore } = require('../src/gateway/store');
const { createChatServer } = require('../server');
const { openWebSocket } = require('./helpers/raw-websocket');
const { PROTOCOL_VERSION } = require('../src/core/events');
const { openSqliteEngine } = require('../src/storage/sqlite-engine');
const { applyMigrations } = require('../src/storage/migrations');

const TOKEN = 'a'.repeat(64);

function sqliteConfig(t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-gateway-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    ...structuredClone(DEFAULTS),
    operator: { token: TOKEN, enabled: false },
    storage: { driver: 'sqlite', sqlite: { path: path.join(directory, 'pavilo.db'), engine: 'auto', retentionDays: 30 } },
    ...extra,
    operator: { token: extra.operator?.token === undefined ? TOKEN : extra.operator.token, enabled: false }
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'X',
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test('DeepSeek complete parses usage and never returns the API key', async (t) => {
  let calls = 0;
  const config = sqliteConfig(t);
  const gateway = createGateway(config, {
    fetch: async (url, init) => {
      calls += 1;
      assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
      assert.match(init.headers.Authorization, /Bearer sk-test-key-1234/);
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'deepseek-chat');
      assert.equal(body.stream, false);
      return jsonResponse(200, {
        model: 'deepseek-chat',
        choices: [{ message: { content: 'pong' } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 }
      });
    }
  });
  t.after(() => gateway.close());
  gateway.upsertChannel({ id: 'deepseek', preset: 'deepseek', apiKey: 'sk-test-key-1234' });
  const result = await gateway.complete({ messages: [{ role: 'user', content: 'ping' }] });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'pong');
  assert.deepEqual(result.usage, { promptTokens: 3, completionTokens: 1 });
  assert.equal(JSON.stringify(result).includes('sk-test-key-1234'), false);
  assert.equal(calls, 1);
  assert.equal(gateway.status().degraded, false);
});

test('gateway without sqlite and token never calls fetch', async () => {
  let calls = 0;
  const gateway = createGateway(structuredClone(DEFAULTS), {
    fetch: async () => {
      calls += 1;
      return jsonResponse(200, {});
    }
  });
  const result = await gateway.complete({ messages: [{ role: 'user', content: 'ping' }] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'GATEWAY_DISABLED');
  assert.equal(calls, 0);
});

test('401 is not retried; 503 is retried then fails without leaking the key', async () => {
  const schedule = (fn) => { fn(); return 0; };
  let authCalls = 0;
  const auth = await completeChat({
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test-key-1234',
    model: 'deepseek-chat',
    messages: [],
    timeoutMs: 1_000,
    maxRetries: 2
  }, {
    fetch: async () => {
      authCalls += 1;
      return jsonResponse(401, { error: { message: 'invalid sk-test-key-1234' } });
    },
    schedule,
    cancel() {}
  });
  assert.equal(auth.code, 'GATEWAY_AUTH');
  assert.equal(authCalls, 1);
  assert.equal(auth.message.includes('sk-test-key-1234'), false);

  let upstreamCalls = 0;
  const upstream = await completeChat({
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test-key-1234',
    model: 'deepseek-chat',
    messages: [],
    timeoutMs: 1_000,
    maxRetries: 2
  }, {
    fetch: async () => {
      upstreamCalls += 1;
      return jsonResponse(503, { error: { message: 'busy' } });
    },
    schedule,
    cancel() {}
  });
  assert.equal(upstream.code, 'GATEWAY_UPSTREAM');
  assert.equal(upstreamCalls, 3);
});

test('openai-compatible custom channels use the saved base URL', async (t) => {
  const config = sqliteConfig(t);
  const gateway = createGateway(config, {
    fetch: async (url) => {
      assert.equal(url, 'http://127.0.0.1:8000/v1/chat/completions');
      return jsonResponse(200, { choices: [{ message: { content: 'hi' } }] });
    }
  });
  t.after(() => gateway.close());
  gateway.upsertChannel({
    id: 'local',
    preset: 'openai-compatible',
    label: '本地',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'qwen',
    apiKey: 'local-key'
  });
  const result = await gateway.complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'hi');
});

test('memory store cannot persist operator channels or usage', () => {
  const store = createGatewayStore(structuredClone(DEFAULTS));
  assert.equal(store.tracksUsage, false);
  assert.equal(store.writable, false);
  assert.throws(() => store.upsertChannel({ id: 'deepseek', preset: 'deepseek', apiKey: 'x' }), { code: 'OPERATOR_READONLY' });
  store.recordUsage({ channelId: 'deepseek', ok: true, promptTokens: 1, completionTokens: 1 });
  assert.deepEqual(store.listUsage(), []);
  assert.equal(store.listResolved().length, 0);
});

test('sqlite operator save encrypts the key and records usage', (t) => {
  const config = sqliteConfig(t);
  const engine = openSqliteEngine(config.storage.sqlite);
  t.after(() => engine.close());
  const frozen = Date.UTC(2026, 0, 2, 12);
  const store = createGatewayStore(config, { engine, now: () => frozen });
  store.upsertChannel({
    id: 'deepseek',
    preset: 'deepseek',
    model: 'deepseek-reasoner',
    apiKey: 'sk-from-admin-9999'
  });
  const row = engine.prepare('SELECT api_key, model FROM gateway_channels WHERE id = ?').get('deepseek');
  assert.ok(row.api_key.startsWith('v1.'));
  assert.equal(row.api_key.includes('sk-from-admin-9999'), false);
  assert.equal(row.model, 'deepseek-reasoner');
  const resolved = store.resolve('deepseek');
  assert.equal(resolved.source, 'operator');
  assert.equal(store.unwrapKey(resolved), 'sk-from-admin-9999');

  store.recordUsage({ channelId: 'deepseek', ok: true, promptTokens: 8, completionTokens: 2 });
  store.recordUsage({ channelId: 'deepseek', ok: false, code: 'GATEWAY_TIMEOUT' });
  const usage = store.listUsage(7).find((entry) => entry.day === '2026-01-02');
  assert.equal(usage.requests, 2);
  assert.equal(usage.promptTokens, 8);
  assert.equal(usage.completionTokens, 2);
  assert.equal(usage.errors, 1);
  assert.equal(usage.lastErrorCode, 'GATEWAY_TIMEOUT');

  store.deleteChannel('deepseek');
  assert.equal(store.resolve('deepseek'), null);
});

test('empty apiKey on upsert keeps the previous ciphertext', (t) => {
  const config = sqliteConfig(t);
  const store = createGatewayStore(config);
  t.after(() => store.close());
  store.upsertChannel({ id: 'deepseek', preset: 'deepseek', apiKey: 'sk-keep-me-1234' });
  store.upsertChannel({ id: 'deepseek', preset: 'deepseek', model: 'deepseek-chat', apiKey: '' });
  const channel = store.resolve('deepseek');
  assert.equal(store.unwrapKey(channel), 'sk-keep-me-1234');
  store.upsertChannel({ id: 'deepseek', preset: 'deepseek', apiKey: null });
  assert.equal(store.unwrapKey(store.resolve('deepseek')), '');
});

test('a v1.2 001 database gains gateway tables on reopen and keeps chat rows', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-mig-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'pavilo.db');
  const engine = openSqliteEngine({ path: filePath, engine: 'auto' });
  engine.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  engine.exec(fs.readFileSync(path.join(__dirname, '../src/storage/migrations/001-initial.sql'), 'utf8'));
  engine.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(1, Date.now());
  engine.prepare('INSERT INTO channels (id, epoch, started_at, latest_seq) VALUES (?, ?, ?, ?)').run('general', 'epoch-1', 1, 1);
  engine.prepare('INSERT INTO messages (channel_id, id, seq, created_at, payload) VALUES (?, ?, ?, ?, ?)').run(
    'general', 'm1', 1, 1, JSON.stringify({ id: 'm1', seq: 1, text: 'kept', reactionUsers: [], reactions: {}, byteSize: 4 })
  );
  engine.close();

  const upgraded = openSqliteEngine({ path: filePath, engine: 'auto' });
  t.after(() => upgraded.close());
  applyMigrations(upgraded);
  const ids = upgraded.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((row) => row.id);
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
  assert.equal(upgraded.prepare('SELECT id FROM messages').all().length, 1);
  assert.deepEqual(upgraded.prepare('SELECT id FROM gateway_channels').all(), []);
  assert.deepEqual(upgraded.prepare('SELECT channel_id FROM play_games').all(), []);
});

test('public channel views never include the API key', (t) => {
  const config = sqliteConfig(t);
  const gateway = createGateway(config);
  t.after(() => gateway.close());
  gateway.upsertChannel({ id: 'deepseek', preset: 'deepseek', apiKey: 'sk-hidden-key-9999' });
  const [channel] = gateway.listChannels();
  assert.equal(channel.keyPresent, true);
  assert.equal(channel.keyHint, '***9999');
  assert.equal(JSON.stringify(channel).includes('sk-hidden-key-9999'), false);
});

test('a hanging gateway fetch still lets chat messages ACK', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-iso-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = createChatServer({
    host: '127.0.0.1',
    operator: { token: TOKEN },
    storage: { driver: 'sqlite', sqlite: { path: path.join(directory, 'pavilo.db'), engine: 'auto', retentionDays: 30 } },
    gateway: { timeoutMs: 80, maxRetries: 0, maxInFlight: 2 },
    fetch: (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })
  });
  app.gateway.upsertChannel({ id: 'deepseek', preset: 'deepseek', apiKey: 'sk-isolation-key-aaaa' });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  const pending = app.gateway.complete({ messages: [{ role: 'user', content: 'slow' }] });
  const client = await openWebSocket({ port: address.port });
  client.sendJson({
    type: 'join',
    protocolVersion: PROTOCOL_VERSION,
    username: 'Alice',
    clientSessionId: 'session-alice-gw-1',
    avatarSeed: 17
  });
  assert.equal((await client.nextJson()).type, 'stateStart');
  assert.equal((await client.nextJson()).type, 'history');
  assert.equal((await client.nextJson()).type, 'historyEnd');
  client.sendJson({ type: 'message', clientMessageId: 'gw-iso-1', kind: 'text', text: 'still here' });
  const ack = await client.nextJson();
  assert.equal(ack.type, 'ack');
  assert.equal(ack.clientMessageId, 'gw-iso-1');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'GATEWAY_TIMEOUT');
  const health = await (await fetch(`http://127.0.0.1:${address.port}/healthz`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.gateway.enabled, true);
  assert.equal(JSON.stringify(health).includes('sk-isolation-key-aaaa'), false);
  const info = await (await fetch(`http://127.0.0.1:${address.port}/room-info`)).json();
  assert.equal(JSON.stringify(info).includes('sk-isolation-key-aaaa'), false);
  assert.equal(info.gateway, undefined);
});
