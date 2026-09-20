'use strict';

const { GATEWAY_PRESETS } = require('./presets');
const { encryptApiKey, decryptApiKey, keyHint } = require('./secret');
const { openSqliteEngine } = require('../storage/sqlite-engine');
const { applyMigrations } = require('../storage/migrations');

function gatewayError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hydrate(raw) {
  const preset = GATEWAY_PRESETS[raw.preset] || {};
  return {
    id: raw.id,
    preset: raw.preset,
    label: raw.label || preset.label || raw.id,
    baseUrl: raw.baseUrl || raw.base_url || preset.baseUrl || '',
    model: raw.model || preset.defaultModel || '',
    apiKey: raw.apiKey || '',
    enabled: raw.enabled !== false && raw.enabled !== 0
  };
}

function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function publicView(channel, token) {
  const view = {
    id: channel.id,
    preset: channel.preset,
    label: channel.label,
    baseUrl: channel.baseUrl,
    model: channel.model,
    enabled: channel.enabled,
    source: 'operator',
    keyPresent: false,
    keyHint: '',
    unwrapFailed: false
  };
  if (!channel.cipher) return view;
  try {
    const plaintext = decryptApiKey(token, channel.id, channel.cipher);
    view.keyPresent = Boolean(plaintext);
    view.keyHint = keyHint(plaintext);
  } catch {
    view.keyPresent = true;
    view.keyHint = '****';
    view.unwrapFailed = true;
  }
  return view;
}

function createMemoryGatewayStore() {
  function listResolved() {
    return [];
  }
  return {
    tracksUsage: false,
    writable: false,
    listResolved,
    listPublic(token) {
      return listResolved().map((channel) => publicView(channel, token));
    },
    resolve(id) {
      return listResolved().find((channel) => channel.id === id) || null;
    },
    unwrapKey() {
      return '';
    },
    upsertChannel() {
      throw gatewayError('OPERATOR_READONLY', '管理页编辑渠道需要 sqlite');
    },
    deleteChannel() {
      throw gatewayError('OPERATOR_READONLY', '管理页编辑渠道需要 sqlite');
    },
    recordUsage() {},
    listUsage() {
      return [];
    },
    claimedIds() {
      return new Set();
    },
    close() {}
  };
}

function rowToClaimed(row) {
  return {
    id: row.id,
    preset: row.preset,
    label: row.label,
    baseUrl: row.base_url,
    model: row.model,
    cipher: row.api_key,
    enabled: row.enabled === 1,
    source: 'operator',
    updatedAt: row.updated_at
  };
}

function createSqliteGatewayStore(config, runtime = {}) {
  const sqlite = config.storage?.sqlite;
  if (!sqlite?.path) throw new Error('sqlite gateway store requires storage.sqlite.path');
  const now = runtime.now || Date.now;
  const ownsEngine = !runtime.engine;
  const engine = runtime.engine || openSqliteEngine(sqlite);
  applyMigrations(engine);

  const selectAll = engine.prepare('SELECT id, preset, label, base_url, model, api_key, enabled, source, updated_at FROM gateway_channels');
  const selectOne = engine.prepare('SELECT id, preset, label, base_url, model, api_key, enabled, source, updated_at FROM gateway_channels WHERE id = ?');
  const upsert = engine.prepare(`INSERT INTO gateway_channels (id, preset, label, base_url, model, api_key, enabled, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'operator', ?)
    ON CONFLICT(id) DO UPDATE SET
      preset = excluded.preset,
      label = excluded.label,
      base_url = excluded.base_url,
      model = excluded.model,
      api_key = excluded.api_key,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at`);
  const remove = engine.prepare('DELETE FROM gateway_channels WHERE id = ?');
  const bumpUsage = engine.prepare(`INSERT INTO gateway_usage (channel_id, day, requests, prompt_tokens, completion_tokens, errors, last_error_at, last_error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, day) DO UPDATE SET
      requests = requests + excluded.requests,
      prompt_tokens = prompt_tokens + excluded.prompt_tokens,
      completion_tokens = completion_tokens + excluded.completion_tokens,
      errors = errors + excluded.errors,
      last_error_at = COALESCE(excluded.last_error_at, last_error_at),
      last_error_code = COALESCE(excluded.last_error_code, last_error_code)`);
  const selectUsage = engine.prepare('SELECT channel_id, day, requests, prompt_tokens, completion_tokens, errors, last_error_at, last_error_code FROM gateway_usage WHERE day >= ? ORDER BY day DESC, channel_id');

  function claimedList() {
    return selectAll.all().map(rowToClaimed);
  }

  function listResolved() {
    return claimedList();
  }

  function resolve(id) {
    return listResolved().find((channel) => channel.id === id) || null;
  }

  function unwrapKey(channel) {
    if (!channel) return '';
    return decryptApiKey(config.operator?.token || '', channel.id, channel.cipher);
  }

  return {
    tracksUsage: true,
    writable: true,
    listResolved,
    listPublic(token) {
      return listResolved().map((channel) => publicView(channel, token));
    },
    resolve,
    unwrapKey,
    upsertChannel(input) {
      const token = config.operator?.token || '';
      if (!token) throw gatewayError('OPERATOR_TOKEN_REQUIRED', '写入渠道密钥需要 operator.token');
      const current = selectOne.get(input.id);
      let cipher = current?.api_key || null;
      if (input.apiKey === null) cipher = null;
      else if (typeof input.apiKey === 'string' && input.apiKey !== '') cipher = encryptApiKey(token, input.id, input.apiKey);
      const hydrated = hydrate(input);
      upsert.run(
        hydrated.id,
        hydrated.preset,
        hydrated.label,
        hydrated.baseUrl,
        hydrated.model,
        cipher,
        hydrated.enabled ? 1 : 0,
        now()
      );
      return resolve(hydrated.id);
    },
    deleteChannel(id) {
      remove.run(id);
    },
    recordUsage({ channelId, ok, promptTokens = 0, completionTokens = 0, code, at }) {
      const day = utcDay(at || now());
      if (ok) {
        bumpUsage.run(channelId, day, 1, promptTokens, completionTokens, 0, null, null);
        return;
      }
      bumpUsage.run(channelId, day, 1, 0, 0, 1, at || now(), code || 'GATEWAY_UPSTREAM');
    },
    listUsage(days = 7) {
      const start = utcDay(now() - (Math.max(1, days) - 1) * 24 * 60 * 60 * 1000);
      return selectUsage.all(start).map((row) => ({
        channelId: row.channel_id,
        day: row.day,
        requests: row.requests,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        errors: row.errors,
        lastErrorAt: row.last_error_at,
        lastErrorCode: row.last_error_code
      }));
    },
    claimedIds() {
      return new Set(claimedList().map((channel) => channel.id));
    },
    close() {
      if (ownsEngine) engine.close();
    }
  };
}

function createGatewayStore(config, runtime = {}) {
  if (config.storage?.driver === 'sqlite' && config.storage.sqlite?.path) {
    return createSqliteGatewayStore(config, runtime);
  }
  return createMemoryGatewayStore(config);
}

module.exports = { createGatewayStore, hydrate };
