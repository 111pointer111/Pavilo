'use strict';

const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const { createChatServer } = require('../server.js');

test('HTTP security headers', async (t) => {
  await t.test('security headers on index.html', async () => {
    const app = createChatServer({ port: 0 });
    await app.listen();
    const port = app.server.address().port;

    const response = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/`, (res) => {
        resolve(res);
      }).on('error', reject);
    });

    assert.strictEqual(response.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(response.headers['x-frame-options'], 'DENY');
    assert.strictEqual(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert(response.headers['content-security-policy']);

    await app.stop();
  });

  await t.test('security headers on JSON responses', async () => {
    const app = createChatServer({ port: 0 });
    await app.listen();
    const port = app.server.address().port;

    const response = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/room-info`, (res) => {
        resolve(res);
      }).on('error', reject);
    });

    assert.strictEqual(response.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(response.headers['x-frame-options'], 'DENY');
    assert.strictEqual(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');

    await app.stop();
  });

  await t.test('security headers on vendor files', async () => {
    const app = createChatServer({ port: 0 });
    await app.listen();
    const port = app.server.address().port;

    const response = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/vendor/lucide/index.js`, (res) => {
        resolve(res);
      }).on('error', reject);
    });

    assert.strictEqual(response.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(response.headers['x-frame-options'], 'DENY');
    assert.strictEqual(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');

    await app.stop();
  });
});
