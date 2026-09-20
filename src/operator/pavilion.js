'use strict';

const {
  snapshotRoomSection,
  snapshotChannelsSection,
  parseRoomOverlay,
  parseChannelsOverlay,
  applyRoomOverlay,
  validatePavilionConfig
} = require('../../config');

function createPavilionController({ config, baseline, store, core }) {
  function sourcesFrom(overlay) {
    return {
      room: overlay.room ? 'operator' : 'yaml',
      channels: overlay.channels ? 'operator' : 'yaml'
    };
  }

  function snapshot() {
    const overlay = store.load();
    return {
      sources: sourcesFrom(overlay),
      updatedAt: {
        room: overlay.meta.room?.updatedAt || null,
        channels: overlay.meta.channels?.updatedAt || null
      },
      room: snapshotRoomSection(config),
      channels: snapshotChannelsSection(config),
      plays: [...(config.plays || [])],
      occupancy: core.occupancy(),
      maxUsersCap: config.maxClients
    };
  }

  function saveRoom(input) {
    const room = parseRoomOverlay(input);
    const trial = {
      ...config,
      channels: config.channels.map((channel) => ({ ...channel })),
      operator: config.operator ? { ...config.operator } : config.operator
    };
    applyRoomOverlay(trial, room);
    validatePavilionConfig(trial);
    core.applyPavilionConfig({ room });
    store.save('room', snapshotRoomSection(config));
    if (store.load().channels) store.save('channels', snapshotChannelsSection(config));
    return snapshot();
  }

  function saveChannels(input) {
    const list = Array.isArray(input) ? input : input?.channels;
    const channels = parseChannelsOverlay(list, config.maxUsers, { plays: config.plays });
    const trial = {
      ...config,
      channels: channels.map((channel) => ({ ...channel })),
      operator: config.operator ? { ...config.operator } : config.operator
    };
    validatePavilionConfig(trial);
    core.applyPavilionConfig({ channels: trial.channels });
    store.save('channels', snapshotChannelsSection(config));
    return snapshot();
  }

  function revertRoom() {
    core.applyPavilionConfig({ room: baseline.room });
    store.remove('room');
    return snapshot();
  }

  function revertChannels() {
    const channels = parseChannelsOverlay(baseline.channels, config.maxUsers, { plays: config.plays });
    core.applyPavilionConfig({ channels });
    store.remove('channels');
    return snapshot();
  }

  return { snapshot, saveRoom, saveChannels, revertRoom, revertChannels };
}

module.exports = { createPavilionController };
