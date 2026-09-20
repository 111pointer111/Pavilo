CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  epoch TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  latest_seq INTEGER NOT NULL
);

CREATE TABLE messages (
  channel_id TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (channel_id, id),
  UNIQUE (channel_id, seq),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

CREATE INDEX messages_channel_seq ON messages (channel_id, seq);
CREATE INDEX messages_created_at ON messages (created_at);

CREATE TABLE idempotency (
  scope TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, client_message_id)
);

CREATE INDEX idempotency_created_at ON idempotency (created_at);
