'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { openSqliteEngine } = require('./sqlite-engine');
const { applyMigrations } = require('./migrations');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function serializeMessage(message) {
  return JSON.stringify({
    ...message,
    reactionUsers: [...(message.reactionUsers || new Map())].map(([emoji, ids]) => [emoji, [...ids]])
  });
}

function deserializeMessage(payload) {
  const message = JSON.parse(payload);
  message.reactionUsers = new Map((message.reactionUsers || []).map(([emoji, ids]) => [emoji, new Set(ids)]));
  if (!message.reactions) message.reactions = {};
  return message;
}

function createSqliteStore(config, runtime = {}) {
  const sqlite = config.storage?.sqlite;
  if (!sqlite?.path) throw new Error('sqlite store requires storage.sqlite.path');
  const now = runtime.now || Date.now;
  const randomId = runtime.randomId || ((prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`);
  const ownsEngine = !runtime.engine;
  const engine = runtime.engine || openSqliteEngine(sqlite);
  applyMigrations(engine);

  const selectChannel = engine.prepare('SELECT id, epoch, started_at, latest_seq FROM channels WHERE id = ?');
  const insertChannel = engine.prepare('INSERT INTO channels (id, epoch, started_at, latest_seq) VALUES (?, ?, ?, ?)');
  const updateSeq = engine.prepare('UPDATE channels SET latest_seq = ? WHERE id = ?');
  const insertMessage = engine.prepare('INSERT INTO messages (channel_id, id, seq, created_at, payload) VALUES (?, ?, ?, ?, ?)');
  const updateMessage = engine.prepare('UPDATE messages SET payload = ? WHERE channel_id = ? AND id = ?');
  const selectMessageById = engine.prepare('SELECT payload FROM messages WHERE channel_id = ? AND id = ?');
  const selectMessagePayloads = engine.prepare('SELECT payload FROM messages WHERE channel_id = ? ORDER BY seq DESC');
  const selectHistory = engine.prepare('SELECT payload FROM messages WHERE channel_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?');
  const selectIdempotent = engine.prepare('SELECT fingerprint, result, created_at FROM idempotency WHERE scope = ? AND client_message_id = ?');
  const insertIdempotent = engine.prepare('INSERT INTO idempotency (scope, client_message_id, fingerprint, result, created_at) VALUES (?, ?, ?, ?, ?)');
  const deleteExpiredMessages = engine.prepare('DELETE FROM messages WHERE created_at < ?');
  const deleteExpiredBatch = engine.prepare('DELETE FROM messages WHERE rowid IN (SELECT rowid FROM messages WHERE created_at < ? LIMIT ?)');
  const deleteExpiredIdempotency = engine.prepare('DELETE FROM idempotency WHERE created_at < ?');
  const deleteExpiredIdempotencyBatch = engine.prepare('DELETE FROM idempotency WHERE rowid IN (SELECT rowid FROM idempotency WHERE created_at < ? LIMIT ?)');
  const countMessages = engine.prepare('SELECT COUNT(*) AS count FROM messages WHERE channel_id = ?');
  const selectAuthorFirst = engine.prepare(`
    SELECT channel_id AS channelId, payload FROM messages
    WHERE json_extract(payload, '$.author.id') = ?
    ORDER BY created_at DESC, channel_id DESC, id DESC
    LIMIT ?
  `);
  const selectAuthorPage = engine.prepare(`
    SELECT channel_id AS channelId, payload FROM messages
    WHERE json_extract(payload, '$.author.id') = ?
      AND (
        created_at < ?
        OR (created_at = ? AND (channel_id < ? OR (channel_id = ? AND id < ?)))
      )
    ORDER BY created_at DESC, channel_id DESC, id DESC
    LIMIT ?
  `);
  const inventoryQuery = engine.prepare('SELECT channel_id AS id, COUNT(*) AS messages, MIN(created_at) AS earliest, MAX(created_at) AS latest FROM messages GROUP BY channel_id');

  const channels = new Map();

  function hydrateWorkingSet(channelId) {
    const messages = [];
    let roomBytes = 0;
    for (const row of selectMessagePayloads.all(channelId)) {
      const message = deserializeMessage(row.payload);
      if (messages.length >= config.maxMessages || roomBytes + message.byteSize > config.maxRoomBytes) break;
      messages.push(message);
      roomBytes += message.byteSize;
    }
    messages.reverse();
    return { messages, roomBytes };
  }

  function ensureChannel(channelId) {
    const existing = selectChannel.get(channelId);
    if (existing) {
      const working = hydrateWorkingSet(channelId);
      channels.set(channelId, {
        id: channelId,
        epoch: existing.epoch,
        startedAt: existing.started_at,
        latestSeq: existing.latest_seq,
        messages: working.messages,
        roomBytes: working.roomBytes
      });
      return;
    }
    const channel = {
      id: channelId,
      epoch: randomId(`room-${channelId}`),
      startedAt: now(),
      latestSeq: 0,
      messages: [],
      roomBytes: 0
    };
    insertChannel.run(channel.id, channel.epoch, channel.startedAt, channel.latestSeq);
    channels.set(channelId, channel);
  }

  for (const channel of config.channels) ensureChannel(channel.id);

  function requireChannel(channelId) {
    const channel = channels.get(channelId);
    if (!channel) throw new Error(`Unknown channel "${channelId}"`);
    return channel;
  }

  function evictWorkingSet(channel) {
    const removedIds = [];
    while (channel.messages.length > config.maxMessages || channel.roomBytes > config.maxRoomBytes) {
      const removed = channel.messages.shift();
      if (!removed) break;
      removedIds.push(removed.id);
      channel.roomBytes = Math.max(0, channel.roomBytes - removed.byteSize);
    }
    return removedIds;
  }

  function getChannelState(channelId) {
    const channel = channels.get(channelId);
    if (!channel) return undefined;
    return { epoch: channel.epoch, startedAt: channel.startedAt, latestSeq: channel.latestSeq, roomBytes: channel.roomBytes };
  }

  function loadWorkingSet(channelId) {
    return requireChannel(channelId).messages;
  }

  function getMessage(channelId, messageId) {
    if (typeof messageId !== 'string') return null;
    const working = requireChannel(channelId).messages.find((message) => message.id === messageId);
    if (working) return working;
    const row = selectMessageById.get(channelId, messageId);
    return row ? deserializeMessage(row.payload) : null;
  }

  function findIdempotent(scope, clientMessageId) {
    const row = selectIdempotent.get(scope, clientMessageId);
    if (!row) return null;
    return { fingerprint: row.fingerprint, ack: JSON.parse(row.result), acceptedAt: row.created_at };
  }

  function incrementSeq(channelId) {
    const channel = requireChannel(channelId);
    const seq = ++channel.latestSeq;
    updateSeq.run(seq, channelId);
    return seq;
  }

  function appendMessage(channelId, message, { idempotency } = {}) {
    const channel = requireChannel(channelId);
    engine.transaction(() => {
      insertMessage.run(channelId, message.id, message.seq, message.createdAt, serializeMessage(message));
      if (idempotency) {
        insertIdempotent.run(idempotency.scope, idempotency.clientMessageId, idempotency.fingerprint, JSON.stringify(idempotency.ack), now());
      }
    });
    channel.messages.push(message);
    channel.roomBytes += message.byteSize;
    return { removedIds: evictWorkingSet(channel) };
  }

  function updateReactions(channelId, messageId, apply) {
    const channel = requireChannel(channelId);
    let message = channel.messages.find((item) => item.id === messageId);
    const inWorkingSet = Boolean(message);
    if (!message) {
      const row = selectMessageById.get(channelId, messageId);
      if (!row) return null;
      message = deserializeMessage(row.payload);
    }
    const oldSize = message.byteSize;
    apply(message);
    engine.transaction(() => {
      updateMessage.run(serializeMessage(message), channelId, messageId);
    });
    if (!inWorkingSet) return { message, removedIds: [] };
    channel.roomBytes += message.byteSize - oldSize;
    const removedIds = evictWorkingSet(channel);
    return { message: removedIds.includes(message.id) ? null : message, removedIds };
  }

  function listMessagesByAuthor(authorId, { beforeCreatedAt, beforeChannelId, beforeId, limit = 50 } = {}) {
    const cap = Math.min(Math.max(1, Number(limit) || 50), 100);
    const rows = Number.isFinite(beforeCreatedAt)
      ? selectAuthorPage.all(authorId, beforeCreatedAt, beforeCreatedAt, beforeChannelId || '', beforeChannelId || '', beforeId || '', cap + 1)
      : selectAuthorFirst.all(authorId, cap + 1);
    return {
      messages: rows.slice(0, cap).map((row) => ({ channelId: row.channelId, message: deserializeMessage(row.payload) })),
      exhausted: rows.length <= cap
    };
  }

  function loadHistoryPage(channelId, { beforeSeq, limit = 50 } = {}) {
    requireChannel(channelId);
    const cap = Math.min(Math.max(1, Number(limit) || 50), 100);
    const rows = selectHistory.all(channelId, beforeSeq, cap + 1);
    const exhausted = rows.length <= cap;
    return {
      messages: rows.slice(0, cap).reverse().map((row) => deserializeMessage(row.payload)),
      exhausted
    };
  }

  function pruneDedupe() {}

  function pruneExpired(clock = now(), { limit } = {}) {
    if (sqlite.retentionDays == null) return { deleted: 0 };
    const cutoff = clock - sqlite.retentionDays * MS_PER_DAY;
    let deleted = 0;
    engine.transaction(() => {
      if (Number.isSafeInteger(limit) && limit > 0) {
        deleted = deleteExpiredBatch.run(cutoff, limit).changes;
        deleteExpiredIdempotencyBatch.run(cutoff, limit);
      } else {
        deleted = deleteExpiredMessages.run(cutoff).changes;
        deleteExpiredIdempotency.run(cutoff);
      }
    });
    for (const channel of channels.values()) {
      const kept = channel.messages.filter((message) => message.createdAt >= cutoff);
      if (kept.length !== channel.messages.length) {
        channel.messages = kept;
        channel.roomBytes = kept.reduce((total, message) => total + message.byteSize, 0);
      }
    }
    return { deleted };
  }

  function stats() {
    return [...channels.values()].map((channel) => ({
      id: channel.id,
      messages: channel.messages.length,
      roomBytes: channel.roomBytes,
      latestSeq: channel.latestSeq
    }));
  }

  function inventory() {
    const rows = inventoryQuery.all();
    let bytes = 0;
    try { bytes = fs.statSync(sqlite.path).size; } catch { /* new file */ }
    return {
      bytes,
      messages: rows.reduce((total, row) => total + row.messages, 0),
      channels: rows.map((row) => ({
        id: row.id,
        messages: row.messages,
        earliest: row.earliest,
        latest: row.latest
      }))
    };
  }

  function integrity() {
    const row = engine.prepare('PRAGMA integrity_check').get();
    const result = row && (row.integrity_check || Object.values(row)[0]);
    return { ok: result === 'ok', driver: 'sqlite', engine: engine.name, result };
  }

  function backup(dest) {
    const escaped = String(dest).replaceAll("'", "''");
    engine.exec(`VACUUM INTO '${escaped}'`);
  }

  function clear() {}

  function close() {
    if (ownsEngine) engine.close();
  }

  return {
    driver: 'sqlite',
    engine: engine.name,
    ephemeral: false,
    getChannelState,
    ensureChannel,
    loadWorkingSet,
    getMessage,
    findIdempotent,
    incrementSeq,
    appendMessage,
    updateReactions,
    loadHistoryPage,
    listMessagesByAuthor,
    pruneDedupe,
    pruneExpired,
    stats,
    inventory,
    integrity,
    backup,
    clear,
    close,
    durableMessageCount: (channelId) => countMessages.get(channelId).count
  };
}

module.exports = { createSqliteStore };
