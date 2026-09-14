'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
// The interface, the icon set and the emoji data are large text assets that are
// fetched on every reload, and Pavilo is usually reached over Wi-Fi — where the
// wire is the slow part, not the CPU that compresses it. Bodies are small enough
// to compress whole and hold in memory, so there is no streaming path here.
const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:json|javascript))/;
const COMPRESSION_MIN_BYTES = 1024;
const gzipAsync = promisify(zlib.gzip);
const vendorEtagCache = new Map();
// Content with a stable request-independent body: index.html plus everything
// under vendor/. Keyed by entity tag; see encodedBodyFor.
const compressedBodyCache = new Map();

function acceptsGzip(request) {
  const header = request.headers['accept-encoding'];
  if (typeof header !== 'string') return false;
  // The token boundaries keep `x-gzip` from matching a bare `gzip`.
  return /(^|[\s,])gzip(?:[\s;,]|$)/.test(header.toLowerCase());
}

// Only used for bodies that never vary by request (index.html and vendor files).
// The compressed copy is keyed by the entity tag, so an edited file changes its
// tag and can never be served from a stale entry; in practice the set of keys is
// bounded by the files on disk because a redeploy restarts the process.
async function encodedBodyFor(request, etag, type, data) {
  const identity = { body: data, contentLength: data.length, encoding: null };
  if (!acceptsGzip(request) || data.length < COMPRESSION_MIN_BYTES || !COMPRESSIBLE_TYPE.test(String(type || ''))) return identity;
  const cached = compressedBodyCache.get(etag);
  if (cached) return cached;
  try {
    const compressed = await gzipAsync(data);
    const entry = { body: compressed, contentLength: compressed.length, encoding: 'gzip' };
    compressedBodyCache.set(etag, entry);
    return entry;
  } catch {
    return identity;
  }
}


const CLIENT_FILES = new Set(['protocol', 'connection', 'state', 'pending', 'messages', 'composer', 'images', 'overlays', 'notifications', 'app'].map((name) => `/client/${name}.js`));
function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
  return [...new Set(addresses)];
}
function createHttpHandler(config, core, address, ROOT) {
  async function serveVendorFile(request, response, pathname, headOnly = false) {
    const relative = pathname.slice('/vendor/'.length);
    if (relative.startsWith('/') || relative.includes('..') || relative.includes('\0')) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Forbidden');
      return;
    }
    const extension = path.extname(relative).toLowerCase();
    let filename;
    try {
      const publicRoot = await fs.promises.realpath(ROOT);
      const vendorRoot = path.join(publicRoot, 'vendor');
      if (await fs.promises.realpath(vendorRoot) !== vendorRoot) throw new Error('Not public');
      filename = await fs.promises.realpath(path.join(vendorRoot, relative));
      if (!filename.startsWith(`${vendorRoot}${path.sep}`) || (!MIME_TYPES[extension] && path.basename(relative) !== 'LICENSE')) throw new Error('Not public');
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
      return;
    }
    fs.readFile(filename, async (error, data) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(headOnly ? undefined : 'Not found');
        return;
      }
      // ETag lets the emoji picker validate its cache with a cheap HEAD request,
      // avoiding its fallback checksum path which needs crypto.subtle (missing on
      // plain-HTTP LAN origins where Pavilo is typically accessed).
      let etag = vendorEtagCache.get(relative);
      if (!etag) {
        etag = `"sha1-${crypto.createHash('sha1').update(data).digest('hex')}"`;
        vendorEtagCache.set(relative, etag);
      }
      const type = MIME_TYPES[extension] || 'application/octet-stream';
      const encoded = await encodedBodyFor(request, etag, type, data);
      const headers = {
        'Content-Type': type,
        'Content-Length': encoded.contentLength,
        ETag: etag,
        // The same ETag is served for both encodings, so a shared cache must key
        // on Accept-Encoding or it can hand a gzipped body to a client that never
        // asked for one.
        Vary: 'Accept-Encoding',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff'
      };
      if (encoded.encoding) headers['Content-Encoding'] = encoded.encoding;
      response.writeHead(200, headers);
      response.end(headOnly ? undefined : encoded.body);
    });
  }

  // App resources are explicit routes, never a directory mount. Reject symlinks
  // even when they resolve inside the project: a public name must not alias a
  // config file or another private source file.
  async function serveAppFile(request, response, filename, headOnly = false) {
    const extension = path.extname(filename).toLowerCase();
    const type = MIME_TYPES[extension] || 'application/octet-stream';
    let target;
    try {
      const publicRoot = await fs.promises.realpath(ROOT);
      target = await fs.promises.realpath(path.join(ROOT, filename));
      const expected = path.join(publicRoot, filename);
      if (target !== expected) throw new Error('Not public');
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(headOnly ? undefined : 'Not found');
      return;
    }
    fs.readFile(target, async (error, data) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(headOnly ? undefined : `${filename} is missing`);
        return;
      }
      const etag = `"app-${data.length.toString(16)}-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}"`;
      const encoded = await encodedBodyFor(request, etag, type, data);
      const headers = {
        'Content-Type': type,
        'Content-Length': encoded.contentLength,
        // Revalidate on every load so redeployments are picked up, while still
        // allowing a 304 — reloads keep the page they are already showing.
        'Cache-Control': 'no-cache',
        ETag: etag,
        Vary: 'Accept-Encoding',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:;"
      };
      if (encoded.encoding) headers['Content-Encoding'] = encoded.encoding;
      response.writeHead(200, headers);
      response.end(headOnly ? undefined : encoded.body);
    });
  }

  function jsonResponse(response, status, payload, headOnly = false) {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(headOnly ? undefined : body);
  }

  return (request, response) => {
    let requestUrl;
    try { requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`); }
    catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }
    const isHead = request.method === 'HEAD';
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/healthz') {
      jsonResponse(response, 200, core.health(), isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/room-info') {
      const activePort = address()?.port || config.port;
      jsonResponse(response, 200, {
        ...core.roomInfo(),
        localUrl: `http://localhost:${activePort}`,
        lanUrls: config.exposeLanUrls ? localAddresses().map((address) => `http://${address}:${activePort}`) : []
      }, isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html' || requestUrl.pathname === '/chat')) {
      serveAppFile(request, response, 'index.html', isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/chat.css') {
      serveAppFile(request, response, 'chat.css', isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && CLIENT_FILES.has(requestUrl.pathname)) {
      serveAppFile(request, response, requestUrl.pathname.slice(1), isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname.startsWith('/vendor/')) {
      serveVendorFile(request, response, requestUrl.pathname, isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(isHead ? undefined : 'Not found');
  };

}
module.exports = { createHttpHandler, localAddresses, CLIENT_FILES };
