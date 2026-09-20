CREATE TABLE operator_config (
  section TEXT PRIMARY KEY CHECK (section IN ('room', 'channels')),
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
