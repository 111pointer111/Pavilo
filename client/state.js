(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFERRED_EVENTS = new Set(['presence', 'message', 'reaction', 'typing', 'ack', 'error']);
  const EPOCH_ERROR = '房间已经重启，请确认后重试。';
  const TYPING_EXPIRY = 4_500;
  // Tombstones stay non-enumerable so the public sync shape remains backwards
  // compatible while the reducer retains deterministic prune information.
  function makeSync(values = {}, prunedIds = []) {
    const sync = { active: false, epoch: null, messages: [], deferred: [], latestSeq: 0, ...values };
    Object.defineProperty(sync, 'prunedIds', {
      value: [...new Set(prunedIds)], enumerable: false, configurable: true,
    });
    return sync;
  }
  function emptySync() { return makeSync(); }
  function getPrunedIds(sync) { return new Set(sync?.prunedIds || []); }
  function copySync(sync, values = {}, extraPrunedIds = []) {
    const pruned = getPrunedIds(sync);
    for (const id of extraPrunedIds) pruned.add(id);
    return makeSync({ ...sync, ...values }, pruned);
  }
  function cap(value) { return Number.isSafeInteger(value) && value > 0 ? value : 300; }
  function createInitialState(options = {}) {
    return {
      connection: { status: 'idle', joined: false, attempt: 0, intentionalLeave: false },
      room: { epoch: null, startedAt: null, latestSeq: 0, resumeToken: null },
      self: null, channelId: null, channel: { switching: false, requestedId: null }, channels: [],
      users: [], messages: [], pending: {}, sync: emptySync(), typing: {}, unread: 0,
      error: null, maxMessages: cap(options.maxMessages),
    };
  }
  function sortAndDedupeMessages(input, maxMessages = 300) {
    const seen = new Set();
    return (Array.isArray(input) ? input : []).filter((message) => {
      if (!message || typeof message.id !== 'string' || seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    }).sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0)
      || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)).slice(-cap(maxMessages));
  }
  function without(object, key) {
    if (!Object.hasOwn(object, key)) return object;
    const next = { ...object };
    delete next[key];
    return next;
  }
  function matchesEpoch(state, event) {
    return !event.roomEpoch || !state.room.epoch || event.roomEpoch === state.room.epoch;
  }
  function reconcilePending(pending, messages, epoch, selfId) {
    let next = pending;
    const canonical = new Set(messages.filter((message) => message.author?.id === selfId).map((message) => message.clientMessageId).filter(Boolean));
    for (const [id, item] of Object.entries(pending)) {
      if (canonical.has(id)) next = without(next, id);
      else if (item.epoch && epoch && item.epoch !== epoch) {
        next = { ...next, [id]: { ...item, status: 'error', error: EPOCH_ERROR } };
      }
    }
    // Retry IO/timers belong to PendingQueue, not this reducer. The snapshot's
    // room epoch and previousState let the runtime decide whether to retry once.
    return next;
  }
  function finishSnapshot(state, messages, epoch, latestSeq) {
    const nextEpoch = epoch || state.room.epoch || 'legacy';
    const authoritative = sortAndDedupeMessages(messages, Number.MAX_SAFE_INTEGER);
    const sorted = sortAndDedupeMessages(authoritative, state.maxMessages);
    return { ...state,
      room: { ...state.room, epoch: nextEpoch, latestSeq }, messages: sorted,
      pending: reconcilePending(state.pending, authoritative, nextEpoch, state.self?.id), typing: {}, sync: emptySync(),
      unread: state.room.epoch && state.room.epoch !== nextEpoch ? 0 : state.unread,
      connection: { ...state.connection, status: 'joined', joined: true, attempt: 0, intentionalLeave: false },
      channel: { switching: false, requestedId: null },
    };
  }
  function pruneAndAppend(state, removedIds, appended) {
    const removed = new Set(Array.isArray(removedIds) ? removedIds : []);
    let messages = state.messages;
    if (messages.some((message) => removed.has(message.id))) messages = messages.filter((message) => !removed.has(message.id));
    if (appended && typeof appended.id === 'string' && !messages.some((message) =>
      message.id === appended.id || appended.clientMessageId && message.clientMessageId === appended.clientMessageId
        && message.author?.id === appended.author?.id)) {
      messages = [...messages, appended];
    }
    return messages === state.messages ? messages : sortAndDedupeMessages(messages, state.maxMessages);
  }

  // Local events use slash-separated names; wire events retain their exact names.
  // Events carry `now` for deterministic typing expiry and `canMarkRead` for UI-derived unread decisions.
  function reduce(state, event) {
    state = state || createInitialState();
    if (!event || typeof event.type !== 'string') return state;
    switch (event.type) {
      case 'stateStart': {
        const channelId = event.channelId || state.channelId || event.defaultChannelId || null;
        const switched = state.channel.switching && channelId === state.channel.requestedId;
        return { ...state, self: event.self, users: event.users || [], channelId,
          messages: switched ? [] : state.messages, typing: switched ? {} : state.typing,
          unread: switched ? 0 : state.unread,
          room: { ...state.room, epoch: switched ? null : state.room.epoch,
            startedAt: event.roomStartedAt ?? state.room.startedAt, latestSeq: Number(event.latestSeq) || 0,
            resumeToken: typeof event.resumeToken === 'string' && event.resumeToken ? event.resumeToken : state.room.resumeToken },
          connection: { ...state.connection, joined: false, status: 'syncing' },
          sync: makeSync({ active: true, epoch: event.roomEpoch || (switched ? null : state.room.epoch),
            messages: [], deferred: [], latestSeq: Number(event.latestSeq) || 0 }) };
      }
      case 'history':
        if (!state.sync.active || event.roomEpoch && event.roomEpoch !== state.sync.epoch) return state;
        return { ...state, sync: copySync(state.sync, {
          messages: [...state.sync.messages, ...(event.messages || [])],
        }) };
      case 'historyEnd': {
        if (!state.sync.active || event.roomEpoch && event.roomEpoch !== state.sync.epoch) return state;
        const prunedIds = getPrunedIds(state.sync);
        const snapshot = state.sync.messages.filter((message) => !prunedIds.has(message.id));
        let next = finishSnapshot(state, snapshot, state.sync.epoch || event.roomEpoch,
          Number(event.latestSeq) || state.room.latestSeq);
        for (const deferred of state.sync.deferred) next = reduce(next, deferred);
        return next;
      }
      case 'state':
        return finishSnapshot({ ...state, self: event.self, users: event.users || [],
          channelId: event.channelId || state.channelId,
          room: { ...state.room, startedAt: event.roomStartedAt ?? state.room.startedAt } },
        event.messages || [], event.roomEpoch || 'legacy', state.room.latestSeq);
    }
    if (state.sync.active && DEFERRED_EVENTS.has(event.type)) {
      return { ...state, sync: copySync(state.sync, { deferred: [...state.sync.deferred, event] }) };
    }
    switch (event.type) {
      case 'presence':
        return { ...state, users: event.users || [],
          typing: event.action === 'leave' ? without(state.typing, event.userId) : state.typing };
      case 'message': {
        if (!matchesEpoch(state, event) || !event.message || typeof event.message.id !== 'string') return state;
        const messages = pruneAndAppend(state, event.removedIds, event.message);
        const isNew = !state.messages.some((message) => message.id === event.message.id);
        const pending = event.message.clientMessageId && event.message.author?.id === state.self?.id
          ? without(state.pending, event.message.clientMessageId) : state.pending;
        const latestSeq = Math.max(state.room.latestSeq, Number(event.message.seq) || 0);
        const unread = event.canMarkRead === true ? 0 : event.canMarkRead === false && isNew
          && event.message.author?.id !== state.self?.id ? state.unread + 1 : state.unread;
        if (messages === state.messages && pending === state.pending && latestSeq === state.room.latestSeq && unread === state.unread) return state;
        return { ...state, messages, pending, unread, room: latestSeq === state.room.latestSeq
          ? state.room : { ...state.room, latestSeq } };
      }
      case 'reaction': {
        if (!matchesEpoch(state, event)) return state;
        let messages = pruneAndAppend(state, event.removedIds);
        if (messages.some((message) => message.id === event.messageId)) messages = messages.map((message) =>
          message.id === event.messageId ? { ...message, reactions: event.reactions || {} } : message);
        return messages === state.messages ? state : { ...state, messages };
      }
      case 'prune': {
        if (!matchesEpoch(state, event)) return state;
        const messages = pruneAndAppend(state, event.removedIds);
        const removed = Array.isArray(event.removedIds) ? event.removedIds : [];
        if (state.sync.active) {
          const sync = copySync(state.sync, {}, removed);
          if (messages === state.messages && getPrunedIds(sync).size === getPrunedIds(state.sync).size) return state;
          return { ...state, messages, sync };
        }
        return messages === state.messages ? state : { ...state, messages };
      }
      case 'typing':
        if (event.userId === state.self?.id || typeof event.userId !== 'string') return state;
        if (!event.active) {
          const typing = without(state.typing, event.userId);
          return typing === state.typing ? state : { ...state, typing };
        }
        return { ...state, typing: { ...state.typing, [event.userId]: {
          username: event.username, expiresAt: (Number(event.now) || 0) + TYPING_EXPIRY } } };
      case 'typing/expire': {
        let typing = state.typing;
        for (const [id, item] of Object.entries(typing)) if (item.expiresAt <= event.now) typing = without(typing, id);
        return typing === state.typing ? state : { ...state, typing };
      }
      case 'ack': {
        if (!matchesEpoch(state, event) || !Object.hasOwn(state.pending, event.clientMessageId)) return state;
        const item = state.pending[event.clientMessageId];
        if (event.roomEpoch && item.epoch && event.roomEpoch !== item.epoch) return state;
        const pending = state.messages.some((message) => message.clientMessageId === event.clientMessageId && message.author?.id === state.self?.id)
          ? without(state.pending, event.clientMessageId)
          : { ...state.pending, [event.clientMessageId]: { ...item, status: 'accepted',
            ack: { messageId: event.messageId, seq: event.seq, createdAt: event.createdAt } } };
        return { ...state, pending };
      }
      case 'error': {
        if (event.clientMessageId) {
          const item = Object.hasOwn(state.pending, event.clientMessageId) ? state.pending[event.clientMessageId] : null;
          return { ...state, error: event, pending: item ? { ...state.pending,
            [event.clientMessageId]: { ...item, status: 'error', error: event.message, errorCode: event.code } } : state.pending };
        }
        if (state.channel.switching && ['CHANNEL_FULL', 'CHANNEL_UNAVAILABLE', 'NAME_TAKEN', 'RATE_LIMITED', 'SYNC_IN_PROGRESS'].includes(event.code)) {
          return { ...state, error: event, channel: { switching: false, requestedId: null },
            connection: { ...state.connection, status: 'joined' } };
        }
        if (!state.connection.joined && ['CHANNEL_FULL', 'CHANNEL_UNAVAILABLE', 'SERVER_FULL'].includes(event.code)) {
          return { ...state, error: event, connection: { ...state.connection, status: 'idle', joined: false },
            room: { ...state.room, resumeToken: null } };
        }
        if (['NAME_TAKEN', 'INVALID_NAME', 'SESSION_CONFLICT'].includes(event.code)) {
          const visible = Boolean(state.self) || state.connection.joined || state.connection.status === 'reconnecting';
          return { ...state, error: event, connection: { ...state.connection, status: 'idle', joined: false },
            room: { ...state.room, resumeToken: event.code === 'NAME_TAKEN' ? state.room.resumeToken : null },
            messages: visible ? [] : state.messages, users: visible ? [] : state.users,
            pending: visible ? {} : state.pending, unread: visible ? 0 : state.unread };
        }
        return { ...state, error: event };
      }
      case 'pending/add': {
        const item = event.item;
        if (!item || typeof item.id !== 'string' || Object.hasOwn(state.pending, item.id)) return state;
        return { ...state, pending: { ...state.pending, [item.id]: {
          status: 'sending', attempts: 1, epoch: state.room.epoch, ...item } } };
      }
      case 'pending/update': {
        const id = event.id || event.item?.id;
        if (!Object.hasOwn(state.pending, id)) return state;
        return { ...state, pending: { ...state.pending, [id]: { ...state.pending[id], ...(event.item || event.patch) } } };
      }
      case 'pending/remove': {
        const pending = without(state.pending, event.id);
        return pending === state.pending ? state : { ...state, pending };
      }
      case 'pending/replace': {
        const pending = {};
        for (const item of event.items || []) if (item && typeof item.id === 'string') {
          Object.defineProperty(pending, item.id, { value: { ...item }, enumerable: true, configurable: true, writable: true });
        }
        return { ...state, pending };
      }
      case 'channel/request':
        return { ...state, channel: { switching: true, requestedId: event.channelId }, error: null };
      case 'room/info':
        return { ...state, channels: event.channels || state.channels, maxMessages: cap(event.limits?.maxMessages || state.maxMessages) };
      case 'roomEpoch':
      case 'room/epoch': {
        const epoch = event.roomEpoch || event.epoch;
        if (!epoch || epoch === state.room.epoch) return state;
        return { ...state, room: { ...state.room, epoch, latestSeq: 0 }, messages: [], typing: {}, unread: 0,
          sync: emptySync(), pending: reconcilePending(state.pending, [], epoch, state.self?.id) };
      }
      case 'connection/connect':
        return { ...state, connection: { ...state.connection, status: 'connecting', joined: false, intentionalLeave: false }, error: null };
      case 'connection/open':
        return { ...state, connection: { ...state.connection, status: 'joining', joined: false } };
      case 'connection/retry':
        return { ...state, connection: { ...state.connection, status: 'reconnecting', attempt: state.connection.attempt + 1 } };
      case 'connection/error':
        return { ...state, error: event };
      case 'connection/close': {
        if (event.code === 1001 && event.reason === 'server stopped') return reduce(state, { type: 'serviceStopped' });
        const pending = {};
        for (const [id, item] of Object.entries(state.pending)) Object.defineProperty(pending, id, {
          value: item.status === 'sending' ? { ...item, status: 'unconfirmed' } : item,
          enumerable: true, configurable: true, writable: true });
        return { ...state, pending, typing: {}, sync: emptySync(),
          channel: { switching: false, requestedId: null },
          connection: { ...state.connection, status: event.intentional || state.connection.intentionalLeave ? 'idle' : 'reconnecting',
            joined: false, intentionalLeave: Boolean(event.intentional || state.connection.intentionalLeave) } };
      }
      case 'serviceStopped':
      case 'service/stopped':
        // Retain self/epoch like the original exact close-code branch; clear transient chat data.
        return { ...state, users: [], messages: [], pending: {}, typing: {}, unread: 0, sync: emptySync(),
          channelId: null, channel: { switching: false, requestedId: null },
          room: { ...state.room, resumeToken: null },
          connection: { ...state.connection, status: 'stopped', joined: false, intentionalLeave: true } };
      case 'connection/leave':
        return { ...createInitialState({ maxMessages: state.maxMessages }), channels: state.channels,
          connection: { ...createInitialState().connection, intentionalLeave: true } };
      case 'unread/clear': return state.unread ? { ...state, unread: 0 } : state;
      default: return state;
    }
  }

  function createStore(initialStateOrOptions = {}) {
    let state = initialStateOrOptions.connection && initialStateOrOptions.room
      ? initialStateOrOptions : createInitialState(initialStateOrOptions);
    const now = typeof initialStateOrOptions.now === 'function' ? initialStateOrOptions.now : Date.now;
    const listeners = new Set();
    const queue = [];
    let dispatching = false;
    return {
      getState() { return state; },
      dispatch(event) {
        queue.push(event);
        if (dispatching) return state;
        dispatching = true;
        try {
          while (queue.length) {
            let current = queue.shift();
            if (current && ['typing', 'typing/expire'].includes(current.type) && current.now === undefined) {
              current = { ...current, now: now() };
            }
            const previous = state;
            state = reduce(previous, current);
            if (state !== previous) for (const listener of [...listeners]) listener(state, current, previous);
          }
          return state;
        } finally {
          dispatching = false;
          queue.length = 0;
        }
      },
      subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Subscriber must be a function');
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }
  return { createInitialState, reduce, createStore, sortAndDedupeMessages, TYPING_EXPIRY, EPOCH_ERROR };
});
