'use strict';

const { createMemoryStore } = require('./memory-store');

function createConversationStore(config, runtime = {}) {
  const driver = config.storage?.driver || 'memory';
  if (driver === 'memory') return createMemoryStore(config, runtime);
  throw new Error(`Unsupported storage driver "${driver}"`);
}

module.exports = { createConversationStore };
