'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'pavilo_operator';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function gatewayError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function timingSafeEqualString(left, right) {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string' || !header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function clientIp(request) {
  return request.socket?.remoteAddress || 'unknown';
}

function cookieHeader(sessionId, { secure, maxAge }) {
  const parts = [
    `${COOKIE_NAME}=${sessionId}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/admin',
    `Max-Age=${maxAge}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function createOperatorAuth(config, runtime = {}) {
  const now = runtime.now || Date.now;
  const sessions = new Map();
  const failures = new Map();

  function expectedToken() {
    return config.operator?.token || '';
  }

  function pruneSessions(timestamp) {
    for (const [id, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(id);
    }
  }

  function loginAllowed(ip, timestamp) {
    const record = failures.get(ip);
    if (!record || timestamp - record.windowStart >= LOGIN_WINDOW_MS) {
      failures.set(ip, { windowStart: timestamp, count: 0 });
      return true;
    }
    return record.count < LOGIN_MAX_FAILURES;
  }

  function recordFailure(ip, timestamp) {
    const record = failures.get(ip) || { windowStart: timestamp, count: 0 };
    if (timestamp - record.windowStart >= LOGIN_WINDOW_MS) {
      failures.set(ip, { windowStart: timestamp, count: 1 });
      return;
    }
    record.count += 1;
    failures.set(ip, record);
  }

  return {
    login(candidate, request) {
      const timestamp = now();
      const ip = clientIp(request);
      if (!loginAllowed(ip, timestamp)) throw gatewayError('OPERATOR_RATE_LIMITED', '登录尝试过多，请稍后再试');
      if (!timingSafeEqualString(candidate, expectedToken())) {
        recordFailure(ip, timestamp);
        throw gatewayError('OPERATOR_UNAUTHORIZED', '口令不正确');
      }
      failures.delete(ip);
      pruneSessions(timestamp);
      const sessionId = crypto.randomBytes(32).toString('base64url');
      sessions.set(sessionId, { createdAt: timestamp, expiresAt: timestamp + SESSION_TTL_MS });
      return sessionId;
    },
    logout(sessionId) {
      if (sessionId) sessions.delete(sessionId);
    },
    sessionIdFrom(request) {
      return parseCookies(request.headers.cookie)[COOKIE_NAME] || '';
    },
    require(request) {
      const timestamp = now();
      pruneSessions(timestamp);
      const sessionId = this.sessionIdFrom(request);
      const session = sessionId ? sessions.get(sessionId) : null;
      if (!session || session.expiresAt <= timestamp) throw gatewayError('OPERATOR_UNAUTHORIZED', '需要登录');
      return sessionId;
    },
    setCookie(sessionId, request) {
      return cookieHeader(sessionId, {
        secure: Boolean(request.socket?.encrypted),
        maxAge: Math.floor(SESSION_TTL_MS / 1000)
      });
    },
    clearCookie(request) {
      return cookieHeader('', {
        secure: Boolean(request.socket?.encrypted),
        maxAge: 0
      });
    }
  };
}

function originAllowed(request, config) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !origin) return false;
  const host = request.headers.host;
  if (typeof host === 'string' && host) {
    if (origin === `http://${host}` || origin === `https://${host}`) return true;
  }
  return Array.isArray(config.allowedOrigins) && config.allowedOrigins.includes(origin);
}

module.exports = {
  COOKIE_NAME,
  createOperatorAuth,
  originAllowed,
  timingSafeEqualString
};
