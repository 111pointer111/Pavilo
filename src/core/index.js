'use strict';

const crypto = require('node:crypto');
const { createRoomStore } = require('./room');
const { createSessionStore } = require('./session');
const { createMessageStore } = require('./messages');
const { createCommandHandler } = require('./commands');
const events = require('./events');

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
  const rooms = createRoomStore(config, { randomId, now });
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
  function broadcastAll(payload, except, minimumProtocolVersion = 1) {
    if (Buffer.byteLength(JSON.stringify(payload)) > config.maxJsonBytes) return false;
    const peerIds = [...peers.values()]
      .filter((peer) => peer !== except && peer.joined && !peer.closing && peer.protocolVersion >= minimumProtocolVersion)
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
    return broadcastAll({ type: 'channelOccupancy', occupancy: occupancySnapshot() }, except, 4);
  }
  const messageStore = createMessageStore(config, now);
  function sendJson(peer, payload) { emit(events.directed(peer.id, payload)); }
  function sendError(peer, code, message, clientMessageId) {
    const payload = { type: 'error', code, message };
    if (clientMessageId) payload.clientMessageId = clientMessageId;
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
    let payloads;
    if (peer.protocolVersion < 2) {
      payloads = [{ type: 'state', self: publicUser(session), users: sessionStore.rosterUsers(session.channelId), messages: rooms.legacyMessages(channel), roomEpoch: channel.epoch, roomStartedAt: channel.startedAt, channelId: channel.config.id }];
    } else {
      const snapshot = [...channel.messages];
      const latestSeq = channel.messageSequence;
      const capabilities = ['ack', 'historyChunks', 'roomEpoch', 'reconnect', 'reactions', 'typingLease', 'mentions'];
      if (peer.protocolVersion >= 4) capabilities.push('channelOccupancy');
      const deprecationWarning = peer.protocolVersion < 4 ? 'Protocol v1-v3 are deprecated and will be removed in v0.9.0. Please upgrade to v4.' : undefined;
      payloads = [{ type: 'stateStart', protocolVersion: events.PROTOCOL_VERSION,
        ...(deprecationWarning ? { deprecationWarning } : {}),
        capabilities,
        roomEpoch: channel.epoch, roomStartedAt: channel.startedAt, latestSeq, resumeToken: resumeToken || null,
        self: publicUser(session), users: sessionStore.rosterUsers(session.channelId), channelId: channel.config.id,
        ...(peer.protocolVersion >= 4 ? { occupancy: occupancySnapshot() } : {}) }];
      for (const chunk of rooms.historyChunks(channel, snapshot)) payloads.push({ type: 'history', roomEpoch: channel.epoch, messages: chunk });
      payloads.push({ type: 'historyEnd', roomEpoch: channel.epoch, latestSeq });
    }
    emit({ kind: 'initial', peerId: peer.id, payloads, legacy: peer.protocolVersion < 2 });
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
    { now, randomId, randomAvatarSeed, cancel });
  function connect(peerId, ip = 'unknown') {
    if (shuttingDown || peers.has(peerId)) return false;
    const peer = { id: peerId, ip, session: null, joined: false, closing: false, intentionalLeave: false,
      protocolVersion: 1, syncing: false, rates: Object.create(null), typingActive: false, typingTimer: null, joinTimer: null };
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
    rooms.clear();
    messageStore.clear();
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
  function roomInfo() { return { protocolVersion: events.PROTOCOL_VERSION, deprecatedProtocols: [1, 2, 3], roomEpoch: rooms.epoch, roomTitle: config.roomTitle, defaultChannelId: config.defaultChannelId, channels: config.channels.map(events.publicChannel), limits: events.publicLimits(config), ephemeral: true }; }
  function health() { const value = state(); return { ok: true, users: value.sessions, messages: value.messages, roomBytes: value.roomBytes, clients: value.clients, ephemeral: true }; }
  return { connect, dispatch, disconnect, connectionStatus, completeSync, markClosing, shutdown, state, health, roomInfo, roomEpoch: rooms.epoch, pruneDedupe: messageStore.pruneDedupe, drainEffects: takeEffects };
}
module.exports = { createChatCore };
