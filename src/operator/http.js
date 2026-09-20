'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createOperatorAuth, originAllowed } = require('./auth');

const ADMIN_FILES = new Map([
  ['/admin', 'index.html'],
  ['/admin/', 'index.html'],
  ['/admin/index.html', 'index.html'],
  ['/admin/admin.css', 'admin.css'],
  ['/admin/app.js', 'app.js'],
  ['/admin/i18n.js', 'i18n.js']
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

const CHANNEL_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/;
const MAX_BODY = 64 * 1024;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

function send(response, status, headers, body, headOnly) {
  response.writeHead(status, headers);
  response.end(headOnly ? undefined : body);
}

function sendText(response, status, text, headOnly) {
  const body = text;
  send(response, status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS
  }, body, headOnly);
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  send(response, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders
  }, body, false);
}

function errorJson(response, error) {
  const status = error.code === 'OPERATOR_RATE_LIMITED' ? 429
    : error.code === 'OPERATOR_READONLY' || error.code === 'OPERATOR_TOKEN_REQUIRED'
      || error.code === 'CHANNEL_BUSY' || error.code === 'PLAY_BOUND' ? 409
      : error.code === 'OPERATOR_UNAUTHORIZED' ? 401
        : error.code === 'OPERATOR_FORBIDDEN' ? 403
          : error.code === 'PAYLOAD_TOO_LARGE' ? 413
            : error.code === 'BAD_JSON' || error.code === 'OPERATOR_BAD_REQUEST' ? 400
              : 400;
  sendJson(response, status, { ok: false, code: error.code || 'OPERATOR_BAD_REQUEST', message: error.message });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        request.destroy();
        const error = new Error('请求过大');
        error.code = 'PAYLOAD_TOO_LARGE';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const error = new Error('JSON 无效');
        error.code = 'BAD_JSON';
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function requireOrigin(request, config) {
  if (!originAllowed(request, config)) {
    const error = new Error('Origin 不被允许');
    error.code = 'OPERATOR_FORBIDDEN';
    throw error;
  }
}

function createOperatorHttp(config, { gateway, core, pavilion, root }) {
  const auth = createOperatorAuth(config);

  async function serveAdminFile(request, response, filename, headOnly) {
    let target;
    try {
      const publicRoot = await fs.promises.realpath(root);
      const expectedDir = path.join(publicRoot, 'admin');
      target = await fs.promises.realpath(path.join(root, 'admin', filename));
      if (!target.startsWith(`${expectedDir}${path.sep}`) && target !== expectedDir) throw new Error('Not public');
    } catch {
      sendText(response, 404, 'Not found', headOnly);
      return;
    }
    fs.readFile(target, (error, data) => {
      if (error) {
        sendText(response, 404, 'Not found', headOnly);
        return;
      }
      const extension = path.extname(filename).toLowerCase();
      const etag = `"admin-${data.length.toString(16)}-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}"`;
      send(response, 200, {
        'Content-Type': MIME[extension] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
        ETag: etag,
        ...SECURITY_HEADERS,
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"
      }, data, headOnly);
    });
  }

  function sessionPayload() {
    const snapshot = gateway.status();
    return {
      ok: true,
      storageDriver: config.storage?.driver || 'memory',
      gatewayEnabled: snapshot.enabled,
      usageEnabled: snapshot.usageTracking,
      writable: snapshot.writable,
      readonlyCode: snapshot.writable ? null : 'OPERATOR_READONLY'
    };
  }

  async function handleApi(request, response, pathname) {
    if (request.method === 'POST' && pathname === '/admin/api/login') {
      requireOrigin(request, config);
      const body = await readJson(request);
      const sessionId = auth.login(typeof body.token === 'string' ? body.token : '', request);
      sendJson(response, 200, { ok: true }, { 'Set-Cookie': auth.setCookie(sessionId, request) });
      return;
    }

    auth.require(request);

    if (request.method === 'POST' && pathname === '/admin/api/logout') {
      requireOrigin(request, config);
      auth.logout(auth.sessionIdFrom(request));
      sendJson(response, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie(request) });
      return;
    }

    if (request.method === 'GET' && pathname === '/admin/api/session') {
      sendJson(response, 200, sessionPayload());
      return;
    }

    if (request.method === 'GET' && pathname === '/admin/api/dashboard') {
      const pavilionSnapshot = pavilion?.snapshot();
      sendJson(response, 200, {
        ok: true,
        session: sessionPayload(),
        room: core.health(),
        pavilion: pavilionSnapshot ? {
          roomTitle: pavilionSnapshot.room.title,
          channelCount: pavilionSnapshot.channels.length,
          sources: pavilionSnapshot.sources
        } : null,
        gateway: gateway.status(),
        warnings: gateway.warnings
      });
      return;
    }

    if (pathname === '/admin/api/pavilion' && request.method === 'GET') {
      if (!pavilion) {
        const error = new Error('管理页编辑房间和聊天频道需要 sqlite');
        error.code = 'OPERATOR_READONLY';
        throw error;
      }
      sendJson(response, 200, { ok: true, ...pavilion.snapshot() });
      return;
    }

    if (pathname === '/admin/api/pavilion/room') {
      if (!pavilion) {
        const error = new Error('管理页编辑房间和聊天频道需要 sqlite');
        error.code = 'OPERATOR_READONLY';
        throw error;
      }
      requireOrigin(request, config);
      if (request.method === 'PUT') {
        const body = await readJson(request);
        sendJson(response, 200, { ok: true, ...pavilion.saveRoom(body) });
        return;
      }
      if (request.method === 'DELETE') {
        sendJson(response, 200, { ok: true, ...pavilion.revertRoom() });
        return;
      }
    }

    if (pathname === '/admin/api/pavilion/channels') {
      if (!pavilion) {
        const error = new Error('管理页编辑房间和聊天频道需要 sqlite');
        error.code = 'OPERATOR_READONLY';
        throw error;
      }
      requireOrigin(request, config);
      if (request.method === 'PUT') {
        const body = await readJson(request);
        sendJson(response, 200, { ok: true, ...pavilion.saveChannels(body) });
        return;
      }
      if (request.method === 'DELETE') {
        sendJson(response, 200, { ok: true, ...pavilion.revertChannels() });
        return;
      }
    }

    if (request.method === 'GET' && pathname === '/admin/api/channels') {
      sendJson(response, 200, { ok: true, channels: gateway.listChannels() });
      return;
    }

    if (request.method === 'GET' && pathname === '/admin/api/usage') {
      const days = Number(new URL(request.url, 'http://localhost').searchParams.get('days') || 7);
      sendJson(response, 200, {
        ok: true,
        tracking: gateway.status().usageTracking,
        rows: gateway.listUsage(Number.isFinite(days) ? days : 7)
      });
      return;
    }

    const channelMatch = pathname.match(/^\/admin\/api\/channels\/([a-z0-9][a-z0-9_-]{0,31})$/);
    if (channelMatch && request.method === 'PUT') {
      requireOrigin(request, config);
      const id = channelMatch[1];
      if (!CHANNEL_ID_RE.test(id)) {
        const error = new Error('渠道 ID 不合法');
        error.code = 'OPERATOR_BAD_REQUEST';
        throw error;
      }
      const body = await readJson(request);
      const existing = gateway.listChannels();
      if (!existing.some((channel) => channel.id === id) && existing.length >= 8) {
        const error = new Error('最多 8 个网关渠道');
        error.code = 'OPERATOR_BAD_REQUEST';
        throw error;
      }
      gateway.upsertChannel({
        id,
        preset: body.preset,
        label: body.label,
        baseUrl: body.baseUrl,
        model: body.model,
        apiKey: body.apiKey,
        enabled: body.enabled
      });
      sendJson(response, 200, { ok: true, channel: gateway.listChannels().find((channel) => channel.id === id) });
      return;
    }

    if (channelMatch && request.method === 'DELETE') {
      requireOrigin(request, config);
      gateway.deleteChannel(channelMatch[1]);
      sendJson(response, 200, { ok: true });
      return;
    }

    const probeMatch = pathname.match(/^\/admin\/api\/channels\/([a-z0-9][a-z0-9_-]{0,31})\/probe$/);
    if (probeMatch && request.method === 'POST') {
      requireOrigin(request, config);
      const result = await gateway.probe(probeMatch[1]);
      sendJson(response, result.ok ? 200 : 502, { ok: result.ok, result });
      return;
    }

    sendText(response, 404, 'Not found', false);
  }

  return (request, response) => {
    let requestUrl;
    try { requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`); }
    catch {
      sendText(response, 400, 'Bad request', false);
      return;
    }
    const pathname = requestUrl.pathname;
    const headOnly = request.method === 'HEAD';
    if ((request.method === 'GET' || headOnly) && ADMIN_FILES.has(pathname)) {
      serveAdminFile(request, response, ADMIN_FILES.get(pathname), headOnly);
      return;
    }
    if (pathname.startsWith('/admin/api/')) {
      handleApi(request, response, pathname).catch((error) => errorJson(response, error));
      return;
    }
    sendText(response, 404, 'Not found', headOnly);
  };
}

function isAdminPath(request) {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    return pathname === '/admin' || pathname.startsWith('/admin/');
  } catch {
    return false;
  }
}

module.exports = { createOperatorHttp, isAdminPath, ADMIN_FILES };
