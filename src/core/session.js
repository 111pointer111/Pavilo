'use strict';

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,96}$/;
function validateClientId(value) { return typeof value === 'string' && CLIENT_ID_RE.test(value); }
function cleanUsername(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
}
function createSessionStore(config, rooms, { now, randomResumeToken, schedule, cancel }, publicUser, onExpire) {
  const sessions = new Map();
  const leasedSessions = new Map();
  function activeMembers(channelId) {
    const active = new Map();
    for (const [token, session] of sessions) {
      if (!channelId || session.channelId === channelId) active.set(token, session);
    }
    const timestamp = now();
    for (const [token, lease] of leasedSessions) {
      if (lease.expiresAt > timestamp && (!channelId || lease.session.channelId === channelId)) active.set(token, lease.session);
    }
    return active;
  }

  function rosterUsers(channelId) {
    return [...activeMembers(channelId).values()].map(publicUser);
  }

  function nameIsFree(nameKey, channelId, excludedToken) {
    const timestamp = now();
    for (const session of sessions.values()) {
      if (session.token !== excludedToken && session.channelId === channelId && session.nameKey === nameKey) return false;
    }
    for (const lease of leasedSessions.values()) {
      if (lease.session.token !== excludedToken && lease.expiresAt > timestamp && lease.session.channelId === channelId && lease.session.nameKey === nameKey) return false;
    }
    return true;
  }

  function freshResumeToken() {
    let candidate = randomResumeToken();
    while (sessions.has(candidate) || leasedSessions.has(candidate)) candidate = randomResumeToken();
    return candidate;
  }

  function resolveJoin(command) {
    const channelId = typeof command.channelId === 'string' && command.channelId ? command.channelId : config.defaultChannelId;
    const channel = rooms.get(channelId);
    if (!channel || !channel.config.enabled) return { error: 'CHANNEL_UNAVAILABLE' };
    const nameKey = command.username.toLocaleLowerCase();
    const offered = typeof command.resumeToken === 'string' && CLIENT_ID_RE.test(command.resumeToken)
      ? command.resumeToken
      : command.clientSessionId;
    if (validateClientId(offered)) {
      const lease = leasedSessions.get(offered);
      if (lease && lease.expiresAt > now()) {
        if (lease.session.nameKey !== nameKey || lease.session.channelId !== channelId) return { error: 'SESSION_CONFLICT' };
        cancel(lease.timer);
        leasedSessions.delete(offered);
        return { nameKey, channelId, channel, token: offered, session: lease.session };
      }
      const session = sessions.get(offered);
      if (session) {
        if (session.kind === 'agent') return { error: 'SESSION_CONFLICT' };
        if (session.nameKey !== nameKey || session.channelId !== channelId) return { error: 'SESSION_CONFLICT' };
        return { nameKey, channelId, channel, token: offered, session };
      }
    }
    if (!nameIsFree(nameKey, channelId)) return { error: 'NAME_TAKEN' };
    if (activeMembers().size >= config.maxUsers) return { error: 'SERVER_FULL' };
    if (activeMembers(channelId).size >= channel.config.maxUsers) return { error: 'CHANNEL_FULL' };
    const token = validateClientId(offered) && !leasedSessions.has(offered) ? offered : freshResumeToken();
    return { nameKey, channelId, channel, token, session: null };
  }


  function findById(id) {
    for (const session of sessions.values()) if (session.id === id) return session;
    const timestamp = now();
    for (const lease of leasedSessions.values()) {
      if (lease.expiresAt > timestamp && lease.session.id === id) return lease.session;
    }
    return null;
  }

  function seatAgent({ channelId, username, avatarSeed, id, role }) {
    const channel = rooms.get(channelId);
    if (!channel?.config.enabled) return { error: 'CHANNEL_UNAVAILABLE' };
    const cleaned = cleanUsername(username);
    if (!cleaned) return { error: 'INVALID_NAME' };
    const nameKey = cleaned.toLocaleLowerCase();
    if (!nameIsFree(nameKey, channelId)) return { error: 'NAME_TAKEN' };
    if (activeMembers().size >= config.maxUsers) return { error: 'SERVER_FULL' };
    if (activeMembers(channelId).size >= channel.config.maxUsers) return { error: 'CHANNEL_FULL' };
    const token = freshResumeToken();
    const session = {
      id,
      username: cleaned,
      nameKey,
      channelId,
      ip: '',
      avatarSeed: Number.isFinite(avatarSeed) ? avatarSeed : 0,
      joinedAt: now(),
      token,
      kind: 'agent',
      role: typeof role === 'string' ? role : '',
      client: null,
      rates: Object.create(null)
    };
    sessions.set(token, session);
    return { session };
  }

  function unseatAgent(token) {
    const session = sessions.get(token);
    if (!session || session.kind !== 'agent') return null;
    sessions.delete(token);
    return session;
  }

  function attach(session, peer) {
    const lease = leasedSessions.get(session.token);
    if (lease) cancel(lease.timer);
    leasedSessions.delete(session.token);
    session.client = peer;
    sessions.set(session.token, session);
  }
  function detach(session, leaseAllowed) {
    sessions.delete(session.token);
    session.client = null;
    if (!leaseAllowed) return;
    const lease = { session, expiresAt: now() + config.sessionLeaseMs, timer: null };
    lease.timer = schedule(() => {
      if (leasedSessions.get(session.token) !== lease) return;
      leasedSessions.delete(session.token);
      onExpire(session);
    }, config.sessionLeaseMs);
    leasedSessions.set(session.token, lease);
  }
  function clear() {
    for (const lease of leasedSessions.values()) cancel(lease.timer);
    leasedSessions.clear();
    sessions.clear();
  }
  return { activeMembers, rosterUsers, nameIsFree, resolveJoin, attach, detach, findById, seatAgent, unseatAgent, clear, size: () => sessions.size };
}
module.exports = { createSessionStore, cleanUsername, validateClientId };
