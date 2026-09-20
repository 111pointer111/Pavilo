'use strict';

const path = require('node:path');
const { loadEnabledPlays, publicPlayPath } = require('./loader');
const { createMemoryPlayStore } = require('./store');
const { createSqlitePlayStore } = require('./sqlite-store');

const ACTION_NAME_RE = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const MAX_ACTION_PAYLOAD_BYTES = 16 * 1024;

function toActor(session) {
  if (!session) return null;
  return {
    id: session.id,
    username: session.username,
    kind: session.kind === 'agent' ? 'agent' : 'human',
    role: session.role || '',
    channelId: session.channelId
  };
}

function wrapState({ playId, channelId, gameId, seq, visibility, state, clientActionId, roomEpoch, actorId }) {
  const payload = {
    type: 'playState',
    playId,
    channelId,
    gameId,
    seq,
    visibility,
    state: state && typeof state === 'object' ? state : {}
  };
  if (clientActionId) payload.clientActionId = clientActionId;
  if (roomEpoch) payload.roomEpoch = roomEpoch;
  if (actorId) payload.actorId = actorId;
  return payload;
}

function createPlayRuntime(config, runtime = {}) {
  const root = runtime.root || path.resolve(__dirname, '../..');
  const now = runtime.now || Date.now;
  const randomId = runtime.randomId || ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`);
  const schedule = runtime.schedule || ((fn, ms) => setTimeout(fn, ms));
  const complete = runtime.complete || (async () => ({ ok: false, code: 'GATEWAY_DISABLED', message: 'Gateway is not configured' }));
  const onEffects = runtime.onEffects || (() => {});
  const store = runtime.store || (runtime.engine
    ? createSqlitePlayStore({ engine: runtime.engine, now })
    : createMemoryPlayStore({ now }));

  const modules = loadEnabledPlays(root, config.plays || []);
  const tables = new Map();
  const idempotency = new Map();
  const agentSpecs = new Map();

  function playIdFor(channelId) {
    return config.channels.find((channel) => channel.id === channelId)?.play || '';
  }

  function snapshotsFrom(table, result, actor, clientActionId, roomEpoch) {
    const list = [];
    if (!result?.snapshots) return list;
    for (const snap of result.snapshots) {
      if (!snap) continue;
      const visibility = snap.visibility === 'channel' ? 'channel' : 'private';
      list.push(wrapState({
        playId: table.playId,
        channelId: table.channelId,
        gameId: table.gameId,
        seq: table.nextSeq(),
        visibility,
        state: snap.state,
        clientActionId: visibility === 'private' ? clientActionId : undefined,
        roomEpoch,
        actorId: snap.actorId || actor?.id
      }));
    }
    return list;
  }

  function callHost(table, method, ...args) {
    if (table.faulted) return { ok: false, code: 'PLAY_HOST_FAILED', message: '这个玩法暂时不可用。' };
    try {
      const result = table.host[method]?.(...args);
      return result === undefined ? { ok: true } : result;
    } catch {
      table.fault();
      return { ok: false, code: 'PLAY_HOST_FAILED', message: '这个玩法暂时不可用。' };
    }
  }

  function tableFor(channelId) {
    const playId = playIdFor(channelId);
    if (!playId || !modules.has(playId)) return null;
    const existing = tables.get(channelId);
    if (existing) return existing;
    const mod = modules.get(playId);
    const saved = store.loadGame(channelId);
    const gameId = saved?.gameId || randomId('g');
    let seq = 0;
    let faulted = false;
    const hostRuntime = {
      now,
      randomId,
      schedule,
      complete,
      channel: { id: channelId, playId },
      get gameId() { return gameId; },
      actors() {
        return (runtime.roster?.(channelId) || []).map(toActor).filter(Boolean);
      },
      seatAgent(input = {}) {
        const result = runtime.seatAgent?.({
          channelId,
          username: input.username,
          role: input.role || input.spec?.role || '',
          spec: input.spec
        });
        if (result?.session) {
          if (input.spec) agentSpecs.set(result.session.id, input.spec);
          return { actor: toActor(result.session), session: result.session };
        }
        return { error: result?.error || 'CHANNEL_FULL' };
      },
      requestTurn(actor, turn) {
        return requestTurn(channelId, actor, turn);
      },
      memory: {
        read(actorId) { return store.readMemory(gameId, actorId); },
        append(actorId, body) { return store.appendMemory(gameId, actorId, body); },
        clear(actorId) { store.clearMemory(gameId, actorId); }
      },
      load() { return store.loadGame(channelId); },
      save(state) { store.saveGame(channelId, { playId, gameId, state }); }
    };
    let host;
    try {
      host = mod.create(hostRuntime);
    } catch {
      faulted = true;
      host = {
        onJoin() {},
        onLeave() {},
        onAction() { return { ok: false, code: 'PLAY_HOST_FAILED' }; },
        snapshot() { return {}; }
      };
    }
    const table = {
      playId,
      channelId,
      gameId,
      get seq() { return seq; },
      nextSeq() { seq += 1; return seq; },
      get faulted() { return faulted; },
      fault() { faulted = true; },
      host,
      hostRuntime
    };
    if (saved?.state && typeof host.hydrate === 'function') {
      try { host.hydrate(saved.state); } catch { table.fault(); }
    }
    tables.set(channelId, table);
    return table;
  }

  function requestTurn(channelId, actor, turn = {}) {
    const table = tableFor(channelId);
    if (!table || !actor) return;
    const spec = agentSpecs.get(actor.id) || turn.spec;
    if (!spec || typeof spec.runTurn !== 'function') return;
    const legalActions = turn.legalActions || [];
    schedule(() => {
      let view = {};
      try { view = table.host.snapshot?.(actor) || {}; } catch { table.fault(); return; }
      Promise.resolve(spec.runTurn({
        actor,
        legalActions,
        privateView: view,
        turn: table.seq,
        complete,
        memory: {
          read: () => table.hostRuntime.memory.read(actor.id),
          append: (body) => table.hostRuntime.memory.append(actor.id, body)
        }
      })).then((action) => {
        if (!action || action.name === 'skip') return;
        const result = callHost(table, 'onAction', actor, {
          name: action.name,
          payload: action.payload || {},
          clientActionId: randomId('ca')
        });
        const snapshots = snapshotsFrom(table, result, actor);
        const effects = snapshots.map((payload) => ({
          kind: payload.visibility === 'channel' ? 'broadcast' : 'send',
          channelId,
          actorId: payload.actorId,
          payload
        }));
        if (effects.length) onEffects(effects);
      }).catch(() => {});
    }, 0);
  }

  function handleAction({ session, name, payload, clientActionId, roomEpoch }) {
    const playId = playIdFor(session.channelId);
    if (!playId) return { ok: false, code: 'PLAY_NOT_BOUND', message: '这个频道没有绑定玩法。' };
    if (!ACTION_NAME_RE.test(name || '')) {
      return { ok: false, code: 'PLAY_ACTION_REJECTED', message: '无法识别这个动作。' };
    }
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_ACTION_PAYLOAD_BYTES) {
      return { ok: false, code: 'PLAY_ACTION_REJECTED', message: '动作内容太大。' };
    }
    const scope = `${session.channelId}:${session.token}:${clientActionId}`;
    if (idempotency.has(scope)) return idempotency.get(scope);
    const table = tableFor(session.channelId);
    if (!table) return { ok: false, code: 'PLAY_NOT_BOUND', message: '这个频道没有绑定玩法。' };
    const actor = toActor(session);
    const result = callHost(table, 'onAction', actor, { name, payload: body, clientActionId });
    if (!result || result.ok === false) {
      const error = {
        ok: false,
        code: result?.code || 'PLAY_ACTION_REJECTED',
        message: result?.message || '这个动作不被允许。'
      };
      idempotency.set(scope, error);
      return error;
    }
    const accepted = {
      ok: true,
      snapshots: snapshotsFrom(table, result, actor, clientActionId, roomEpoch),
      post: result.post
    };
    idempotency.set(scope, accepted);
    return accepted;
  }

  function snapshotFor(session, roomEpoch) {
    const table = tableFor(session.channelId);
    if (!table) return null;
    const actor = toActor(session);
    let state = {};
    try { state = table.host.snapshot?.(actor) || {}; } catch { table.fault(); return null; }
    return wrapState({
      playId: table.playId,
      channelId: table.channelId,
      gameId: table.gameId,
      seq: table.nextSeq(),
      visibility: 'private',
      state,
      roomEpoch,
      actorId: actor.id
    });
  }

  function onJoin(session, roomEpoch) {
    const table = tableFor(session.channelId);
    if (!table) return { snapshots: [] };
    const actor = toActor(session);
    const result = callHost(table, 'onJoin', actor);
    const snapshots = snapshotsFrom(table, result, actor, undefined, roomEpoch);
    if (!snapshots.length) {
      const snap = snapshotFor(session, roomEpoch);
      if (snap) snapshots.push(snap);
    }
    return { ok: result?.ok !== false, snapshots, post: result?.post };
  }

  function onLeave(session) {
    const table = tables.get(session.channelId);
    if (!table) return;
    callHost(table, 'onLeave', toActor(session));
  }

  return {
    modules,
    store,
    handleAction,
    snapshotFor,
    onJoin,
    onLeave,
    requestTurn,
    pageFor(playId) { return modules.has(playId) ? publicPlayPath(playId) : ''; },
    enabled(playId) { return modules.has(playId); },
    playIdFor,
    tableFor,
    close() { store.close(); }
  };
}

module.exports = { createPlayRuntime, ACTION_NAME_RE, toActor };
