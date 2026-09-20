'use strict';

const fs = require('node:fs');
const path = require('node:path');

function nodeMajorMinor() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return { major, minor };
}

function isNodeSqliteAvailable() {
  const { major, minor } = nodeMajorMinor();
  if (!(major > 22 || (major === 22 && minor >= 5))) return false;
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

function applyPragmas(db) {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
}

function wrapDatabase(db, name) {
  applyPragmas(db);
  return {
    name,
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    transaction(fn) {
      if (typeof db.transaction === 'function') return db.transaction(fn)();
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back or never began */ }
        throw error;
      }
    },
    close() { db.close(); }
  };
}

function openNodeSqlite(filePath) {
  const { DatabaseSync } = require('node:sqlite');
  return wrapDatabase(new DatabaseSync(filePath), 'node');
}

function openBetterSqlite(filePath, required) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    if (required) throw new Error('better-sqlite3 is not installed. Run: npm install better-sqlite3');
    throw new Error('SQLite requires Node 22.5+ or better-sqlite3. Run: npm install better-sqlite3');
  }
  return wrapDatabase(new Database(filePath), 'better-sqlite3');
}

function openSqliteEngine(sqliteConfig) {
  const filePath = sqliteConfig.path;
  const engine = sqliteConfig.engine || 'auto';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (engine === 'node') {
    if (!isNodeSqliteAvailable()) {
      throw new Error('SQLite engine "node" requires Node 22.5+. Upgrade Node or set storage.sqlite.engine: better-sqlite3');
    }
    return openNodeSqlite(filePath);
  }
  if (engine === 'better-sqlite3') return openBetterSqlite(filePath, true);
  if (engine === 'auto') {
    if (isNodeSqliteAvailable()) return openNodeSqlite(filePath);
    return openBetterSqlite(filePath, false);
  }
  throw new Error(`Unknown sqlite engine "${engine}"`);
}

module.exports = { openSqliteEngine, isNodeSqliteAvailable };
