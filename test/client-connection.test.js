'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const connectionModule = require('../client/connection');
const {
  PROTOCOL_VERSION, createConnection, setSession, readSession, clearSession,
  readChannelId, writeChannelId, clearChannelId,
} = connectionModule;

function harness(options = {}) {
  const sockets = [];
  const timers = new Map();
  const events = [];
  const storageData = new Map();
  let nextTimer = 1;
  let online = options.online ?? true;

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      if (options.constructError) throw options.constructError;
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.listeners = new Map();
      this.sent = [];
      this.closeCalls = 0;
      sockets.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatch('open');
    }

    message(payload) {
      this.dispatch('message', { data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
    }

    serverClose(code = 1006, reason = '') {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatch('close', { code, reason });
    }

    send(value) {
      if (this.readyState !== FakeWebSocket.OPEN) throw new Error('not open');
      this.sent.push(value);
    }

    close() {
      this.closeCalls += 1;
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatch('close', { code: 1000, reason: '' });
    }
  }

  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
    removeItem(key) { storageData.delete(key); },
  };
  let identity = options.identity || { username: '北岸', avatarSeed: 17, resumeToken: 'resume-1', channelId: 'general' };
  const connection = createConnection({
    WebSocket: FakeWebSocket,
    location: options.location || { protocol: 'http:', host: 'chat.local:4173' },
    storage,
    getIdentity: () => identity,
    clientSessionId: 'client-session-1',
    random: options.random || (() => .5),
    online: () => online,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  connection.subscribe((event) => events.push(event));

  return {
    connection, events, sockets, timers, storage, storageData,
    setIdentity(value) { identity = value; },
    setOnline(value) { online = value; },
    fireTimer(id = timers.keys().next().value) {
      const timer = timers.get(id);
      timers.delete(id);
      timer.callback();
    },
  };
}

function sent(socket, index = 0) { return JSON.parse(socket.sent[index]); }

test('UMD loads without DOM access and exposes identical browser and Node APIs', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/connection'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.PaviloConnection).sort(), Object.keys(connectionModule).sort());
  assert.equal(typeof browser.PaviloConnection.createConnection, 'function');
  assert.equal(browser.document, undefined);
});

test('connect emits lifecycle and sends the current protocol join with identity', () => {
  const { connection, sockets, events } = harness();
  assert.equal(connection.connect(), true);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://chat.local:4173/ws');
  assert.equal(events[0].type, 'connecting');
  sockets[0].open();
  assert.deepEqual(sent(sockets[0]), {
    type: 'join', protocolVersion: PROTOCOL_VERSION, clientSessionId: 'client-session-1',
    username: '北岸', channelId: 'general', resumeToken: 'resume-1', avatarSeed: 17,
  });
  assert.equal(events[1].type, 'open');
  assert.equal(connection.getSocket(), sockets[0]);
});

test('join omits unknown optional identity fields and HTTPS selects wss', () => {
  const { connection, sockets } = harness({
    identity: { username: 'guest', channelId: 'random', avatarSeed: null, resumeToken: '' },
    location: { protocol: 'https:', host: 'secure.local' },
  });
  connection.connect();
  sockets[0].open();
  assert.deepEqual(sent(sockets[0]), {
    type: 'join', protocolVersion: 4, clientSessionId: 'client-session-1', username: 'guest', channelId: 'random',
  });
  assert.equal(sockets[0].url, 'wss://secure.local/ws');
});

test('identity getter is evaluated at each open, including changes during a connection attempt', () => {
  const { connection, sockets, setIdentity, fireTimer } = harness();
  connection.connect();
  setIdentity({ username: 'first', avatarSeed: 0, channelId: 'general' });
  sockets[0].open();
  assert.equal(sent(sockets[0]).username, 'first');
  assert.equal(sent(sockets[0]).avatarSeed, 0);
  connection.markJoined();
  sockets[0].serverClose();
  fireTimer();
  setIdentity({ username: 'second', channelId: 'random', resumeToken: 'token-new' });
  sockets[1].open();
  assert.equal(sent(sockets[1]).username, 'second');
  assert.equal(sent(sockets[1]).resumeToken, 'token-new');
  assert.equal(sent(sockets[1]).channelId, 'random');
  assert.equal(sent(sockets[1]).clientSessionId, sent(sockets[0]).clientSessionId);
});

test('connect(identity) works without getIdentity and keeps identity for reconnect', () => {
  const sockets = [];
  class WebSocket {
    static OPEN = 1; static CLOSED = 3;
    constructor() { this.readyState = 0; this.listeners = {}; this.sent = []; sockets.push(this); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    open() { this.readyState = 1; this.listeners.open({}); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; this.listeners.close({ code: 1000, reason: '' }); }
  }
  const connection = createConnection({ WebSocket, location: { protocol: 'http:', host: 'x' },
    clientSessionId: 'client-session-1', online: true });
  connection.connect({ username: 'inline', avatarSeed: 4, channelId: 'general' });
  sockets[0].open();
  assert.equal(sent(sockets[0]).username, 'inline');
});

test('payload events parse JSON and ignore malformed frames', () => {
  const { connection, sockets, events } = harness();
  connection.connect();
  sockets[0].open();
  sockets[0].message({ type: 'state', users: [] });
  sockets[0].message('{bad json');
  assert.deepEqual(events.filter((event) => event.type === 'payload'), [
    { type: 'payload', payload: { type: 'state', users: [] } },
  ]);
});

test('send is joined-only while sendRaw requires only an open socket', () => {
  const { connection, sockets } = harness();
  assert.equal(connection.sendRaw({ type: 'before' }), false);
  connection.connect();
  assert.equal(connection.sendRaw({ type: 'connecting' }), false);
  sockets[0].open();
  assert.equal(connection.isReady(), false);
  assert.equal(connection.send({ type: 'message' }), false);
  assert.equal(connection.sendRaw({ type: 'switchChannel', channelId: 'random' }), true);
  assert.equal(connection.markJoined(), true);
  assert.equal(connection.isReady(), true);
  assert.equal(connection.send({ type: 'typing', active: true }), true);
  assert.deepEqual(sockets[0].sent.slice(1).map(JSON.parse), [
    { type: 'switchChannel', channelId: 'random' },
    { type: 'typing', active: true },
  ]);
  assert.equal(connection.markJoined(false), false);
  assert.equal(connection.isReady(), false);
});

test('disconnect schedules exact exponential jitter backoff and reconnect uses latest identity', () => {
  const randoms = [0, 1, .5];
  const { connection, sockets, events, timers, fireTimer, setIdentity } = harness({ random: () => randoms.shift() });
  connection.connect();
  sockets[0].open();
  connection.markJoined();
  sockets[0].serverClose();
  assert.equal(connection.isReady(), false);
  assert.equal(events.at(-1).type, 'retryScheduled');
  assert.deepEqual({ base: events.at(-1).base, delay: events.at(-1).delay }, { base: 700, delay: 525 });
  assert.equal([...timers.values()][0].delay, 525);

  setIdentity({ username: '新名字', avatarSeed: 22, resumeToken: 'resume-2', channelId: 'random' });
  fireTimer();
  sockets[1].open();
  assert.equal(sent(sockets[1]).username, '新名字');
  assert.equal(sent(sockets[1]).channelId, 'random');
  sockets[1].serverClose();
  assert.equal(events.at(-1).base, 1400);
  assert.equal(events.at(-1).delay, 1750);
});

test('markJoined resets reconnect attempt and exact base caps at 30 seconds', () => {
  const { connection, sockets, events, fireTimer } = harness({ random: () => .5 });
  connection.connect();
  // 测试 3 次重试（MAX_RECONNECT_ATTEMPTS = 3）
  for (let attempt = 0; attempt < 3; attempt += 1) {
    sockets.at(-1).open();
    sockets.at(-1).serverClose();
    const retry = events.at(-1);
    assert.equal(retry.type, 'retryScheduled');
    assert.equal(retry.base, Math.min(30_000, 700 * 2 ** Math.min(attempt, 6)));
    fireTimer();
  }
  sockets.at(-1).open();
  connection.markJoined();
  sockets.at(-1).serverClose();
  assert.equal(events.at(-1).base, 700);
});

test('intentional close cancels reconnect; non-intentional close and retry reconnect', () => {
  const { connection, sockets, timers, fireTimer } = harness();
  connection.connect();
  sockets[0].open();
  assert.equal(connection.close(), true);
  assert.equal(timers.size, 0);
  assert.equal(connection.getSocket(), null);
  assert.equal(connection.retry(), true);
  sockets[1].open();
  assert.equal(connection.close({ intentional: false }), true);
  assert.equal(timers.size, 1);
  fireTimer();
  assert.equal(sockets.length, 3);
});

test('offline cancels retry and online reconnects unless closure was intentional', () => {
  const { connection, sockets, timers, setOnline } = harness();
  connection.connect();
  sockets[0].open();
  sockets[0].serverClose();
  assert.equal(timers.size, 1);
  setOnline(false);
  connection.handleOffline();
  assert.equal(timers.size, 0);
  assert.equal(connection.handleOnline(), false);
  setOnline(true);
  assert.equal(connection.online(), true);
  assert.equal(sockets.length, 2);
  connection.close();
  assert.equal(connection.handleOnline(), false);
});

test('replacing a live socket ignores its stale close callback', () => {
  const { connection, sockets, events, timers } = harness();
  connection.connect();
  sockets[0].open();
  connection.connect();
  assert.equal(sockets[0].closeCalls, 1);
  assert.equal(sockets.length, 2);
  assert.equal(events.filter((event) => event.type === 'close').length, 0);
  assert.equal(timers.size, 0);
});

test('offline cancellation also invalidates a timer callback already queued by the host', () => {
  const { connection, sockets, timers, setOnline } = harness();
  connection.connect();
  sockets[0].open();
  sockets[0].serverClose();
  const queued = [...timers.values()][0].callback;
  setOnline(false);
  connection.offline();
  queued();
  assert.equal(sockets.length, 1);
});

test('server stopped clears persistence, disables reconnect and emits lifecycle', () => {
  const { connection, sockets, events, timers, storageData } = harness();
  connection.setSession({ token: 'resume-token', username: '北岸' });
  connection.writeChannelId('general');
  connection.connect();
  sockets[0].open();
  connection.markJoined();
  sockets[0].serverClose(1001, 'server stopped');
  assert.equal(storageData.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(connection.getSocket(), null);
  assert.equal(events.at(-2).type, 'close');
  assert.equal(events.at(-2).intentional, true);
  assert.equal(events.at(-1).type, 'serviceStopped');
  assert.equal(connection.handleOnline(), false);
  assert.equal(connection.connect(), false);
  assert.equal(sockets.length, 1);
  assert.equal(connection.retry(), true);
  assert.equal(sockets.length, 2);
});

test('kicked and ip_denied closes do not reconnect', () => {
  for (const [code, reason, eventType] of [
    [4008, 'kicked', 'moderationClose'],
    [4009, 'ip_denied', 'moderationClose'],
  ]) {
    const { connection, sockets, events, timers, storageData } = harness();
    connection.setSession({ token: 'resume-token', username: '北岸' });
    connection.connect();
    sockets[0].open();
    connection.markJoined();
    sockets[0].serverClose(code, reason);
    assert.equal(storageData.size, 0, reason);
    assert.equal(timers.size, 0, reason);
    assert.equal(events.at(-1).type, eventType, reason);
    assert.equal(events.at(-1).reason === 'kicked' || events.at(-1).reason === 'denied' || events.at(-2).terminal, true);
    assert.equal(connection.connect(), false, reason);
    assert.equal(connection.retry(), true, reason);
  }
});

test('persistence methods preserve legacy keys and tolerate invalid or failing storage', () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  assert.equal(setSession({ token: 't', username: 'u' }, storage), true);
  assert.deepEqual(readSession(storage), { token: 't', username: 'u' });
  data.set('pavilo.resume', JSON.stringify({ token: 1, username: 'u' }));
  assert.equal(readSession(storage), null);
  data.set('pavilo.resume', '{bad');
  assert.equal(readSession(storage), null);
  assert.equal(writeChannelId('random', storage), true);
  assert.equal(readChannelId(storage), 'random');
  assert.equal(clearSession(storage), true);
  assert.equal(clearChannelId(storage), true);
  const broken = new Proxy({}, { get() { throw new Error('denied'); } });
  assert.equal(readSession(broken), null);
  assert.equal(setSession({}, broken), false);
  assert.equal(clearSession(broken), false);
  assert.equal(readChannelId(broken), null);
  assert.equal(writeChannelId('x', broken), false);
  assert.equal(clearChannelId(broken), false);
});

test('throwing sessionStorage getter does not break module creation or persistence calls', () => {
  const browser = {};
  Object.defineProperty(browser, 'sessionStorage', { get() { throw new Error('denied'); } });
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/connection'), 'utf8'), browser);
  assert.doesNotThrow(() => browser.PaviloConnection.createConnection({ clientSessionId: 'client-session-1' }));
  assert.equal(browser.PaviloConnection.readSession(), null);
  assert.equal(browser.PaviloConnection.setSession({ token: 't', username: 'u' }), false);
  assert.equal(browser.PaviloConnection.clearSession(), false);
  assert.equal(browser.PaviloConnection.readChannelId(), null);
  assert.equal(browser.PaviloConnection.writeChannelId('general'), false);
  assert.equal(browser.PaviloConnection.clearChannelId(), false);
});

test('socket errors are surfaced and constructor failures schedule retry', () => {
  const { connection, sockets, events } = harness();
  connection.connect();
  sockets[0].dispatch('error', { error: new Error('boom') });
  assert.equal(events.at(-1).type, 'error');

  const failed = harness({ constructError: new Error('constructor failed') });
  assert.equal(failed.connection.connect(), false);
  assert.equal(failed.events.at(-2).type, 'error');
  assert.equal(failed.events.at(-1).type, 'retryScheduled');
});
