'use strict';

function createMemoryPlayStore(runtime = {}) {
  const now = runtime.now || Date.now;
  const games = new Map();
  const memories = new Map();

  function memoryKey(gameId, actorId) {
    return `${gameId}:${actorId}`;
  }

  return {
    driver: 'memory',
    loadGame(channelId) {
      return games.get(channelId) || null;
    },
    saveGame(channelId, record) {
      games.set(channelId, {
        playId: record.playId,
        gameId: record.gameId,
        state: record.state,
        updatedAt: now()
      });
    },
    clearGame(channelId) {
      const existing = games.get(channelId);
      games.delete(channelId);
      if (!existing) return;
      for (const key of [...memories.keys()]) {
        if (key.startsWith(`${existing.gameId}:`)) memories.delete(key);
      }
    },
    readMemory(gameId, actorId) {
      return [...(memories.get(memoryKey(gameId, actorId)) || [])];
    },
    appendMemory(gameId, actorId, body) {
      const key = memoryKey(gameId, actorId);
      const list = memories.get(key) || [];
      const entry = { seq: list.length + 1, body, createdAt: now() };
      list.push(entry);
      memories.set(key, list);
      return entry;
    },
    clearMemory(gameId, actorId) {
      if (actorId) memories.delete(memoryKey(gameId, actorId));
      else {
        for (const key of [...memories.keys()]) {
          if (key.startsWith(`${gameId}:`)) memories.delete(key);
        }
      }
    },
    close() {
      games.clear();
      memories.clear();
    }
  };
}

module.exports = { createMemoryPlayStore };
