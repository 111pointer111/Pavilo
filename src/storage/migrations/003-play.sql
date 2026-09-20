CREATE TABLE play_games (
  channel_id TEXT PRIMARY KEY,
  play_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE play_agent_memory (
  game_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, actor_id, seq)
);

CREATE INDEX play_agent_memory_game ON play_agent_memory (game_id);
