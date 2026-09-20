CREATE TABLE gateway_channels (
  id TEXT PRIMARY KEY,
  preset TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('operator')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE gateway_usage (
  channel_id TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  last_error_at INTEGER,
  last_error_code TEXT,
  PRIMARY KEY (channel_id, day)
);
