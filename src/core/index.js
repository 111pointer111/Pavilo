'use strict';

const crypto = require('node:crypto');
const { createConversationStore } = require('../storage');
const { createRoomStore } = require('./room');
const { createSessionStore } = require('./session');
const { createMessageStore } = require('./messages');
const { createCommandHandler } = require('./commands');
const events = require('./events');
const { applyRoomOverlay, applyChannelsOverlay, validatePavilionConfig } = require('../../config');

function pavilionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertCatalogTransition(previous, next, { occupancy, playGame }) {
  const nextById = new Map(next.map((channel) => [channel.id, channel]));
  for (const prev of previous) {
    const upcoming = nextById.get(prev.id);
    const members = occupancy[prev.id] || 0;
    if (members > 0 && !upcoming) throw pavilionError('CHANNEL_BUSY', `频道 ${prev.id} 仍有成员，不能删除。`);
    if (members > 0 && prev.enabled && upcoming && !upcoming.enabled) {
      throw pavilionError('CHANNEL_BUSY', `频道 ${prev.id} 仍有成员，不能停用。`);
    }
    const prevPlay = prev.play || '';
    const nextPlay = upcoming?.play || '';
    if (prevPlay !== nextPlay && typeof playGame === 'function' && playGame(prev.id)) {
      throw pavilionError('PLAY_BOUND', `频道 ${prev.id} 有进行中的玩法，不能改绑定。`);
    }
  }
}

// Peers are domain identities, never sockets. The adapter consumes routed effects
// and reports delivery completion/disconnection back through this interface.
function createChatCore(config, runtime = {}) {
  const now = runtime.now || Date.now;
  const cancel = runtime.cancel || clearTimeout;
  const schedule = runtime.schedule || ((fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; });
  const randomId = runtime.randomId || ((prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`);
  const randomResumeToken = runtime.randomResumeToken || (() => crypto.randomBytes(9).toString('base64url'));
  const randomAvatarSeed = runtime.randomAvatarSeed || (() => crypto.randomInt(0, 0x7fffffff));
  const peers = new Map();
  const store = runtime.store || createConversationStore(config, { randomId, now, engine: runtime.engine });
  const rooms = createRoomStore(config, store);
  const publicUser = (session) => events.publicUser(session, config.exposeMemberIps);
  let effects = [];
  let shuttingDown = false;
  function emit(effect) { effects.push(effect); }
  function takeEffects() { const result = effects; effects = []; return result; }
  function timerTask(fn) {
    fn();
    if (runtime.onEffects) runtime.onEffects(takeEffects());
  }
  function broadcast(channelId, payload, except) {
    if (Buffer.byteLength(JSON.stringify(payload)) > config.maxJsonBytes) return false;
    const peerIds = [...peers.values()]
      .filter((peer) => peer !== except && peer.joined && peer.session?.channelId === channelId && !peer.closing)
      .map((peer) => peer.id);
    emit(events.channelEvent(channelId, payload, peerIds));
    return true;
  }
  function broadcastAll(payload, except) {
    if (Buffer.byteLength(JSON.stringify(payload)) > config.maxJsonBytes) return false;
    const peerIds = [...peers.values()]
      .filter((peer) => peer !== except && peer.joined && !peer.closing)
      .map((peer) => peer.id);
    emit({ kind: 'broadcast', payload, peerIds });
    return true;
  }
  const sessionStore = createSessionStore(config, rooms, { now, randomResumeToken, cancel, schedule: (fn, ms) => schedule(() => timerTask(fn), ms) }, publicUser,
    (session) => {
      broadcast(session.channelId, { type: 'presence', action: 'leave', userId: session.id, username: session.username, users: sessionStore.rosterUsers(session.channelId) });
      broadcastOccupancy();
    });
  function occupancySnapshot() {
    return Object.fromEntries(config.channels.map((channel) => [channel.id, sessionStore.activeMembers(channel.id).size]));
  }
  function broadcastOccupancy(except) {
    return broadcastAll({ type: 'channelOccupancy', occupancy: occupancySnapshot() }, except);
  }
  const messageStore = createMessageStore(config);
  const playSlot = { runtime: null };
  function sendJson(peer, payload) { emit(events.directed(peer.id, payload)); }
  function sendError(peer, code, message, clientMessageId, extra = {}) {
    const payload = { type: 'error', code, message };
    if (clientMessageId) payload.clientMessageId = clientMessageId;
    if (extra.clientActionId) payload.clientActionId = extra.clientActionId;
    sendJson(peer, payload);
  }
  function closeClient(peer, code = 1000, reason = '') {
    if (!peer || peer.closing) return;
    peer.closing = true;
    emit({ kind: 'close', peerId: peer.id, code, reason });
  }
  function sendInitialState(peer, session, resumeToken) {
    const channel = rooms.get(session.channelId);
    peer.syncing = true;
    const snapshot = [...channel.messages];
    const latestSeq = channel.messageSequence;
    const playId = channel.config.play;
    const capabilities = ['ack', 'historyChunks', 'roomEpoch', 'reconnect', 'reactions', 'typingLease', 'mentions', 'channelOccupancy', 'historyPage'];
    if (playId) capabilities.push('play');
    const start = {
      type: 'stateStart',
      protocolVersion: events.PROTOCOL_VERSION,
      capabilities,
      roomEpoch: channel.epoch, roomStartedAt: channel.startedAt, latestSeq, resumeToken: resumeToken || null,
      self: publicUser(session), users: sessionStore.rosterUsers(session.channelId), channelId: channel.config.id,
      occupancy: occupancySnapshot()
    };
    if (playId) start.play = { id: playId, page: `/plays/${playId}/` };
    const payloads = [start];
    for (const chunk of rooms.historyChunks(channel, snapshot)) payloads.push({ type: 'history', roomEpoch: channel.epoch, messages: chunk });
    payloads.push({ type: 'historyEnd', roomEpoch: channel.epoch, latestSeq });
    if (playId && playSlot.runtime) {
      const joined = playSlot.runtime.onJoin(session, channel.epoch);
      for (const snap of joined.snapshots || []) {
        if (snap.visibility === 'private' && snap.actorId && snap.actorId !== session.id) continue;
        const payload = { ...snap };
        delete payload.actorId;
        payloads.push(payload);
      }
    }
    emit({ kind: 'initial', peerId: peer.id, payloads });
  }
  function deactivateTyping(peer) {
    if (peer.typingTimer) cancel(peer.typingTimer);
    peer.typingTimer = null;
    if (!peer.typingActive || !peer.session) return;
    peer.typingActive = false;
    broadcast(peer.session.channelId, { type: 'typing', userId: peer.session.id, username: peer.session.username, active: false }, peer);
  }
  function activateTyping(peer) {
    if (peer.typingTimer) cancel(peer.typingTimer);
    if (!peer.typingActive) {
      peer.typingActive = true;
      broadcast(peer.session.channelId, { type: 'typing', userId: peer.session.id, username: peer.session.username, active: true }, peer);
    }
    peer.typingTimer = schedule(() => timerTask(() => deactivateTyping(peer)), config.typingTtlMs);
  }
  function handOffSession(session) {
    const oldPeer = session.client;
    if (!oldPeer) return;
    deactivateTyping(oldPeer);
    closeClient(oldPeer, 1000, 'reconnected');
    oldPeer.session = null;
    oldPeer.joined = false;
    session.client = null;
  }
  const handleCommand = createCommandHandler(config, rooms, sessionStore, messageStore,
    { publicUser, sendError, sendJson, broadcast, broadcastOccupancy, sendInitialState, activateTyping, deactivateTyping, closeClient, handOffSession },
    { now, randomId, randomAvatarSeed, cancel, store, playSlot });
  const log = runtime.log || ((line) => { process.stdout.write(`${line}\n`); });
  const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
  function runPrune() {
    const { deleted } = store.pruneExpired(now(), { limit: 500 });
    if (deleted) log(`Storage prune: deleted ${deleted} expired messages`);
    if (deleted === 500) schedule(() => timerTask(runPrune), 0);
  }
  runPrune();
  const pruneTimer = schedule(() => timerTask(runPrune), PRUNE_INTERVAL_MS);
  function connect(peerId, ip = 'unknown') {
    if (shuttingDown || peers.has(peerId)) return false;
    const peer = { id: peerId, ip, session: null, joined: false, closing: false, intentionalLeave: false,
      protocolVersion: null, syncing: false, rates: Object.create(null), typingActive: false, typingTimer: null, joinTimer: null };
    peers.set(peerId, peer);
    peer.joinTimer = schedule(() => timerTask(() => closeClient(peer, 1008, 'join timeout')), config.joinTimeoutMs);
    return true;
  }
  function dispatch(peerId, command) {
    const peer = peers.get(peerId);
    const available = Boolean(peer && !peer.closing);
    if (available) handleCommand(peer, command);
    const result = takeEffects();
    const error = result.find((effect) => effect.kind === 'send' && effect.payload.type === 'error')?.payload;
    return { accepted: available && !error, effects: result, ...(error ? { error } : {}) };
  }
  function disconnect(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return [];
    peers.delete(peerId);
    if (peer.joinTimer) cancel(peer.joinTimer);
    deactivateTyping(peer);
    const session = peer.session;
    if (session && session.client === peer) {
      if (peer.intentionalLeave) playSlot.runtime?.onLeave(session);
      peer.session = null;
      peer.joined = false;
      sessionStore.detach(session, !shuttingDown && !peer.intentionalLeave);
      if (!shuttingDown && peer.intentionalLeave) {
        broadcast(session.channelId, { type: 'presence', action: 'leave', userId: session.id, username: session.username, users: sessionStore.rosterUsers(session.channelId) });
        broadcastOccupancy();
      }
    }
    return takeEffects();
  }
  function connectionStatus(peerId) {
    const peer = peers.get(peerId);
    return peer ? { joined: peer.joined, closing: peer.closing, syncing: peer.syncing, channelId: peer.session?.channelId } : null;
  }
  function completeSync(peerId) { const peer = peers.get(peerId); if (peer) peer.syncing = false; }
  function markClosing(peerId) { const peer = peers.get(peerId); if (peer) peer.closing = true; }
  function shutdown() {
    shuttingDown = true;
    sessionStore.clear();
    if (store.ephemeral) rooms.clear();
    if (pruneTimer) cancel(pruneTimer);
    store.close();
    for (const peer of peers.values()) {
      if (peer.joinTimer) cancel(peer.joinTimer);
      if (peer.typingTimer) cancel(peer.typingTimer);
      peer.intentionalLeave = true;
      closeClient(peer, 1001, 'server stopped');
    }
    return takeEffects();
  }
  function state() {
    const channels = rooms.snapshot();
    return { clients: peers.size, sessions: sessionStore.size(), messages: channels.reduce((n, c) => n + c.messages, 0), roomBytes: channels.reduce((n, c) => n + c.roomBytes, 0), latestSeq: rooms.get(config.defaultChannelId).messageSequence };
  }
  function storageInfo() {
    const sqlite = config.storage?.sqlite;
    return {
      driver: store.driver,
      ephemeral: store.ephemeral,
      ...(store.engine ? { engine: store.engine } : {}),
      ...(sqlite?.path ? { path: sqlite.path } : {}),
      ...(store.driver === 'sqlite' ? { retentionDays: sqlite.retentionDays } : {})
    };
  }
  function roomInfo() {
    const info = { protocolVersion: events.PROTOCOL_VERSION, deprecatedProtocols: [], roomEpoch: rooms.epoch, roomTitle: config.roomTitle, defaultChannelId: config.defaultChannelId, defaultLanguage: config.defaultLanguage || 'zh-CN', supportedLanguages: ['zh-CN', 'en'], channels: config.channels.map(events.publicChannel), limits: events.publicLimits(config), ephemeral: store.ephemeral };
    if (store.driver === 'sqlite') info.retentionDays = config.storage.sqlite.retentionDays;
    return info;
  }
  function health() {
    const value = state();
    const result = { ok: true, users: value.sessions, messages: value.messages, roomBytes: value.roomBytes, clients: value.clients, ephemeral: store.ephemeral };
    if (typeof store.inventory === 'function') {
      const inventory = store.inventory();
      result.messages = inventory.messages;
      result.storage = {
        driver: store.driver,
        path: config.storage.sqlite.path,
        bytes: inventory.bytes,
        messages: inventory.messages
      };
    }
    return result;
  }
  function occupancy() {
    return occupancySnapshot();
  }

  function applyPavilionConfig({ room, channels } = {}) {
    const trial = {
      ...config,
      channels: config.channels.map((channel) => ({ ...channel })),
      plays: [...(config.plays || [])],
      operator: config.operator ? { ...config.operator } : config.operator
    };
    if (room) applyRoomOverlay(trial, room);
    if (channels) applyChannelsOverlay(trial, channels);
    validatePavilionConfig(trial);
    assertCatalogTransition(config.channels, trial.channels, {
      occupancy: occupancySnapshot(),
      playGame: (channelId) => playSlot.runtime?.store?.loadGame?.(channelId) || null
    });
    for (const channel of trial.channels) store.ensureChannel(channel.id);
    config.roomTitle = trial.roomTitle;
    config.defaultChannelId = trial.defaultChannelId;
    config.defaultLanguage = trial.defaultLanguage;
    config.exposeMemberIps = trial.exposeMemberIps;
    config.exposeLanUrls = trial.exposeLanUrls;
    config.maxUsers = trial.maxUsers;
    config.channels = trial.channels;
    rooms.replaceCatalog(trial.channels);
  }

  function attachPlayRuntime(playRuntime) {
    playSlot.runtime = playRuntime || null;
  }
  function roster(channelId) {
    return [...sessionStore.activeMembers(channelId).values()];
  }
  function seatAgent(input) {
    const result = sessionStore.seatAgent({
      ...input,
      id: input.id || randomId('u'),
      avatarSeed: input.avatarSeed ?? randomAvatarSeed()
    });
    if (result.session) {
      broadcast(result.session.channelId, {
        type: 'presence',
        action: 'join',
        user: publicUser(result.session),
        users: sessionStore.rosterUsers(result.session.channelId)
      });
      broadcastOccupancy();
    }
    return result;
  }
  function unseatAgent(token) {
    const session = sessionStore.unseatAgent(token);
    if (session) {
      playSlot.runtime?.onLeave(session);
      broadcast(session.channelId, {
        type: 'presence',
        action: 'leave',
        userId: session.id,
        username: session.username,
        users: sessionStore.rosterUsers(session.channelId)
      });
      broadcastOccupancy();
    }
    return session;
  }
  function deliverPlayEffects(playEffects) {
    for (const effect of playEffects || []) {
      const payload = { ...effect.payload };
      const actorId = payload.actorId;
      delete payload.actorId;
      if (Buffer.byteLength(JSON.stringify(payload)) > config.maxJsonBytes) continue;
      if (effect.kind === 'broadcast') broadcast(effect.channelId || payload.channelId, payload);
      else {
        const session = sessionStore.findById(actorId || effect.actorId);
        if (session?.client) sendJson(session.client, payload);
      }
    }
    if (runtime.onEffects) runtime.onEffects(takeEffects());
  }
  const api = {
    connect, dispatch, disconnect, connectionStatus, completeSync, markClosing, shutdown,
    state, health, roomInfo, storageInfo, pruneDedupe: store.pruneDedupe,
    drainEffects: takeEffects, attachPlayRuntime, roster, seatAgent, unseatAgent, deliverPlayEffects,
    occupancy, applyPavilionConfig
  };
  Object.defineProperty(api, 'roomEpoch', { enumerable: true, get: () => rooms.epoch });
  return api;
}
module.exports = { createChatCore };
