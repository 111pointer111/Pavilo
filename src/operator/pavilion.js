'use strict';

const {
  snapshotRoomSection,
  snapshotChannelsSection,
  snapshotModerationSection,
  parseRoomOverlay,
  parseChannelsOverlay,
  parseModerationOverlay,
  applyRoomOverlay,
  validatePavilionConfig
} = require('../../config');

function createPavilionController({ config, baseline, store, core }) {
  function sourcesFrom(overlay) {
    return {
      room: overlay.room ? 'operator' : 'yaml',
      channels: overlay.channels ? 'operator' : 'yaml',
      moderation: overlay.moderation ? 'operator' : 'yaml'
    };
  }

  function snapshot() {
    const overlay = store.load();
    return {
      sources: sourcesFrom(overlay),
      updatedAt: {
        room: overlay.meta.room?.updatedAt || null,
        channels: overlay.meta.channels?.updatedAt || null,
        moderation: overlay.meta.moderation?.updatedAt || null
      },
      room: snapshotRoomSection(config),
      channels: snapshotChannelsSection(config),
      moderation: snapshotModerationSection(config),
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

  function saveModeration(input) {
    const current = snapshotModerationSection(config);
    const body = input && typeof input === 'object' ? input : {};
    const moderation = parseModerationOverlay({
      ipDenyList: body.ipDenyList !== undefined ? body.ipDenyList : current.ipDenyList,
      userDenyList: body.userDenyList !== undefined ? body.userDenyList : current.userDenyList
    });
    core.applyPavilionConfig({ moderation });
    store.save('moderation', snapshotModerationSection(config));
    return snapshot();
  }

  function revertModeration() {
    core.applyPavilionConfig({ moderation: baseline.moderation || { ipDenyList: [] } });
    store.remove('moderation');
    return snapshot();
  }

  return { snapshot, saveRoom, saveChannels, revertRoom, revertChannels, saveModeration, revertModeration };
}

module.exports = { createPavilionController };
