'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { encryptApiKey, decryptApiKey, keyHint, redactSecrets } = require('../src/gateway/secret');

const TOKEN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

test('encrypts an API key that round-trips and is not stored as plaintext', () => {
  const packed = encryptApiKey(TOKEN, 'deepseek', 'sk-secret-value-1234');
  assert.ok(packed.startsWith('v1.'));
  assert.equal(packed.includes('sk-secret-value-1234'), false);
  assert.equal(decryptApiKey(TOKEN, 'deepseek', packed), 'sk-secret-value-1234');
});

test('refuses to decrypt with the wrong token, channel, or malformed ciphertext', () => {
  const packed = encryptApiKey(TOKEN, 'deepseek', 'sk-secret-value-1234');
  assert.throws(() => decryptApiKey(OTHER, 'deepseek', packed), { code: 'GATEWAY_KEY_UNWRAP_FAILED' });
  assert.throws(() => decryptApiKey(TOKEN, 'other', packed), { code: 'GATEWAY_KEY_UNWRAP_FAILED' });
  assert.throws(() => decryptApiKey(TOKEN, 'deepseek', 'v1.aaaa.bbbb.cccc'), { code: 'GATEWAY_KEY_UNWRAP_FAILED' });
  assert.throws(() => decryptApiKey(TOKEN, 'deepseek', 'plain-text-key'), { code: 'GATEWAY_KEY_UNWRAP_FAILED' });
  assert.equal(decryptApiKey(TOKEN, 'deepseek', null), '');
  assert.equal(encryptApiKey(TOKEN, 'deepseek', ''), null);
});

test('key hints never include the full secret and redact copies it out of messages', () => {
  assert.equal(keyHint('sk-secret-value-1234'), '***1234');
  assert.equal(keyHint('abc'), '****');
  assert.equal(keyHint(''), '');
  assert.equal(redactSecrets('failed Bearer sk-secret-value-1234', ['sk-secret-value-1234']), 'failed Bearer ***');
});
