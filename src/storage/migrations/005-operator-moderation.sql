CREATE TABLE operator_config_new (
  section TEXT PRIMARY KEY CHECK (section IN ('room', 'channels', 'moderation')),
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO operator_config_new (section, payload, updated_at)
  SELECT section, payload, updated_at FROM operator_config;

DROP TABLE operator_config;
ALTER TABLE operator_config_new RENAME TO operator_config;
