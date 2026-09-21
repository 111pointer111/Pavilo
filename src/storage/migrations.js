'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = [
  { id: 1, file: '001-initial.sql' },
  { id: 2, file: '002-gateway.sql' },
  { id: 3, file: '003-play.sql' },
  { id: 4, file: '004-operator-config.sql' },
  { id: 5, file: '005-operator-moderation.sql' }
];

function applyMigrations(engine) {
  engine.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(engine.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
  const insert = engine.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', migration.file), 'utf8');
    engine.transaction(() => {
      engine.exec(sql);
      insert.run(migration.id, Date.now());
    });
  }
}

module.exports = { applyMigrations, MIGRATIONS };
