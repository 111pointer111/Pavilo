'use strict';

const { createMemoryStore } = require('./memory-store');

function createConversationStore(config, runtime = {}) {
  const driver = config.storage?.driver || 'memory';
  if (driver === 'memory') return createMemoryStore(config, runtime);
  if (driver === 'sqlite') {
    const { createSqliteStore } = require('./sqlite-store');
    return createSqliteStore(config, runtime);
  }
  throw new Error(`Unsupported storage driver "${driver}"`);
}

module.exports = { createConversationStore };
