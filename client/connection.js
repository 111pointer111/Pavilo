(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloConnection = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROTOCOL_VERSION = 4;
  const RESUME_KEY = 'pavilo.resume';
  const CHANNEL_KEY = 'pavilo.channel';
  const RECONNECT_BASE = 700;
  const RECONNECT_CAP = 30_000;
  const MAX_RECONNECT_ATTEMPTS = 3;

  function defaultStorage() {
    try { return globalThis.sessionStorage; } catch { return null; }
  }

  function readSession(storage = defaultStorage()) {
    try {
      const value = JSON.parse(storage.getItem(RESUME_KEY) || 'null');
      return value && typeof value.token === 'string' && typeof value.username === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  function setSession(value, storage = defaultStorage()) {
    try {
      if (!storage) return false;
      storage.setItem(RESUME_KEY, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function clearSession(storage = defaultStorage()) {
    try {
      if (!storage) return false;
      storage.removeItem(RESUME_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function readChannelId(storage = defaultStorage()) {
    try { return storage.getItem(CHANNEL_KEY) || null; } catch { return null; }
  }

  function writeChannelId(channelId, storage = defaultStorage()) {
    try {
      if (!storage) return false;
      storage.setItem(CHANNEL_KEY, String(channelId));
      return true;
    } catch {
      return false;
    }
  }

  function clearChannelId(storage = defaultStorage()) {
    try {
      if (!storage) return false;
      storage.removeItem(CHANNEL_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function makeClientSessionId(random) {
    const uuid = globalThis.crypto?.randomUUID?.();
    const value = uuid || `cs_${Date.now().toString(36)}_${random().toString(36).slice(2)}`;
    return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96);
  }

  function createConnection(options = {}) {
    const Socket = options.WebSocket || globalThis.WebSocket;
    const location = options.location || globalThis.location;
    const storage = options.storage === undefined ? defaultStorage() : options.storage;
    const timers = options.timers || globalThis;
    const setTimer = options.setTimeout || ((callback, delay) => timers.setTimeout(callback, delay));
    const clearTimer = options.clearTimeout || ((timer) => timers.clearTimeout(timer));
    const random = options.random || Math.random;
    const onlineDependency = options.online;
    const clientSessionId = options.clientSessionId || makeClientSessionId(random);
    const listeners = new Set();

    let socket = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let joined = false;
    let intentional = false;
    let stopped = false;
    let offline = false;
    let timerGeneration = 0;
    let identity = null;

    function emit(event) {
      for (const listener of [...listeners]) listener(event);
      return event;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Subscriber must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function isOnline() {
      if (offline) return false;
      try {
        if (typeof onlineDependency === 'function') return onlineDependency() !== false;
        if (onlineDependency && typeof onlineDependency.isOnline === 'function') return onlineDependency.isOnline() !== false;
        if (onlineDependency && typeof onlineDependency.onLine === 'boolean') return onlineDependency.onLine;
        if (typeof onlineDependency === 'boolean') return onlineDependency;
        return globalThis.navigator?.onLine !== false;
      } catch {
        return true;
      }
    }

    function openState(target) {
      return Boolean(target && target.readyState === (Socket?.OPEN ?? 1));
    }

    function isReady() { return joined && openState(socket); }
    function getSocket() { return socket; }

    function sendRaw(command) {
      const target = socket;
      if (!openState(target)) return false;
      try {
        target.send(JSON.stringify(command));
        return true;
      } catch {
        return false;
      }
    }

    function send(command) {
      if (!isReady()) return false;
      return sendRaw(command);
    }

    function markJoined(value = true) {
      joined = Boolean(value);
      if (joined) {
        reconnectAttempt = 0;
        cancelReconnect();
      }
      return joined;
    }

    function currentIdentity() {
      if (typeof options.getIdentity !== 'function') return identity || {};
      const latest = options.getIdentity();
      return latest == null ? identity || {} : latest;
    }

    function websocketUrl() {
      const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${location?.host || ''}/ws`;
    }

    function cancelReconnect() {
      timerGeneration += 1;
      if (reconnectTimer != null) clearTimer(reconnectTimer);
      reconnectTimer = null;
    }

    function scheduleReconnect() {
      if (intentional || stopped || !isOnline() || reconnectTimer != null) return false;

      // 检查是否超过最大重试次数
      if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        emit({ type: 'maxRetriesReached', attempts: reconnectAttempt, max: MAX_RECONNECT_ATTEMPTS });
        return false;
      }

      const attempt = reconnectAttempt;
      const base = Math.min(RECONNECT_CAP, RECONNECT_BASE * 2 ** Math.min(reconnectAttempt++, 6));
      const delay = Math.round(base * (.75 + random() * .5));
      const generation = timerGeneration;
      reconnectTimer = setTimer(() => {
        if (generation !== timerGeneration) return;
        reconnectTimer = null;
        connect();
      }, delay);
      emit({ type: 'retryScheduled', attempt: attempt + 1, max: MAX_RECONNECT_ATTEMPTS, base, delay });
      return true;
    }

    function connect(nextIdentity) {
      if (nextIdentity !== undefined) {
        identity = nextIdentity;
        intentional = false;
        stopped = false;
      }
      if (intentional || stopped || !isOnline()) return false;
      cancelReconnect();
      joined = false;
      const previous = socket;
      socket = null;
      if (previous && previous.readyState !== (Socket?.CLOSED ?? 3)) {
        try { previous.close(); } catch { /* The replacement socket is still attempted. */ }
      }

      const url = websocketUrl();
      emit({ type: 'connecting', url, attempt: reconnectAttempt });
      let target;
      try {
        if (!Socket) throw new Error('WebSocket is unavailable');
        target = new Socket(url);
      } catch (error) {
        socket = null;
        joined = false;
        emit({ type: 'error', error });
        scheduleReconnect();
        return false;
      }
      socket = target;
      joined = false;

      target.addEventListener('open', (event) => {
        if (socket !== target || intentional || stopped) return;
        let latest;
        try { latest = currentIdentity(); } catch (error) {
          emit({ type: 'error', error });
          close({ intentional: false });
          return;
        }
        const command = {
          type: 'join',
          protocolVersion: PROTOCOL_VERSION,
          clientSessionId,
          username: latest.username,
          channelId: latest.channelId,
        };
        if (typeof latest.resumeToken === 'string' && latest.resumeToken) command.resumeToken = latest.resumeToken;
        if (latest.avatarSeed !== undefined && latest.avatarSeed !== null) command.avatarSeed = latest.avatarSeed;
        if (!sendRaw(command)) {
          emit({ type: 'error', error: new Error('Join could not be sent') });
          close({ intentional: false });
          return;
        }
        emit({ type: 'open', event });
      });

      target.addEventListener('message', (event) => {
        if (socket !== target || intentional || stopped) return;
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        emit({ type: 'payload', payload });
      });

      target.addEventListener('error', (event) => {
        if (socket !== target) return;
        emit({ type: 'error', event, error: event?.error });
      });

      target.addEventListener('close', (event) => {
        if (socket !== target) return;
        const wasJoined = joined;
        socket = null;
        joined = false;
        const serviceStopped = event.code === 1001 && event.reason === 'server stopped';
        if (serviceStopped) {
          stopped = true;
          intentional = true;
          identity = null;
          cancelReconnect();
          clearSession(storage);
          clearChannelId(storage);
        }
        emit({ type: 'close', event, code: event.code, reason: event.reason, intentional, wasJoined });
        if (serviceStopped) {
          emit({ type: 'serviceStopped', event, code: event.code, reason: event.reason });
          return;
        }
        scheduleReconnect();
      });
      return true;
    }

    function close({ intentional: isIntentional = true } = {}) {
      intentional = Boolean(isIntentional);
      if (intentional) {
        cancelReconnect();
      }
      joined = false;
      const target = socket;
      if (!target) {
        if (!intentional) scheduleReconnect();
        return false;
      }
      try {
        target.close();
        return true;
      } catch {
        if (socket === target) socket = null;
        if (!intentional) scheduleReconnect();
        return false;
      }
    }

    function retry() {
      intentional = false;
      stopped = false;
      offline = false;
      reconnectAttempt = 0; // 重置重试计数
      cancelReconnect();
      return connect();
    }

    function handleOnline() {
      offline = false;
      if (!intentional && !stopped && !isReady()) return connect();
      return false;
    }

    function handleOffline() {
      offline = true;
      cancelReconnect();
      return true;
    }

    return {
      connect,
      subscribe,
      send,
      sendRaw,
      markJoined,
      close,
      retry,
      online: handleOnline,
      offline: handleOffline,
      handleOnline,
      handleOffline,
      isReady,
      getSocket,
      setSession: (value) => setSession(value, storage),
      readSession: () => readSession(storage),
      clearSession: () => clearSession(storage),
      readChannelId: () => readChannelId(storage),
      writeChannelId: (channelId) => writeChannelId(channelId, storage),
      clearChannelId: () => clearChannelId(storage),
    };
  }

  return {
    PROTOCOL_VERSION,
    RESUME_KEY,
    CHANNEL_KEY,
    RECONNECT_BASE,
    RECONNECT_CAP,
    createConnection,
    setSession,
    readSession,
    clearSession,
    readChannelId,
    writeChannelId,
    clearChannelId,
  };
});
