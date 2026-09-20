(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloPlay = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NEXT_KEY = 'pavilo.next';

  function makeClientActionId() {
    const uuid = globalThis.crypto?.randomUUID?.();
    const value = uuid || `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96);
  }

  function playPageUrl(playId, channelId) {
    return `/plays/${playId}/?channel=${encodeURIComponent(channelId)}`;
  }

  function createPlayClient(options = {}) {
    const protocol = options.protocol || (typeof PaviloProtocol !== 'undefined' ? PaviloProtocol : null);
    const Connection = options.Connection || (typeof PaviloConnection !== 'undefined' ? PaviloConnection : null);
    const location = options.location || globalThis.location;
    const storage = options.storage === undefined ? globalThis.sessionStorage : options.storage;
    const fetchImpl = options.fetch || globalThis.fetch;
    const connection = Connection.createConnection({
      WebSocket: options.WebSocket,
      location,
      storage,
      timers: options.timers
    });
    const listeners = new Set();
    let channels = [];
    let roomInfo = null;
    let identity = null;
    let desiredChannelId = null;
    let started = false;

    function emit(event) {
      for (const listener of [...listeners]) listener(event);
      return event;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Subscriber must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function currentChannel() {
      return channels.find((channel) => channel.id === desiredChannelId) || null;
    }

    function playAction(name, payload) {
      const clientActionId = makeClientActionId();
      const sent = connection.send({
        type: 'playAction',
        clientActionId,
        name,
        payload: payload && typeof payload === 'object' ? payload : {}
      });
      return sent ? clientActionId : null;
    }

    function sendMessage(text) {
      const clientMessageId = makeClientActionId();
      return connection.send({
        type: 'message',
        clientMessageId,
        kind: 'text',
        text
      }) ? clientMessageId : null;
    }

    function leave() {
      if (connection.getSocket()?.readyState === (options.WebSocket || globalThis.WebSocket)?.OPEN) {
        connection.sendRaw({ type: 'leave' });
      }
      connection.close({ intentional: true });
      connection.clearSession();
      connection.clearChannelId();
      try { storage?.removeItem(NEXT_KEY); } catch { /* ignore */ }
    }

    function switchToChannel(channel) {
      if (!channel || !channel.enabled) return false;
      if (channel.play) {
        location.assign(playPageUrl(channel.play, channel.id));
        return true;
      }
      connection.writeChannelId(channel.id);
      const sent = connection.sendRaw({ type: 'switchChannel', channelId: channel.id });
      if (!sent) return false;
      const unsub = connection.subscribe((event) => {
        if (event.type !== 'payload') return;
        const parsed = protocol.parseServerEvent(event.payload);
        if (parsed?.type === 'stateStart' && parsed.channelId === channel.id) {
          unsub();
          location.assign('/');
        }
      });
      return true;
    }

    function handlePayload(payload) {
      const event = protocol.parseServerEvent(payload);
      if (!event) return;
      if (event.type === 'stateStart') {
        if (event.resumeToken && event.self?.username) {
          connection.setSession({ token: event.resumeToken, username: event.self.username });
          identity = { ...(identity || {}), resumeToken: event.resumeToken, username: event.self.username, channelId: event.channelId };
        }
        if (event.channelId) connection.writeChannelId(event.channelId);
        connection.markJoined(true);
        if (desiredChannelId && event.channelId !== desiredChannelId) {
          connection.sendRaw({ type: 'switchChannel', channelId: desiredChannelId });
        }
      }
      emit(event);
    }

    async function loadRoomInfo() {
      const response = await fetchImpl('/room-info', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('room info failed');
      const info = await response.json();
      roomInfo = info;
      channels = Array.isArray(info.channels) ? info.channels : [];
      return info;
    }

    async function start({ channelId } = {}) {
      if (started) return;
      started = true;
      desiredChannelId = channelId || new URLSearchParams(location.search || '').get('channel') || connection.readChannelId();
      const saved = connection.readSession();
      if (!saved) {
        try {
          storage?.setItem(NEXT_KEY, `${location.pathname}${location.search || ''}`);
        } catch { /* ignore */ }
        if (desiredChannelId) connection.writeChannelId(desiredChannelId);
        location.replace('/');
        return { redirected: true };
      }
      await loadRoomInfo();
      identity = {
        username: saved.username,
        resumeToken: saved.token,
        channelId: connection.readChannelId() || desiredChannelId || roomInfo.defaultChannelId
      };
      connection.subscribe((event) => {
        if (event.type === 'payload') handlePayload(event.payload);
        else emit(event);
      });
      connection.connect(identity);
      return { redirected: false, roomInfo, channels };
    }

    return {
      connection,
      subscribe,
      start,
      playAction,
      sendMessage,
      switchToChannel,
      leave,
      loadRoomInfo,
      playPageUrl,
      get channels() { return channels; },
      get roomInfo() { return roomInfo; },
      get identity() { return identity; },
      currentChannel
    };
  }

  return { createPlayClient, playPageUrl, NEXT_KEY };
});
