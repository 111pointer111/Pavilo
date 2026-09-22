CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reporter_user_key TEXT,
  reporter_username TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open', 'dismissed', 'removed')),
  created_at INTEGER NOT NULL
);

CREATE INDEX reports_open ON reports (status, created_at DESC);
CREATE INDEX reports_message ON reports (channel_id, message_id, status);

CREATE TABLE operator_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);

CREATE INDEX operator_actions_id ON operator_actions (id DESC);
