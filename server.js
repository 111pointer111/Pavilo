'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { DEFAULTS, loadConfig } = require('./config');

const ROOT = __dirname;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PROTOCOL_VERSION = 3;
const REACTION_EMOJIS = new Set(['👍', '❤️', '😂', '🎉', '👀', '🔥']);
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,96}$/;
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

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// Resume tokens are random, so joining with one proves the caller previously held
// this room session. That is what lets a page come back as the same member after a
// reload instead of walking back through the name box.
function randomResumeToken() {
  return crypto.randomBytes(9).toString('base64url');
}

function getAddress(socket) {
  const address = socket.remoteAddress || 'unknown';
  if (address === '::1') return '127.0.0.1';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function cleanUsername(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function createChatServer(options = {}) {
  const config = { ...DEFAULTS, ...options };
  config.channels = (options.channels || DEFAULTS.channels).map((channel) => ({ ...channel }));
  const clients = new Set();
  const sessions = new Map();
  const leasedSessions = new Map();
  const dedupe = new Map();
  const channelStates = new Map(config.channels.map((channel) => [channel.id, {
    config: channel,
    epoch: randomId(`room-${channel.id}`),
    startedAt: Date.now(),
    messages: [],
    messageSequence: 0,
    roomBytes: 0
  }]));
  const defaultChannel = channelStates.get(config.defaultChannelId);
  if (!defaultChannel?.config.enabled) throw new Error(`Default channel "${config.defaultChannelId}" is missing or disabled`);
  const roomEpoch = defaultChannel.epoch;
  let shuttingDown = false;
  let lifecycle = 'created';
  let heartbeat;
  let pendingStartup = null;

  function publicChannel(channel) {
    return {
      id: channel.id,
      name: channel.name,
      description: channel.description,
      enabled: channel.enabled,
      maxUsers: channel.maxUsers
    };
  }

  function publicChannels() {
    return config.channels.map(publicChannel);
  }

  function publicLimits() {
    return {
      maxTextLength: config.maxTextLength,
      maxImageBytes: config.maxImageBytes,
      maxImageDimension: config.maxImageDimension,
      maxImagePixels: config.maxImagePixels,
      maxMessages: config.maxMessages
    };
  }

  function publicUser(session) {
    const user = {
      id: session.id,
      username: session.username,
      avatarSeed: session.avatarSeed,
      joinedAt: session.joinedAt
    };
    if (config.exposeMemberIps) user.ip = session.ip;
    return user;
  }

  function activeMembers(channelId) {
    const active = new Map();
    for (const [token, session] of sessions) {
      if (!channelId || session.channelId === channelId) active.set(token, session);
    }
    const now = Date.now();
    for (const [token, lease] of leasedSessions) {
      if (lease.expiresAt > now && (!channelId || lease.session.channelId === channelId)) active.set(token, lease.session);
    }
    return active;
  }

  function rosterUsers(channelId) {
    return [...activeMembers(channelId).values()].map(publicUser);
  }

  function nameIsFree(nameKey, channelId, excludedToken) {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.token !== excludedToken && session.channelId === channelId && session.nameKey === nameKey) return false;
    }
    for (const lease of leasedSessions.values()) {
      if (lease.session.token !== excludedToken && lease.expiresAt > now && lease.session.channelId === channelId && lease.session.nameKey === nameKey) return false;
    }
    return true;
  }

  function freshResumeToken() {
    let candidate = randomResumeToken();
    while (sessions.has(candidate) || leasedSessions.has(candidate)) candidate = randomResumeToken();
    return candidate;
  }

  function publicMessage(message) {
    const copy = { ...message };
    delete copy.byteSize;
    delete copy.reactionUsers;
    return copy;
  }

  function serialize(payload) {
    return Buffer.from(JSON.stringify(payload));
  }

  function sendFrame(socket, payload, opcode) {
    if (socket.destroyed || socket.writableEnded) return false;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let header;
    if (data.length < 126) {
      header = Buffer.alloc(2);
      header[1] = data.length;
    } else if (data.length < 65_536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    header[0] = 0x80 | (opcode & 0x0f);
    if (socket.writableLength + header.length + data.length > config.maxWritableBytes) {
      socket.destroy();
      return false;
    }
    return socket.write(Buffer.concat([header, data]));
  }

  function sendJson(client, payload) {
    if (!client || client.closing || client.socket.destroyed || client.socket.writableEnded) return false;
    const body = serialize(payload);
    if (body.length > config.maxJsonBytes) {
      const fallback = serialize({ type: 'error', code: 'PAYLOAD_TOO_LARGE', message: '内容太大，图片请压缩后再发送。' });
      if (fallback.length > config.maxJsonBytes) {
        closeClient(client, 1009, 'payload too large');
        return false;
      }
      return sendFrame(client.socket, fallback, 0x1);
    }
    return sendFrame(client.socket, body, 0x1);
  }

  function broadcast(channelId, payload, except) {
    const body = serialize(payload);
    if (body.length > config.maxJsonBytes) return false;
    for (const client of clients) {
      if (client !== except && client.joined && client.session?.channelId === channelId && !client.closing) {
        if (client.syncing) queueSyncEvent(client, body);
        else sendFrame(client.socket, body, 0x1);
      }
    }
    return true;
  }

  function flushSyncQueue(client) {
    if (client.closing) return;
    const writeNext = () => {
      if (client.closing) return;
      const body = client.syncQueue.shift();
      if (!body) {
        client.syncQueueBytes = 0;
        if (client.syncTimer) clearTimeout(client.syncTimer);
        client.syncTimer = null;
        client.syncing = false;
        return;
      }
      client.syncQueueBytes = Math.max(0, client.syncQueueBytes - body.length - 14);
      const canContinue = sendFrame(client.socket, body, 0x1);
      if (client.closing || client.socket.destroyed) return;
      if (canContinue) setImmediate(writeNext);
      else client.socket.once('drain', () => {
        refreshSyncTimeout(client);
        writeNext();
      });
    };
    writeNext();
  }

  function queueSyncEvent(client, body) {
    const overhead = body.length + 14;
    if (client.syncQueueBytes + overhead + client.socket.writableLength > config.maxWritableBytes) {
      closeClient(client, 1008, 'sync overflow');
      return;
    }
    client.syncQueueBytes += overhead;
    client.syncQueue.push(body);
  }

  function closeClient(client, code = 1000, reason = '') {
    if (!client || client.closing || client.socket.destroyed) return;
    client.closing = true;
    if (client.syncTimer) clearTimeout(client.syncTimer);
    const reasonBuffer = Buffer.from(reason).subarray(0, 120);
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    sendFrame(client.socket, payload, 0x8);
    client.socket.end();
    if (!client.destroyTimer) {
      client.destroyTimer = setTimeout(() => {
        if (!client.socket.destroyed) client.socket.destroy();
      }, 1000);
      client.destroyTimer.unref?.();
    }
  }

  function sendError(client, code, message, clientMessageId) {
    const payload = { type: 'error', code, message };
    if (clientMessageId) payload.clientMessageId = clientMessageId;
    sendJson(client, payload);
  }

  function imageMagicMatches(mime, bytes) {
    if (mime === 'image/png') return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mime === 'image/gif') return bytes.length >= 10 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a');
    return mime === 'image/webp' && bytes.length >= 16 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  }

  function encodedImageDimensions(mime, bytes) {
    if (mime === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mime === 'image/gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
        if (offset + 4 > bytes.length) break;
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) return null;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
          return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
        }
        offset += 2 + length;
      }
      return null;
    }
    if (mime === 'image/webp' && bytes.length >= 30) {
      const kind = bytes.subarray(12, 16).toString();
      if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      }
      if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    }
    return null;
  }

  function parseImage(value) {
    if (!value || typeof value !== 'object' || typeof value.src !== 'string') return null;
    const match = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.src);
    if (!match) return null;
    const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
    let decoded;
    try { decoded = Buffer.from(match[2], 'base64'); } catch { return null; }
    if (!decoded.length || decoded.length > config.maxImageBytes || !imageMagicMatches(mime, decoded)) return null;
    const claimedWidth = Number.isFinite(value.width) ? Math.round(value.width) : null;
    const claimedHeight = Number.isFinite(value.height) ? Math.round(value.height) : null;
    if (!claimedWidth || !claimedHeight || claimedWidth < 1 || claimedHeight < 1 || claimedWidth > config.maxImageDimension || claimedHeight > config.maxImageDimension) return null;
    if (claimedWidth * claimedHeight > config.maxImagePixels) return null;
    const actual = encodedImageDimensions(mime, decoded);
    if (!actual || actual.width !== claimedWidth || actual.height !== claimedHeight) return null;
    return { src: value.src, mime, width: claimedWidth, height: claimedHeight, bytes: decoded.length };
  }

  function findReply(channel, id) {
    if (typeof id !== 'string') return null;
    const original = channel.messages.find((message) => message.id === id);
    if (!original) return null;
    return {
      id: original.id,
      username: original.author.username,
      kind: original.kind,
      text: original.kind === 'text' ? original.text : '图片'
    };
  }

  function rateAllows(client, bucket = 'message', maximum = 8, windowMs = 5000) {
    const now = Date.now();
    const stamps = client.rates[bucket] || [];
    client.rates[bucket] = stamps.filter((stamp) => now - stamp < windowMs);
    if (client.rates[bucket].length >= maximum) return false;
    client.rates[bucket].push(now);
    return true;
  }

  function reactionSummary(message) {
    const reactions = {};
    for (const [emoji, userIds] of message.reactionUsers || []) {
      if (userIds.size) reactions[emoji] = { count: userIds.size, userIds: [...userIds] };
    }
    return reactions;
  }

  function messageByteSize(message) {
    return Buffer.byteLength(JSON.stringify(publicMessage(message)));
  }

  function evictMessages(channel) {
    const removedIds = [];
    while (channel.messages.length > config.maxMessages || channel.roomBytes > config.maxRoomBytes) {
      const removed = channel.messages.shift();
      if (!removed) break;
      removedIds.push(removed.id);
      channel.roomBytes = Math.max(0, channel.roomBytes - removed.byteSize);
    }
    return removedIds;
  }

  function pruneDedupe() {
    const cutoff = Date.now() - config.dedupeTtlMs;
    for (const [key, value] of dedupe) {
      if (value.acceptedAt < cutoff || dedupe.size > config.maxDedupeEntries) dedupe.delete(key);
      else break;
    }
  }

  function payloadFingerprint(command, kind, text, image) {
    const hash = crypto.createHash('sha256');
    hash.update(kind);
    hash.update('\0');
    hash.update(text || image?.src || '');
    hash.update('\0');
    hash.update(typeof command.replyTo === 'string' ? command.replyTo : '');
    return hash.digest('hex');
  }

  function messageAck(message) {
    return {
      type: 'ack',
      clientMessageId: message.clientMessageId,
      messageId: message.id,
      seq: message.seq,
      createdAt: message.createdAt
    };
  }

  function historyChunks(channel, snapshot) {
    const chunks = [];
    let current = [];
    let currentSize = serialize({ type: 'history', roomEpoch: channel.epoch, messages: [] }).length;
    for (const message of snapshot) {
      const publicEntry = publicMessage(message);
      const entrySize = Buffer.byteLength(JSON.stringify(publicEntry)) + (current.length ? 1 : 0);
      if (current.length && currentSize + entrySize > config.maxJsonBytes) {
        chunks.push(current);
        current = [];
        currentSize = serialize({ type: 'history', roomEpoch: channel.epoch, messages: [] }).length;
      }
      if (currentSize + entrySize <= config.maxJsonBytes) {
        current.push(publicEntry);
        currentSize += entrySize;
      }
    }
    if (current.length || !chunks.length) chunks.push(current);
    return chunks;
  }

  function legacyMessages(channel) {
    const result = [];
    for (let index = channel.messages.length - 1; index >= 0; index -= 1) {
      const candidate = [publicMessage(channel.messages[index]), ...result];
      if (serialize({ type: 'state', messages: candidate }).length > config.maxJsonBytes) break;
      result.unshift(publicMessage(channel.messages[index]));
    }
    return result;
  }

  function refreshSyncTimeout(client) {
    if (client.syncTimer) clearTimeout(client.syncTimer);
    client.syncTimer = setTimeout(() => closeClient(client, 1008, 'sync timeout'), config.joinTimeoutMs);
    client.syncTimer.unref?.();
  }

  function queueInitialPayloads(client, payloads, index = 0) {
    if (client.closing) return;
    if (index >= payloads.length) {
      flushSyncQueue(client);
      return;
    }
    const canContinue = sendJson(client, payloads[index]);
    if (client.closing) return;
    refreshSyncTimeout(client);
    if (canContinue) {
      setImmediate(() => queueInitialPayloads(client, payloads, index + 1));
    } else {
      client.socket.once('drain', () => {
        refreshSyncTimeout(client);
        queueInitialPayloads(client, payloads, index + 1);
      });
    }
  }

  function sendInitialState(client, session, resumeToken) {
    const channel = channelStates.get(session.channelId);
    client.syncing = true;
    client.syncQueue.length = 0;
    refreshSyncTimeout(client);
    if (client.protocolVersion < 2) {
      const payload = {
        type: 'state',
        self: publicUser(session),
        users: rosterUsers(channel.config.id),
        messages: legacyMessages(channel),
        roomEpoch: channel.epoch,
        roomStartedAt: channel.startedAt,
        channelId: channel.config.id
      };
      sendJson(client, payload);
      flushSyncQueue(client);
      return;
    }
    const snapshot = [...channel.messages];
    const snapshotSeq = channel.messageSequence;
    const payloads = [{
      type: 'stateStart',
      protocolVersion: PROTOCOL_VERSION,
      capabilities: ['ack', 'historyChunks', 'roomEpoch', 'reconnect', 'reactions', 'typingLease'],
      roomEpoch: channel.epoch,
      roomStartedAt: channel.startedAt,
      latestSeq: snapshotSeq,
      resumeToken: resumeToken || null,
      self: publicUser(session),
      users: rosterUsers(channel.config.id),
      channelId: channel.config.id
    }];
    for (const chunk of historyChunks(channel, snapshot)) payloads.push({ type: 'history', roomEpoch: channel.epoch, messages: chunk });
    payloads.push({ type: 'historyEnd', roomEpoch: channel.epoch, latestSeq: snapshotSeq });
    queueInitialPayloads(client, payloads);
  }

  function deactivateTyping(client) {
    if (client.typingTimer) clearTimeout(client.typingTimer);
    client.typingTimer = null;
    if (!client.typingActive || !client.session) return;
    client.typingActive = false;
    broadcast(client.session.channelId, { type: 'typing', userId: client.session.id, username: client.session.username, active: false }, client);
  }

  function activateTyping(client) {
    if (client.typingTimer) clearTimeout(client.typingTimer);
    if (!client.typingActive) {
      client.typingActive = true;
      broadcast(client.session.channelId, { type: 'typing', userId: client.session.id, username: client.session.username, active: true }, client);
    }
    client.typingTimer = setTimeout(() => deactivateTyping(client), config.typingTtlMs);
    client.typingTimer.unref?.();
  }

  function validateClientId(value) {
    return typeof value === 'string' && CLIENT_ID_RE.test(value);
  }

  function handOffSession(session) {
    const oldClient = session.client;
    if (oldClient) {
      deactivateTyping(oldClient);
      closeClient(oldClient, 1000, 'reconnected');
      oldClient.session = null;
      oldClient.joined = false;
      session.client = null;
    }
    // Only disconnected sessions hold leases; an active member must never expire.
    const current = leasedSessions.get(session.token);
    if (current) clearTimeout(current.timer);
    leasedSessions.delete(session.token);
  }

  function resolveJoin(command) {
    const channelId = typeof command.channelId === 'string' && command.channelId ? command.channelId : config.defaultChannelId;
    const channel = channelStates.get(channelId);
    if (!channel || !channel.config.enabled) return { error: 'CHANNEL_UNAVAILABLE' };
    const nameKey = command.username.toLocaleLowerCase();
    const offered = typeof command.resumeToken === 'string' && CLIENT_ID_RE.test(command.resumeToken)
      ? command.resumeToken
      : command.clientSessionId;
    if (validateClientId(offered)) {
      const lease = leasedSessions.get(offered);
      if (lease && lease.expiresAt > Date.now()) {
        if (lease.session.nameKey !== nameKey || lease.session.channelId !== channelId) return { error: 'SESSION_CONFLICT' };
        clearTimeout(lease.timer);
        leasedSessions.delete(offered);
        return { nameKey, channelId, channel, token: offered, session: lease.session };
      }
      const session = sessions.get(offered);
      if (session) {
        if (session.nameKey !== nameKey || session.channelId !== channelId) return { error: 'SESSION_CONFLICT' };
        return { nameKey, channelId, channel, token: offered, session };
      }
    }
    if (!nameIsFree(nameKey, channelId)) return { error: 'NAME_TAKEN' };
    if (activeMembers().size >= config.maxUsers) return { error: 'SERVER_FULL' };
    if (activeMembers(channelId).size >= channel.config.maxUsers) return { error: 'CHANNEL_FULL' };
    const token = validateClientId(offered) && !leasedSessions.has(offered) ? offered : freshResumeToken();
    return { nameKey, channelId, channel, token, session: null };
  }

  function handleJoin(client, command) {
    if (client.joined) return;
    const username = cleanUsername(command.username);
    if (!username) {
      sendError(client, 'INVALID_NAME', '请输入 1–24 个字符的用户名。');
      return;
    }
    client.protocolVersion = Number(command.protocolVersion) || 1;
    const request = resolveJoin({ username, channelId: command.channelId, resumeToken: command.resumeToken, clientSessionId: command.clientSessionId });
    if (request.error === 'SESSION_CONFLICT') {
      sendError(client, 'SESSION_CONFLICT', '本页会话与频道不匹配。');
      return;
    }
    if (request.error === 'CHANNEL_UNAVAILABLE') {
      sendError(client, 'CHANNEL_UNAVAILABLE', '这个频道不存在或已停用。');
      return;
    }
    if (request.error === 'SERVER_FULL') {
      sendError(client, 'SERVER_FULL', '聊天室已达到管理员设置的用户上限。');
      return;
    }
    if (request.error === 'CHANNEL_FULL') {
      sendError(client, 'CHANNEL_FULL', '这个频道已达到管理员设置的人数上限。');
      return;
    }
    if (request.error) {
      sendError(client, 'NAME_TAKEN', '这个用户名已经在频道里了。换一个试试。');
      return;
    }

    const rawSeed = Number(command.avatarSeed);
    const requestedSeed = Number.isFinite(rawSeed) ? (Math.abs(Math.trunc(rawSeed)) >>> 0) : null;
    const session = request.session || {
      id: randomId('u'),
      username,
      nameKey: request.nameKey,
      channelId: request.channelId,
      ip: getAddress(client.socket),
      avatarSeed: requestedSeed ?? crypto.randomInt(0, 0x7fffffff),
      joinedAt: Date.now(),
      token: request.token
    };
    session.username = username;
    session.channelId = request.channelId;
    handOffSession(session);
    session.client = client;
    session.ip = getAddress(client.socket);
    client.session = session;
    client.joined = true;
    if (client.joinTimer) clearTimeout(client.joinTimer);
    sessions.set(request.token, session);

    sendInitialState(client, session, request.token);
    broadcast(request.channelId, { type: 'presence', action: request.session ? 'reconnect' : 'join', user: publicUser(session), users: rosterUsers(request.channelId) }, client);
  }

  function handleMessage(client, command) {
    const channel = channelStates.get(client.session.channelId);
    const clientMessageId = command.clientMessageId;
    const legacyMessage = client.protocolVersion < 2 && typeof clientMessageId !== 'string';
    if (!legacyMessage && !validateClientId(clientMessageId)) {
      sendError(client, 'INVALID_MESSAGE_ID', '消息标识无效，请重试。', typeof clientMessageId === 'string' ? clientMessageId : undefined);
      return;
    }
    const effectiveClientMessageId = legacyMessage ? randomId('legacy-message') : clientMessageId;
    const kind = command.kind;
    if (kind !== 'text' && kind !== 'image') {
      sendError(client, 'INVALID_KIND', '不支持这种消息类型。', clientMessageId);
      return;
    }
    const text = kind === 'text' ? cleanText(command.text, config.maxTextLength) : '';
    const image = kind === 'image' ? parseImage(command.image) : null;
    if (kind === 'text' && !text) {
      sendError(client, 'EMPTY_MESSAGE', '写点内容再发送。', clientMessageId);
      return;
    }
    if (kind === 'image' && !image) {
      sendError(client, 'INVALID_IMAGE', '图片格式、尺寸或大小不符合要求。', clientMessageId);
      return;
    }

    const fingerprint = payloadFingerprint(command, kind, text, image);
    const dedupeKey = `${channel.config.id}:${client.session.token}:${effectiveClientMessageId}`;
    const previous = dedupe.get(dedupeKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) sendError(client, 'MESSAGE_ID_CONFLICT', '消息标识已用于其他内容，请重新发送。', effectiveClientMessageId);
      else sendJson(client, previous.ack);
      return;
    }
    if (!rateAllows(client, 'message', config.messageRateLimit, config.rateLimitWindowMs)) {
      sendError(client, 'RATE_LIMITED', '发送太快了，请稍等几秒。', effectiveClientMessageId);
      return;
    }

    const sequence = ++channel.messageSequence;
    const message = {
      id: randomId(`m${sequence}`),
      seq: sequence,
      clientMessageId: effectiveClientMessageId,
      kind,
      author: publicUser(client.session),
      createdAt: Date.now(),
      replyTo: findReply(channel, command.replyTo),
      reactions: {}
    };
    if (kind === 'text') message.text = text;
    else message.image = image;
    message.reactionUsers = new Map();
    message.byteSize = messageByteSize(message);
    if (message.byteSize > config.maxRoomBytes) {
      sendError(client, 'ROOM_BUDGET_EXCEEDED', '这张图片超过了频道当前可用容量。', clientMessageId);
      return;
    }
    const historyEnvelope = serialize({ type: 'history', roomEpoch: channel.epoch, messages: [publicMessage(message)] });
    if (historyEnvelope.length > config.maxJsonBytes) {
      sendError(client, 'MESSAGE_TOO_LARGE', '这条内容超过单条历史容量，请压缩后再发送。', clientMessageId);
      return;
    }
    channel.messages.push(message);
    channel.roomBytes += message.byteSize;
    const removedIds = evictMessages(channel);
    const ack = messageAck(message);
    dedupe.set(dedupeKey, { acceptedAt: Date.now(), fingerprint, ack });
    pruneDedupe();
    sendJson(client, ack);
    broadcast(channel.config.id, { type: 'message', roomEpoch: channel.epoch, message: publicMessage(message), removedIds });
  }

  function handleReaction(client, command) {
    const channel = channelStates.get(client.session.channelId);
    if (!rateAllows(client, 'reaction', config.reactionRateLimit, config.rateLimitWindowMs)) {
      sendError(client, 'REACTION_RATE_LIMITED', '回应太快了，请稍等。');
      return;
    }
    if (typeof command.messageId !== 'string' || !REACTION_EMOJIS.has(command.emoji) || typeof command.active !== 'boolean') {
      sendError(client, 'INVALID_REACTION', '不支持这个回应。');
      return;
    }
    const message = channel.messages.find((item) => item.id === command.messageId);
    if (!message) {
      sendError(client, 'MESSAGE_GONE', '这条消息已经离开临时历史。');
      return;
    }
    let userIds = message.reactionUsers.get(command.emoji);
    if (!userIds) {
      userIds = new Set();
      message.reactionUsers.set(command.emoji, userIds);
    }
    if (command.active) userIds.add(client.session.id);
    else userIds.delete(client.session.id);
    if (!userIds.size) message.reactionUsers.delete(command.emoji);
    message.reactions = reactionSummary(message);
    const oldSize = message.byteSize;
    message.byteSize = messageByteSize(message);
    channel.roomBytes += message.byteSize - oldSize;
    const removedIds = evictMessages(channel);
    if (removedIds.includes(message.id)) {
      broadcast(channel.config.id, { type: 'prune', roomEpoch: channel.epoch, removedIds });
      return;
    }
    broadcast(channel.config.id, { type: 'reaction', roomEpoch: channel.epoch, messageId: message.id, reactions: message.reactions, removedIds });
  }

  function handleSwitchChannel(client, command) {
    const session = client.session;
    const target = channelStates.get(command.channelId);
    if (!target?.config.enabled) return sendError(client, 'CHANNEL_UNAVAILABLE', '这个频道不存在或已停用。');
    if (session.channelId === command.channelId) return sendInitialState(client, session, session.token);
    if (!rateAllows(client, 'switch', 8, 5000)) return sendError(client, 'RATE_LIMITED', '切换太快了，请稍后再试。');
    if (!nameIsFree(session.nameKey, command.channelId, session.token)) return sendError(client, 'NAME_TAKEN', '目标频道已有同名成员。');
    if (activeMembers(command.channelId).size >= target.config.maxUsers) return sendError(client, 'CHANNEL_FULL', '这个频道已达到管理员设置的人数上限。');
    const previousChannelId = session.channelId;
    deactivateTyping(client);
    session.channelId = command.channelId;
    broadcast(previousChannelId, { type: 'presence', action: 'leave', userId: session.id, username: session.username, users: rosterUsers(previousChannelId) });
    sendInitialState(client, session, session.token);
    broadcast(session.channelId, { type: 'presence', action: 'join', user: publicUser(session), users: rosterUsers(session.channelId) }, client);
  }

  function handleCommand(client, command) {
    if (client.closing) return;
    if (!command || typeof command !== 'object' || typeof command.type !== 'string') {
      sendError(client, 'BAD_REQUEST', '无法识别这条请求。');
      return;
    }
    if (command.type === 'join') return handleJoin(client, command);
    if (!client.joined || !client.session) {
      sendError(client, 'NOT_JOINED', '请先进入频道。');
      return;
    }
    if (client.syncing && command.type !== 'leave') {
      // The correlation ID is what lets the sender turn this into a retryable
      // failure instead of leaving the message stuck as "unconfirmed".
      sendError(client, 'SYNC_IN_PROGRESS', '历史同步中，请稍候。',
        typeof command.clientMessageId === 'string' ? command.clientMessageId : undefined);
      return;
    }
    if (command.type === 'typing') {
      if (!rateAllows(client, 'typing', config.typingRateLimit, config.rateLimitWindowMs)) return;
      if (command.active) activateTyping(client);
      else deactivateTyping(client);
      return;
    }
    if (command.type === 'switchChannel' && client.protocolVersion >= 3) return handleSwitchChannel(client, command);
    if (command.type === 'message') return handleMessage(client, command);
    if (command.type === 'reaction') return handleReaction(client, command);
    if (command.type === 'leave') {
      client.intentionalLeave = true;
      closeClient(client, 1000, 'left');
      return;
    }
    sendError(client, 'UNKNOWN_COMMAND', '频道不支持这项操作。');
  }

  const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

  function processText(client, payload) {
    if (payload.length > config.maxJsonBytes) return closeClient(client, 1009, 'payload too large');
    let text;
    try { text = TEXT_DECODER.decode(payload); }
    catch {
      closeClient(client, 1007, 'invalid utf-8');
      return;
    }
    let command;
    try { command = JSON.parse(text); }
    catch {
      sendError(client, 'BAD_JSON', '请求格式不正确。');
      return;
    }
    handleCommand(client, command);
  }

  function consumeFrames(client, chunk) {
    if (client.closing) return;
    client.buffer = Buffer.concat([client.buffer, chunk]);
    let frames = 0;
    while (client.buffer.length >= 2 && !client.socket.destroyed && !client.closing) {
      if (++frames > 128) {
        closeClient(client, 1008, 'too many frames');
        return;
      }
      const first = client.buffer[0];
      const second = client.buffer[1];
      const fin = Boolean(first & 0x80);
      const rsv = first & 0x70;
      const opcode = first & 0x0f;
      const control = opcode >= 0x8;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (rsv || !masked || (control && (!fin || length > 125))) {
        closeClient(client, 1002, 'protocol error');
        return;
      }
      if (length === 126) {
        if (client.buffer.length < 4) return;
        length = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (client.buffer.length < 10) return;
        const longLength = client.buffer.readBigUInt64BE(2);
        if (longLength > BigInt(config.maxWsFrameBytes)) {
          closeClient(client, 1009, 'payload too large');
          return;
        }
        length = Number(longLength);
        offset = 10;
      }
      if (control && length > 125) {
        closeClient(client, 1002, 'control frame too large');
        return;
      }
      if (length > config.maxWsFrameBytes) {
        closeClient(client, 1009, 'payload too large');
        return;
      }
      if (client.buffer.length < offset + 4 + length) return;
      const mask = client.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
      client.buffer = client.buffer.subarray(offset + length);
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];

      if (opcode === 0x9) {
        sendFrame(client.socket, payload, 0xA);
        continue;
      }
      if (opcode === 0xA) {
        client.lastPong = Date.now();
        client.pingSentAt = 0;
        client.awaitingPong = false;
        continue;
      }
      if (opcode === 0x8) {
        closeClient(client, 1000, 'bye');
        return;
      }
      if (opcode === 0x2) {
        closeClient(client, 1003, 'text only');
        return;
      }
      if (opcode === 0x0) {
        if (!client.fragmented) {
          closeClient(client, 1002, 'unexpected continuation');
          return;
        }
        client.fragments.push(payload);
        client.fragmentBytes += payload.length;
        if (client.fragmentBytes > config.maxJsonBytes) {
          closeClient(client, 1009, 'payload too large');
          return;
        }
        if (fin) {
          const complete = Buffer.concat(client.fragments);
          client.fragmented = false;
          client.fragments = [];
          client.fragmentBytes = 0;
          processText(client, complete);
        }
        continue;
      }
      if (opcode !== 0x1 || client.fragmented) {
        closeClient(client, 1002, 'unsupported opcode');
        return;
      }
      if (fin) processText(client, payload);
      else {
        client.fragmented = true;
        client.fragments = [payload];
        client.fragmentBytes = payload.length;
      }
    }
  }

  function removeClient(client) {
    if (!client || client.removed) return;
    client.removed = true;
    clients.delete(client);
    if (client.joinTimer) clearTimeout(client.joinTimer);
    if (client.syncTimer) clearTimeout(client.syncTimer);
    if (client.destroyTimer) clearTimeout(client.destroyTimer);
    client.syncQueue.length = 0;
    client.syncQueueBytes = 0;
    deactivateTyping(client);
    if (!client.session) return;
    const session = client.session;
    client.session = null;
    client.joined = false;
    if (session.client !== client) return;
    sessions.delete(session.token);
    session.client = null;
    if (!shuttingDown && !client.intentionalLeave) {
      const lease = { session, expiresAt: Date.now() + config.sessionLeaseMs, timer: null };
      lease.timer = setTimeout(() => {
        const current = leasedSessions.get(session.token);
        if (current !== lease) return;
        leasedSessions.delete(session.token);
        broadcast(session.channelId, { type: 'presence', action: 'leave', userId: session.id, username: session.username, users: rosterUsers(session.channelId) });
      }, config.sessionLeaseMs);
      lease.timer.unref?.();
      leasedSessions.set(session.token, lease);
    } else if (!shuttingDown) {
      broadcast(session.channelId, { type: 'presence', action: 'leave', userId: session.id, username: session.username, users: rosterUsers(session.channelId) });
    }
  }

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
      const vendorRoot = path.join(ROOT, 'vendor');
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

  // `index.html` and `chat.css` are the only files Pavilo serves from its own root,
  // and the loader in config.js refuses to treat either as a config source for the
  // same reason. Both carry a CSP that allows the inline bootstrap script the page
  // needs before the stylesheet has been parsed.
  async function serveAppFile(request, response, filename, headOnly = false) {
    const extension = path.extname(filename).toLowerCase();
    const type = MIME_TYPES[extension] || 'application/octet-stream';
    fs.readFile(path.join(ROOT, filename), async (error, data) => {
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

  function localAddresses() {
    const addresses = [];
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
      }
    }
    return [...new Set(addresses)];
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

  const server = http.createServer((request, response) => {
    let requestUrl;
    try { requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`); }
    catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }
    const isHead = request.method === 'HEAD';
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/healthz') {
      const channelStats = [...channelStates.values()].map((channel) => ({
        id: channel.config.id,
        users: activeMembers(channel.config.id).size,
        messages: channel.messages.length,
        roomBytes: channel.roomBytes
      }));
      jsonResponse(response, 200, { ok: true, users: sessions.size, messages: channelStats.reduce((total, item) => total + item.messages, 0), roomBytes: channelStats.reduce((total, item) => total + item.roomBytes, 0), clients: clients.size, ephemeral: true }, isHead);
      return;
    }
    if ((request.method === 'GET' || isHead) && requestUrl.pathname === '/room-info') {
      const activePort = server.address()?.port || config.port;
      jsonResponse(response, 200, {
        protocolVersion: PROTOCOL_VERSION,
        roomEpoch,
        localUrl: `http://localhost:${activePort}`,
        // Every interface address the host has is more than a convenience: it maps
        // the machine's network position for anyone who can reach the port. The
        // roster has its own switch for the same reason.
        lanUrls: config.exposeLanUrls ? localAddresses().map((address) => `http://${address}:${activePort}`) : [],
        roomTitle: config.roomTitle,
        defaultChannelId: config.defaultChannelId,
        channels: publicChannels(),
        limits: publicLimits(),
        ephemeral: true
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
  });

  function validOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return config.allowNoOrigin;
    if (Array.isArray(config.allowedOrigins) && config.allowedOrigins.includes(origin)) return true;
    let parsed;
    try { parsed = new URL(origin); } catch { return false; }
    const host = request.headers.host;
    return Boolean(host) && parsed.host === host && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  }

  function rejectUpgrade(socket, status = '400 Bad Request') {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  server.on('upgrade', (request, socket, head) => {
    let requestUrl;
    try { requestUrl = new URL(request.url, `http://${request.headers.host || 'invalid'}`); }
    catch { rejectUpgrade(socket); return; }
    const key = request.headers['sec-websocket-key'];
    const version = request.headers['sec-websocket-version'];
    const upgrade = String(request.headers.upgrade || '').toLowerCase();
    const connectionTokens = String(request.headers.connection || '').toLowerCase().split(',').map((item) => item.trim());
    const validKey = typeof key === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(key);
    if (shuttingDown || requestUrl.pathname !== '/ws' || !validKey || version !== '13' || upgrade !== 'websocket' || !connectionTokens.includes('upgrade') || !validOrigin(request)) {
      rejectUpgrade(socket, shuttingDown ? '503 Service Unavailable' : '403 Forbidden');
      return;
    }
    const ip = getAddress(socket);
    const perIp = [...clients].filter((client) => client.ip === ip).length;
    if (clients.size >= config.maxClients || perIp >= config.maxClientsPerIp) {
      rejectUpgrade(socket, '503 Service Unavailable');
      return;
    }
    const accept = crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ].join('\r\n'));
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    const client = {
      socket,
      ip,
      session: null,
      joined: false,
      closing: false,
      removed: false,
      intentionalLeave: false,
      buffer: Buffer.alloc(0),
      fragments: [],
      fragmented: false,
      fragmentBytes: 0,
      rates: Object.create(null),
      lastPong: Date.now(),
      pingSentAt: 0,
      awaitingPong: false,
      typingActive: false,
      typingTimer: null,
      joinTimer: null,
      protocolVersion: 1,
      syncing: false,
      syncQueue: [],
      syncQueueBytes: 0,
      syncTimer: null,
      destroyTimer: null
    };
    client.joinTimer = setTimeout(() => closeClient(client, 1008, 'join timeout'), config.joinTimeoutMs);
    client.joinTimer.unref?.();
    clients.add(client);
    socket.on('data', (chunk) => consumeFrames(client, chunk));
    socket.on('error', () => removeClient(client));
    socket.on('end', () => { removeClient(client); socket.destroy(); });
    socket.on('close', () => removeClient(client));
    if (head?.length) consumeFrames(client, head);
  });

  server.on('clientError', (_error, socket) => {
    if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  function startHeartbeat() {
    heartbeat = setInterval(() => {
      const now = Date.now();
      pruneDedupe();
      for (const client of clients) {
        if (client.socket.destroyed) {
          removeClient(client);
          continue;
        }
        if (client.awaitingPong && now - client.pingSentAt > config.heartbeatTimeoutMs) {
          closeClient(client, 1001, 'heartbeat timeout');
          continue;
        }
        if (!client.awaitingPong) {
          client.awaitingPong = true;
          client.pingSentAt = now;
          sendFrame(client.socket, Buffer.alloc(0), 0x9);
        }
      }
    }, config.heartbeatIntervalMs);
    heartbeat.unref?.();
  }

  function listen(port = config.port, host = config.host) {
    if (lifecycle !== 'created') return Promise.reject(new Error(`server cannot listen while ${lifecycle}`));
    lifecycle = 'starting';
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        pendingStartup = null;
        callback(value);
      };
      const onError = (error) => {
        server.off('listening', onListening);
        if (!shuttingDown) lifecycle = 'created';
        settle(reject, error);
      };
      const onListening = () => {
        server.off('error', onError);
        lifecycle = 'listening';
        if (shuttingDown) {
          server.close(() => {});
        } else {
          startHeartbeat();
        }
        settle(resolve, server.address());
      };
      pendingStartup = { resolve, reject };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  async function stop(signal) {
    if (lifecycle === 'stopped' || lifecycle === 'stopping') return;
    const wasStarting = lifecycle === 'starting';
    shuttingDown = true;
    lifecycle = 'stopping';
    if (wasStarting && pendingStartup) {
      try { await pendingStartup; } catch { /* startup failed; continue cleanup */ }
    }
    if (pendingStartup) pendingStartup = null;
    if (heartbeat) clearInterval(heartbeat);
    for (const lease of leasedSessions.values()) clearTimeout(lease.timer);
    leasedSessions.clear();
    for (const channel of channelStates.values()) {
      channel.messages.length = 0;
      channel.roomBytes = 0;
      channel.messageSequence = 0;
    }
    sessions.clear();
    dedupe.clear();
    for (const client of clients) {
      client.intentionalLeave = true;
      closeClient(client, 1001, 'server stopped');
    }
    await new Promise((resolve) => {
      if (!server.listening) { resolve(); return; }
      server.close(resolve);
      setTimeout(resolve, 1500).unref();
    });
    for (const client of clients) client.socket.destroy();
    clients.clear();
    lifecycle = 'stopped';
    if (signal) process.stdout.write(`\n${signal}: 语亭房间已清空，服务已停止。\n`);
  }

  return {
    server,
    listen,
    stop,
    roomEpoch,
    localAddresses,
    config,
    state: () => {
      const channels = [...channelStates.values()].map((channel) => ({ id: channel.config.id, messages: channel.messages.length, roomBytes: channel.roomBytes, latestSeq: channel.messageSequence }));
      return {
        clients: clients.size,
        sessions: sessions.size,
        messages: channels.reduce((total, channel) => total + channel.messages, 0),
        roomBytes: channels.reduce((total, channel) => total + channel.roomBytes, 0),
        latestSeq: channelStates.get(config.defaultChannelId).messageSequence
      };
    }
  };
}

module.exports = { createChatServer, DEFAULTS, PROTOCOL_VERSION, REACTION_EMOJIS: [...REACTION_EMOJIS] };

if (require.main === module) {
  let loaded;
  try {
    loaded = loadConfig();
  } catch (error) {
    process.stderr.write(`无法加载语亭配置：${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const app = createChatServer(loaded.config);
  app.listen().then((address) => {
    const port = typeof address === 'object' && address ? address.port : DEFAULTS.port;
    process.stdout.write(`Pavilo / 语亭 listening on http://localhost:${port}\n`);
    const addresses = app.localAddresses();
    if (addresses.length) {
      for (const ip of addresses) process.stdout.write(`LAN access: http://${ip}:${port}\n`);
    } else {
      process.stdout.write('LAN access: use the host machine\'s local IP address.\n');
    }
    process.stdout.write(`Config: ${loaded.configPath || 'built-in defaults'} (restart to apply changes)\n`);
    process.stdout.write('Ephemeral mode: messages and presence live in memory only.\n');
  }).catch((error) => {
    if (error.code === 'EADDRINUSE') {
      process.stderr.write(`无法启动：端口 ${loaded.config.port} 已被占用。可使用 PORT=4187 npm start 更换端口。\n`);
    } else {
      process.stderr.write(`无法启动语亭聊天室：${error.message}\n`);
    }
    process.exitCode = 1;
  });
  const shutdown = (signal) => app.stop(signal).finally(() => process.exit(0));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
