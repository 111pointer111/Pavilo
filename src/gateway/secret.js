'use strict';

const crypto = require('node:crypto');

const HKDF_SALT = 'pavilo-gateway-v1';
const HKDF_INFO = 'api-key';

function gatewayError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function deriveKey(token) {
  if (typeof token !== 'string' || token.length < 16) {
    throw gatewayError('OPERATOR_TOKEN_REQUIRED', '加密渠道密钥需要 operator.token');
  }
  return crypto.hkdfSync('sha256', token, HKDF_SALT, HKDF_INFO, 32);
}

function encryptApiKey(token, channelId, plaintext) {
  if (!plaintext) return null;
  const key = deriveKey(token);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(channelId), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptApiKey(token, channelId, packed) {
  if (!packed) return '';
  const parts = String(packed).split('.');
  if (parts[0] !== 'v1' || parts.length !== 4) {
    throw gatewayError('GATEWAY_KEY_UNWRAP_FAILED', '无法解密渠道密钥');
  }
  try {
    const key = deriveKey(token);
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(String(channelId), 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error.code === 'OPERATOR_TOKEN_REQUIRED') throw error;
    throw gatewayError('GATEWAY_KEY_UNWRAP_FAILED', '无法解密渠道密钥');
  }
}

function keyHint(plaintext) {
  if (!plaintext) return '';
  if (plaintext.length < 4) return '****';
  return `***${plaintext.slice(-4)}`;
}

function redactSecrets(message, secrets) {
  let text = String(message || 'gateway error');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) text = text.split(secret).join('***');
  }
  return text.slice(0, 300);
}

module.exports = { encryptApiKey, decryptApiKey, keyHint, redactSecrets };
