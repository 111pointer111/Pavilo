'use strict';

const crypto = require('node:crypto');

function createMemoryStore(config, runtime = {}) {
  const now = runtime.now || Date.now;
  const randomId = runtime.randomId || ((prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`);
  const channels = new Map();
  const dedupe = new Map();

  function createChannel(channelId) {
    return {
      id: channelId,
      epoch: randomId(`room-${channelId}`),
      startedAt: now(),
      messages: [],
      latestSeq: 0,
      roomBytes: 0
    };
  }

  function ensureChannel(channelId) {
    if (!channels.has(channelId)) channels.set(channelId, createChannel(channelId));
    return channels.get(channelId);
  }

  for (const channel of config.channels) ensureChannel(channel.id);

  function requireChannel(channelId) {
    const channel = channels.get(channelId);
    if (!channel) throw new Error(`Unknown channel "${channelId}"`);
    return channel;
  }

  function idempotencyKey(scope, clientMessageId) {
    return `${scope}:${clientMessageId}`;
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
    return requireChannel(channelId).messages.find((message) => message.id === messageId) || null;
  }

  function findIdempotent(scope, clientMessageId) {
    return dedupe.get(idempotencyKey(scope, clientMessageId)) || null;
  }

  function incrementSeq(channelId) {
    return ++requireChannel(channelId).latestSeq;
  }

  function appendMessage(channelId, message, { idempotency } = {}) {
    const channel = requireChannel(channelId);
    channel.messages.push(message);
    channel.roomBytes += message.byteSize;
    const removedIds = evictWorkingSet(channel);
    if (idempotency) {
      dedupe.set(idempotencyKey(idempotency.scope, idempotency.clientMessageId), {
        fingerprint: idempotency.fingerprint,
        ack: idempotency.ack,
        acceptedAt: now()
      });
    }
    return { removedIds };
  }

  function reviseMessage(channelId, messageId, apply) {
    const channel = requireChannel(channelId);
    const message = channel.messages.find((item) => item.id === messageId);
    if (!message) return null;
    const oldSize = message.byteSize || 0;
    apply(message);
    channel.roomBytes += (message.byteSize || 0) - oldSize;
    if (channel.roomBytes < 0) channel.roomBytes = 0;
    const removedIds = evictWorkingSet(channel);
    return { message, removedIds };
  }

  function updateReactions(channelId, messageId, apply) {
    const channel = requireChannel(channelId);
    const message = channel.messages.find((item) => item.id === messageId);
    if (!message) return null;
    const oldSize = message.byteSize;
    apply(message);
    channel.roomBytes += message.byteSize - oldSize;
    const removedIds = evictWorkingSet(channel);
    return { message: removedIds.includes(message.id) ? null : message, removedIds };
  }

  function listMessagesByAuthor(authorId, { beforeCreatedAt, beforeChannelId, beforeId, limit = 50 } = {}) {
    const cap = Math.min(Math.max(1, Number(limit) || 50), 100);
    const rows = [];
    for (const channel of channels.values()) {
      for (const message of channel.messages) {
        if (message.author?.id !== authorId) continue;
        if (Number.isFinite(beforeCreatedAt) && beforeCreatedAt > 0) {
          if (message.createdAt > beforeCreatedAt) continue;
          if (message.createdAt === beforeCreatedAt) {
            if (beforeChannelId && channel.id > beforeChannelId) continue;
            if (beforeChannelId && channel.id === beforeChannelId && beforeId && message.id >= beforeId) continue;
            if (!beforeChannelId && beforeId && message.id >= beforeId) continue;
          }
        }
        rows.push({ channelId: channel.id, message });
      }
    }
    rows.sort((left, right) => (right.message.createdAt - left.message.createdAt)
      || right.channelId.localeCompare(left.channelId)
      || right.message.id.localeCompare(left.message.id));
    const page = rows.slice(0, cap + 1);
    return { messages: page.slice(0, cap), exhausted: page.length <= cap };
  }

  function loadHistoryPage(channelId, { beforeSeq, limit = 50 } = {}) {
    const cap = Math.min(Math.max(1, Number(limit) || 50), 100);
    const channel = requireChannel(channelId);
    const older = channel.messages.filter((message) => message.seq < beforeSeq);
    const start = Math.max(0, older.length - cap);
    return { messages: older.slice(start), exhausted: start === 0 };
  }

  function pruneDedupe() {
    const cutoff = now() - config.dedupeTtlMs;
    for (const [key, value] of dedupe) {
      if (value.acceptedAt < cutoff || dedupe.size > config.maxDedupeEntries) dedupe.delete(key);
      else break;
    }
  }

  function pruneExpired() {
    return { deleted: 0 };
  }

  function stats() {
    return [...channels.values()].map((channel) => ({
      id: channel.id,
      messages: channel.messages.length,
      roomBytes: channel.roomBytes,
      latestSeq: channel.latestSeq
    }));
  }

  function integrity() {
    return { ok: true, driver: 'memory' };
  }

  function backup() {
    throw new Error('memory store does not support backup');
  }

  function clear() {
    for (const channel of channels.values()) {
      channel.messages.length = 0;
      channel.roomBytes = 0;
      channel.latestSeq = 0;
    }
    dedupe.clear();
  }

  function close() {}

  return {
    driver: 'memory',
    ephemeral: true,
    getChannelState,
    ensureChannel,
    loadWorkingSet,
    getMessage,
    findIdempotent,
    incrementSeq,
    appendMessage,
    reviseMessage,
    updateReactions,
    loadHistoryPage,
    listMessagesByAuthor,
    pruneDedupe,
    pruneExpired,
    stats,
    integrity,
    backup,
    clear,
    close
  };
}

module.exports = { createMemoryStore };
