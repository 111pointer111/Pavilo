'use strict';

const SECTIONS = new Set(['room', 'channels']);

function configStoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createMemoryOperatorConfigStore() {
  return {
    writable: false,
    load() {
      return { room: null, channels: null, meta: { room: null, channels: null } };
    },
    save() {
      throw configStoreError('OPERATOR_READONLY', '管理页编辑房间和聊天频道需要 sqlite');
    },
    remove() {
      throw configStoreError('OPERATOR_READONLY', '管理页编辑房间和聊天频道需要 sqlite');
    }
  };
}

function createSqliteOperatorConfigStore(engine, runtime = {}) {
  const now = runtime.now || Date.now;
  const selectAll = engine.prepare('SELECT section, payload, updated_at FROM operator_config');
  const upsert = engine.prepare(`INSERT INTO operator_config (section, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(section) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`);
  const removeRow = engine.prepare('DELETE FROM operator_config WHERE section = ?');

  function load() {
    const result = { room: null, channels: null, meta: { room: null, channels: null } };
    for (const row of selectAll.all()) {
      let payload;
      try { payload = JSON.parse(row.payload); }
      catch {
        throw configStoreError('OPERATOR_BAD_REQUEST', `operator_config.${row.section}: JSON 无效`);
      }
      if (row.section === 'room' || row.section === 'channels') {
        result[row.section] = payload;
        result.meta[row.section] = { updatedAt: row.updated_at };
      }
    }
    return result;
  }

  function save(section, payload) {
    if (!SECTIONS.has(section)) throw configStoreError('OPERATOR_BAD_REQUEST', '未知配置段');
    upsert.run(section, JSON.stringify(payload), now());
  }

  function remove(section) {
    if (!SECTIONS.has(section)) throw configStoreError('OPERATOR_BAD_REQUEST', '未知配置段');
    removeRow.run(section);
  }

  return { writable: true, load, save, remove };
}

function createOperatorConfigStore(engine, runtime = {}) {
  if (!engine) return createMemoryOperatorConfigStore();
  return createSqliteOperatorConfigStore(engine, runtime);
}

module.exports = { createOperatorConfigStore, createMemoryOperatorConfigStore };
