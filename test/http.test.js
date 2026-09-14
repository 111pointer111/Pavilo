'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DEFAULTS } = require('../config');
const { createHttpHandler, CLIENT_FILES } = require('../src/transport/http');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-http-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'client'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Fixture</title>');
  fs.writeFileSync(path.join(root, 'chat.css'), 'body { color: black; }');
  for (const file of CLIENT_FILES) fs.writeFileSync(path.join(root, file), `// ${file}\n${'/* self-hosted module */\n'.repeat(100)}`);
  const metadata = { protocolVersion: 3, roomTitle: 'Public fixture', channels: [], limits: {}, ephemeral: true };
  const health = { ok: true, users: 0, messages: 0, roomBytes: 0, clients: 0, ephemeral: true };
  // HTTP only requires these public projections, not a real room or session Map.
  const core = { roomInfo: () => metadata, health: () => health };
  const server = http.createServer(createHttpHandler({ ...DEFAULTS, exposeLanUrls: false }, core, () => server.address(), root));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { root, url: `http://127.0.0.1:${server.address().port}`, metadata, health };
}

test('HTTP adapter operates on public projections without a networked core', async (t) => {
  const { url, metadata, health } = await fixture(t);
  assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), health);
  const info = await (await fetch(`${url}/room-info`)).json();
  assert.deepEqual(info, { ...metadata, localUrl: url.replace('127.0.0.1', 'localhost'), lanUrls: [] });
});

test('each explicit client module supports GET, HEAD, content tags and gzip', async (t) => {
  const { root, url } = await fixture(t);
  for (const file of CLIENT_FILES) {
    const identity = await fetch(`${url}${file}`, { headers: { 'Accept-Encoding': 'identity' } });
    assert.equal(identity.status, 200, file);
    assert.match(identity.headers.get('content-type'), /^text\/javascript/);
    assert.equal(await identity.text(), fs.readFileSync(path.join(root, file), 'utf8'));
    const compressed = await fetch(`${url}${file}`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(compressed.headers.get('content-encoding'), 'gzip', file);
    assert.equal(compressed.headers.get('etag'), identity.headers.get('etag'));
    assert.equal(await compressed.text(), fs.readFileSync(path.join(root, file), 'utf8'));
    const head = await fetch(`${url}${file}`, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), compressed.headers.get('content-length'));
    assert.equal(head.headers.get('etag'), compressed.headers.get('etag'));
    assert.equal(head.headers.get('vary'), 'Accept-Encoding');
    assert.equal(await head.text(), '');
  }
});

test('new asset routes reject private files and aliases even under an allowed filename', async (t) => {
  const { root, url } = await fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-http-secret-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.js'), 'private configuration');
  fs.writeFileSync(path.join(root, 'config.js'), 'private source');
  fs.writeFileSync(path.join(root, 'client', 'not-public.js'), 'not an asset');
  const asset = [...CLIENT_FILES][0];
  for (const target of [path.join(root, 'config.js'), path.join(outside, 'secret.js')]) {
    fs.rmSync(path.join(root, asset));
    fs.symlinkSync(target, path.join(root, asset));
    for (const method of ['GET', 'HEAD']) {
      for (const file of [asset, '/client/not-public.js', '/config.js', '/src/core/index.js', '/client/%2e%2e/config.js']) {
        const response = await fetch(`${url}${file}`, { method });
        assert.equal(response.status, 404, `${method} ${file}`);
        assert.ok(!(await response.text()).includes('private'));
      }
    }
  }
});
