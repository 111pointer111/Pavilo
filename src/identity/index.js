'use strict';

const crypto = require('node:crypto');
const { cleanUsername } = require('../core/session');
const { channelAccess } = require('../core/capabilities');

const SUB_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const CHANNEL_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/;
const MAX_TTL_MS = 15 * 60 * 1000;

function identityConfig(config) {
  return config?.identity || { guests: true, audience: 'pavilo', clockSkewSec: 60, issuers: [] };
}

function guestsAllowed(config) {
  return identityConfig(config).guests !== false;
}

function usableIssuers(config) {
  return (identityConfig(config).issuers || []).filter((issuer) => (
    issuer && issuer.alg === 'HS256' && typeof issuer.secret === 'string' && issuer.secret.length >= 32
  ));
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signHs256(payload, secret) {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlJson(payload);
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function decodeJsonPart(part) {
  try {
    const json = Buffer.from(part, 'base64url').toString('utf8');
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function verifyHs256(token, secret) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJsonPart(headerPart);
  if (!header || header.alg !== 'HS256') return null;
  let actual;
  try {
    actual = Buffer.from(signaturePart, 'base64url');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return decodeJsonPart(payloadPart);
}

function parseChannelsClaim(value) {
  if (!Array.isArray(value)) return null;
  const channels = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || !CHANNEL_ID_RE.test(entry) || seen.has(entry)) return null;
    seen.add(entry);
    channels.push(entry);
  }
  return channels;
}

function authenticate(config, token, { now = Date.now() } = {}) {
  if (token == null || token === '') {
    if (guestsAllowed(config)) return { guest: true, userKey: null, name: '', channels: null, expiresAt: null };
    return { error: 'IDENTITY_REQUIRED', message: '这个亭需要宿主应用接入。' };
  }
  if (typeof token !== 'string') return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  if (config.operator?.token && token === config.operator.token) {
    return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  }
  const settings = identityConfig(config);
  const issuers = usableIssuers(config);
  if (!issuers.length) return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };

  let claims = null;
  let issuer = null;
  for (const candidate of issuers) {
    const decoded = verifyHs256(token, candidate.secret);
    if (decoded) {
      claims = decoded;
      issuer = candidate;
      break;
    }
  }
  if (!claims || !issuer) return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };

  const skewMs = (Number.isFinite(settings.clockSkewSec) ? settings.clockSkewSec : 60) * 1000;
  if (typeof claims.iss !== 'string' || claims.iss !== issuer.id) {
    return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  }
  if (typeof claims.aud !== 'string' || claims.aud !== settings.audience) {
    return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  }
  if (!Number.isFinite(claims.exp)) return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  const expiresAt = Math.trunc(claims.exp) * 1000;
  if (now - skewMs >= expiresAt) return { error: 'IDENTITY_EXPIRED', message: '身份凭证已过期。' };
  if (expiresAt - now > MAX_TTL_MS + skewMs) return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  if (Number.isFinite(claims.iat) && claims.iat * 1000 - skewMs > now) {
    return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  }
  if (Number.isFinite(claims.nbf) && claims.nbf * 1000 - skewMs > now) {
    return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  }
  if (typeof claims.sub !== 'string' || !SUB_RE.test(claims.sub)) {
    return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  }
  const channels = parseChannelsClaim(claims.channels);
  if (!channels) return { error: 'IDENTITY_INVALID', message: '身份凭证无效。' };
  const name = typeof claims.name === 'string' ? cleanUsername(claims.name) : '';
  return {
    guest: false,
    userKey: claims.sub,
    name: name || cleanUsername(claims.sub) || 'user',
    channels,
    expiresAt
  };
}

function channelAllowed(config, channelId, identity) {
  const channel = (config.channels || []).find((entry) => entry.id === channelId);
  if (!channel || channel.enabled === false) return { error: 'CHANNEL_UNAVAILABLE' };
  if (identity?.userKey) {
    if (!Array.isArray(identity.channels) || !identity.channels.includes(channelId)) {
      return { error: 'CHANNEL_FORBIDDEN' };
    }
    return { ok: true };
  }
  if (!guestsAllowed(config)) return { error: 'IDENTITY_REQUIRED' };
  if (channelAccess(channel) === 'authenticated') return { error: 'CHANNEL_FORBIDDEN' };
  return { ok: true };
}

function userDenied(list, userKey) {
  return typeof userKey === 'string' && userKey.length > 0 && Array.isArray(list) && list.includes(userKey);
}

function identityStillValid(session, now = Date.now()) {
  if (!session?.userKey) return true;
  if (!session.identityExpiresAt) return true;
  return now < session.identityExpiresAt;
}

function publicChannels(config, identity) {
  return (config.channels || []).filter((channel) => {
    if (identity?.userKey) {
      return Array.isArray(identity.channels) && identity.channels.includes(channel.id);
    }
    if (!guestsAllowed(config)) return false;
    return channelAccess(channel) !== 'authenticated';
  });
}

module.exports = {
  MAX_TTL_MS,
  identityConfig,
  guestsAllowed,
  usableIssuers,
  signHs256,
  authenticate,
  channelAllowed,
  identityStillValid,
  userDenied,
  publicChannels
};
