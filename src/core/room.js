'use strict';

const { publicMessage } = require('./events');
const serialize = (payload) => Buffer.from(JSON.stringify(payload));
function createRoomStore(config, { randomId, now }) {
  const channels = new Map(config.channels.map((channel) => {
    const room = {
      config: channel, epoch: randomId(`room-${channel.id}`), startedAt: now(),
      messages: [], messageSequence: 0, roomBytes: 0
    };
    return [channel.id, room];
  }));
  const defaultChannel = channels.get(config.defaultChannelId);
  if (!defaultChannel?.config.enabled) throw new Error(`Default channel "${config.defaultChannelId}" is missing or disabled`);
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


  function snapshot() {
    return [...channels.values()].map((channel) => ({ id: channel.config.id, messages: channel.messages.length, roomBytes: channel.roomBytes, latestSeq: channel.messageSequence }));
  }
  function clear() {
    for (const channel of channels.values()) {
      channel.messages.length = 0;
      channel.roomBytes = 0;
      channel.messageSequence = 0;
    }
  }
  return { get: (id) => channels.get(id), epoch: defaultChannel.epoch, snapshot, evictMessages, historyChunks, legacyMessages, clear };
}
module.exports = { createRoomStore };
