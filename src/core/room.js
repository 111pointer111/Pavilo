'use strict';

const { publicMessage } = require('./events');
const serialize = (payload) => Buffer.from(JSON.stringify(payload));
function createRoomStore(config, store) {
  const catalog = new Map(config.channels.map((channel) => [channel.id, channel]));
  const defaultChannel = catalog.get(config.defaultChannelId);
  if (!defaultChannel?.enabled) throw new Error(`Default channel "${config.defaultChannelId}" is missing or disabled`);
  if (!store.getChannelState(config.defaultChannelId)) {
    throw new Error(`Default channel "${config.defaultChannelId}" is missing from conversation store`);
  }

  function get(id) {
    const channelConfig = catalog.get(id);
    if (!channelConfig) return undefined;
    const state = store.getChannelState(id);
    if (!state) return undefined;
    return {
      config: channelConfig,
      epoch: state.epoch,
      startedAt: state.startedAt,
      messages: store.loadWorkingSet(id),
      messageSequence: state.latestSeq,
      roomBytes: state.roomBytes
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

  function replaceCatalog(channels) {
    catalog.clear();
    for (const channel of channels) catalog.set(channel.id, channel);
  }

  return {
    get,
    get epoch() {
      return get(config.defaultChannelId)?.epoch;
    },
    replaceCatalog,
    snapshot: () => store.stats(),
    historyChunks,
    clear: () => store.clear()
  };
}
module.exports = { createRoomStore };
