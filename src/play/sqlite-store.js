'use strict';

function createSqlitePlayStore(runtime = {}) {
  const engine = runtime.engine;
  if (!engine) throw new Error('sqlite play store requires a shared engine');
  const now = runtime.now || Date.now;

  const selectGame = engine.prepare('SELECT channel_id, play_id, game_id, state_json, updated_at FROM play_games WHERE channel_id = ?');
  const upsertGame = engine.prepare(`INSERT INTO play_games (channel_id, play_id, game_id, state_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET play_id = excluded.play_id, game_id = excluded.game_id,
      state_json = excluded.state_json, updated_at = excluded.updated_at`);
  const deleteGame = engine.prepare('DELETE FROM play_games WHERE channel_id = ?');
  const selectMemory = engine.prepare('SELECT seq, body, created_at FROM play_agent_memory WHERE game_id = ? AND actor_id = ? ORDER BY seq');
  const nextSeq = engine.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM play_agent_memory WHERE game_id = ? AND actor_id = ?');
  const insertMemory = engine.prepare('INSERT INTO play_agent_memory (game_id, actor_id, seq, body, created_at) VALUES (?, ?, ?, ?, ?)');
  const deleteActorMemory = engine.prepare('DELETE FROM play_agent_memory WHERE game_id = ? AND actor_id = ?');
  const deleteGameMemory = engine.prepare('DELETE FROM play_agent_memory WHERE game_id = ?');

  function parseBody(raw) {
    try { return JSON.parse(raw); } catch { return raw; }
  }

  return {
    driver: 'sqlite',
    loadGame(channelId) {
      const row = selectGame.get(channelId);
      if (!row) return null;
      let state = {};
      try { state = JSON.parse(row.state_json); } catch { state = {}; }
      return {
        playId: row.play_id,
        gameId: row.game_id,
        state,
        updatedAt: row.updated_at
      };
    },
    saveGame(channelId, record) {
      upsertGame.run(channelId, record.playId, record.gameId, JSON.stringify(record.state ?? {}), now());
    },
    clearGame(channelId) {
      const existing = selectGame.get(channelId);
      if (existing) deleteGameMemory.run(existing.game_id);
      deleteGame.run(channelId);
    },
    readMemory(gameId, actorId) {
      return selectMemory.all(gameId, actorId).map((row) => ({
        seq: row.seq,
        body: parseBody(row.body),
        createdAt: row.created_at
      }));
    },
    appendMemory(gameId, actorId, body) {
      const seq = nextSeq.get(gameId, actorId).seq;
      const createdAt = now();
      insertMemory.run(gameId, actorId, seq, JSON.stringify(body), createdAt);
      return { seq, body, createdAt };
    },
    clearMemory(gameId, actorId) {
      if (actorId) deleteActorMemory.run(gameId, actorId);
      else deleteGameMemory.run(gameId);
    },
    close() {}
  };
}

module.exports = { createSqlitePlayStore };
