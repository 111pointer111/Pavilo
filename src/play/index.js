'use strict';

const { createPlayRuntime } = require('./runtime');
const { createPlayAgent, isLegalAction } = require('./agent');
const { createMemoryPlayStore } = require('./store');
const { createSqlitePlayStore } = require('./sqlite-store');
const { loadEnabledPlays, PLAY_ID_RE, playRoot, publicPlayPath } = require('./loader');

function createPlayStore(config, runtime = {}) {
  if (runtime.engine || config.storage?.driver === 'sqlite') {
    if (!runtime.engine) return createMemoryPlayStore(runtime);
    return createSqlitePlayStore(runtime);
  }
  return createMemoryPlayStore(runtime);
}

module.exports = {
  createPlayRuntime,
  createPlayAgent,
  createPlayStore,
  createMemoryPlayStore,
  createSqlitePlayStore,
  loadEnabledPlays,
  PLAY_ID_RE,
  playRoot,
  publicPlayPath,
  isLegalAction
};
