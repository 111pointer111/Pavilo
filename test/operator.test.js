'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createChatServer } = require('../server');
const { catalogs } = require('../admin/i18n');

const TOKEN = 'a'.repeat(64);

function sqliteDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-operator-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function startOperator(t, extra = {}) {
  const directory = sqliteDir(t);
  const app = createChatServer({
    host: '127.0.0.1',
    operator: { enabled: true, token: TOKEN },
    storage: { driver: 'sqlite', sqlite: { path: path.join(directory, 'pavilo.db'), engine: 'auto', retentionDays: 30 } },
    gateway: { timeoutMs: 500, maxRetries: 0, maxInFlight: 2 },
    fetch: extra.fetch || (async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: 'pong' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
    })),
    ...extra
  });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  const origin = `http://127.0.0.1:${address.port}`;
  return { app, origin };
}

async function login(origin, token = TOKEN) {
  const response = await fetch(`${origin}/admin/api/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  const payload = await response.json();
  const setCookie = response.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  return { response, payload, cookie };
}

test('admin catalogs cover the same keys in zh-CN and en', () => {
  assert.deepEqual(Object.keys(catalogs['zh-CN']).sort(), Object.keys(catalogs.en).sort());
});

test('disabled operator console is a 404 like any unknown path', async (t) => {
  const app = createChatServer({ host: '127.0.0.1' });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  const origin = `http://127.0.0.1:${address.port}`;
  for (const pathname of ['/admin', '/admin/', '/admin/api/login']) {
    const response = await fetch(`${origin}${pathname}`, { method: pathname.includes('login') ? 'POST' : 'GET' });
    assert.equal(response.status, 404, pathname);
  }
  const head = await fetch(`${origin}/admin`, { method: 'HEAD' });
  assert.equal(head.status, 404);
});

test('operator pages are served only when enabled, and traversal stays 404', async (t) => {
  const { origin } = await startOperator(t);
  const page = await fetch(`${origin}/admin`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /channelForm/);
  const css = await fetch(`${origin}/admin/admin.css`);
  assert.equal(css.status, 200);
  const traversal = await fetch(`${origin}/admin/../pavilo.yaml`);
  assert.equal(traversal.status, 404);
  const missing = await fetch(`${origin}/admin/secret.js`);
  assert.equal(missing.status, 404);
});

test('login is origin-bound, rejects a wrong token, and rate-limits', async (t) => {
  const { origin } = await startOperator(t);
  const noOrigin = await fetch(`${origin}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN })
  });
  assert.equal(noOrigin.status, 403);

  const wrong = await login(origin, 'b'.repeat(64));
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.payload.code, 'OPERATOR_UNAUTHORIZED');

  const ok = await login(origin);
  assert.equal(ok.response.status, 200);
  assert.match(ok.cookie, /^pavilo_operator=/);

  for (let index = 0; index < 5; index += 1) await login(origin, 'c'.repeat(64));
  const limited = await login(origin, 'c'.repeat(64));
  assert.equal(limited.response.status, 429);
  assert.equal(limited.payload.code, 'OPERATOR_RATE_LIMITED');
});

test('session APIs hide the API key, persist ciphertext, and probe without exposing it', async (t) => {
  const { origin } = await startOperator(t);
  const unauth = await fetch(`${origin}/admin/api/channels`);
  assert.equal(unauth.status, 401);

  const { cookie } = await login(origin);
  const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' };
  const listing = await (await fetch(`${origin}/admin/api/channels`, { headers })).json();
  assert.deepEqual(listing.channels, []);

  const saved = await fetch(`${origin}/admin/api/channels/deepseek`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ preset: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-admin-key-9999', enabled: true })
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.channel.source, 'operator');
  assert.equal(savedBody.channel.keyHint, '***9999');
  assert.equal(JSON.stringify(savedBody).includes('sk-admin-key-9999'), false);

  const keep = await fetch(`${origin}/admin/api/channels/deepseek`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ preset: 'deepseek', model: 'deepseek-reasoner', apiKey: '', enabled: true })
  });
  const kept = await keep.json();
  assert.equal(kept.channel.model, 'deepseek-reasoner');
  assert.equal(kept.channel.keyHint, '***9999');

  const probed = await fetch(`${origin}/admin/api/channels/deepseek/probe`, { method: 'POST', headers, body: '{}' });
  const probeBody = await probed.json();
  assert.equal(probeBody.result.ok, true);
  assert.equal(JSON.stringify(probeBody).includes('sk-admin-key-9999'), false);

  const dashboard = await (await fetch(`${origin}/admin/api/dashboard`, { headers })).json();
  assert.equal(dashboard.room.ok, true);
  assert.equal(JSON.stringify(dashboard).includes('sk-admin-key-9999'), false);
});

test('memory mode does not serve /admin even with a token in options', async (t) => {
  const app = createChatServer({
    host: '127.0.0.1',
    operator: { token: TOKEN }
  });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(`${origin}/admin`);
  assert.equal(page.status, 404);
});

test('sqlite without operator.token starts but /admin is 404', async (t) => {
  const directory = sqliteDir(t);
  const app = createChatServer({
    host: '127.0.0.1',
    storage: { driver: 'sqlite', sqlite: { path: path.join(directory, 'pavilo.db'), engine: 'auto', retentionDays: 30 } }
  });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal(app.config.operator.enabled, false);
  const page = await fetch(`${origin}/admin`);
  assert.equal(page.status, 404);
});
