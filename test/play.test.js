'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { DEFAULTS, parseConfig } = require('../config');
const { createChatCore } = require('../src/core');
const { createPlayRuntime, createPlayAgent, isLegalAction } = require('../src/play');
const { createChatServer } = require('../server');

const PLAY_CHANNELS = [
  { id: 'general', name: '闲聊', description: '', enabled: true, readOnly: false, maxUsers: 16, welcome: '' },
  { id: 'echo', name: '回声', description: '', enabled: true, readOnly: false, maxUsers: 8, welcome: '', play: 'echo' }
];

function createPlayHarness(options = {}) {
  let clock = 1_000;
  let sequence = 0;
  const timers = [];
  const delayed = [];
  const config = { ...DEFAULTS, ...options, plays: options.plays || ['echo'], channels: options.channels || PLAY_CHANNELS, defaultChannelId: 'general' };
  const core = createChatCore(config, {
    now: () => clock,
    randomId: (prefix) => `${prefix}_${String(++sequence).padStart(16, '0')}`,
    randomResumeToken: () => `resume-${String(++sequence).padStart(12, '0')}`,
    randomAvatarSeed: () => 42,
    schedule(fn, ms) {
      const timer = { fn, at: clock + (ms || 0), cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(timer) { if (timer) timer.cancelled = true; },
    log() {}
  });
  const plays = createPlayRuntime(config, {
    root: path.join(__dirname, '..'),
    now: () => clock,
    randomId: (prefix) => `${prefix}_${String(++sequence).padStart(16, '0')}`,
    schedule(fn, ms) {
      if (!ms) {
        delayed.push(fn);
        return 0;
      }
      const timer = { fn, at: clock + ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    complete: options.complete || (async () => ({ ok: false, code: 'GATEWAY_DISABLED' })),
    onEffects: (effects) => core.deliverPlayEffects(effects),
    seatAgent: (input) => core.seatAgent(input),
    roster: (channelId) => core.roster(channelId)
  });
  core.attachPlayRuntime(plays);
  function flush() {
    const jobs = delayed.splice(0);
    for (const fn of jobs) fn();
  }
  function advance(ms) {
    clock += ms;
    for (const timer of timers.filter((item) => !item.cancelled && item.at <= clock)) {
      timer.cancelled = true;
      timer.fn();
    }
    flush();
  }
  return { core, plays, flush, advance };
}

function join(core, peerId, username, clientSessionId, channelId) {
  assert.equal(core.connect(peerId, '192.0.2.10'), true);
  const result = core.dispatch(peerId, {
    type: 'join',
    protocolVersion: 4,
    username,
    clientSessionId,
    channelId,
    avatarSeed: 17
  });
  assert.equal(result.accepted, true, result.error && result.error.message);
  const initial = result.effects.find((effect) => effect.kind === 'initial');
  assert.ok(initial);
  core.completeSync(peerId);
  return initial;
}

test('v2 sqlite config enables echo and rejects unbound play ids', () => {
  const config = parseConfig(`
version: 2
storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
plays:
  - echo
channels:
  - id: general
    name: 闲聊
  - id: echo
    name: 回声
    play: echo
`);
  assert.deepEqual(config.plays, ['echo']);
  assert.equal(config.channels[1].play, 'echo');
  assert.throws(() => parseConfig(`
version: 2
storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
plays:
  - echo
channels:
  - id: general
    name: 闲聊
    play: werewolf
`), /未在 plays 中启用/);
});

test('echo playAction is private and illegal actions are rejected', () => {
  const { core } = createPlayHarness();
  const alice = join(core, 'alice-peer', 'Alice', 'session-alice-0001', 'echo');
  const start = alice.payloads[0];
  assert.ok(start.capabilities.includes('play'));
  assert.deepEqual(start.play, { id: 'echo', page: '/plays/echo/' });
  assert.equal(alice.payloads.at(-1).type, 'playState');
  assert.equal(alice.payloads.at(-1).visibility, 'private');

  join(core, 'bob-peer', 'Bob', 'session-bob-0001', 'echo');
  const echoed = core.dispatch('alice-peer', {
    type: 'playAction',
    clientActionId: 'action-echo-0001',
    name: 'echo',
    payload: { text: 'ping' }
  });
  assert.equal(echoed.accepted, true);
  const states = echoed.effects.filter((effect) => effect.payload?.type === 'playState');
  assert.equal(states.length, 1);
  assert.equal(states[0].kind, 'send');
  assert.equal(states[0].peerId, 'alice-peer');
  assert.equal(states[0].payload.visibility, 'private');
  assert.equal(states[0].payload.state.lastEcho.payload.text, 'ping');
  assert.ok(!echoed.effects.some((effect) => effect.kind === 'broadcast' && effect.payload?.type === 'playState'));

  const rejected = core.dispatch('alice-peer', {
    type: 'playAction',
    clientActionId: 'action-bad-0001',
    name: 'vote',
    payload: {}
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.error.code, 'PLAY_ACTION_REJECTED');
});

test('unbound channels reject playAction and chat still works after a host crash', () => {
  const { core } = createPlayHarness();
  join(core, 'alice-peer', 'Alice', 'session-alice-0001', 'general');
  const unbound = core.dispatch('alice-peer', {
    type: 'playAction',
    clientActionId: 'action-none-001',
    name: 'echo',
    payload: {}
  });
  assert.equal(unbound.error.code, 'PLAY_NOT_BOUND');

  join(core, 'bob-peer', 'Bob', 'session-bob-0001', 'echo');
  const boom = core.dispatch('bob-peer', {
    type: 'playAction',
    clientActionId: 'action-boom-001',
    name: 'boom',
    payload: {}
  });
  assert.equal(boom.error.code, 'PLAY_HOST_FAILED');
  const again = core.dispatch('bob-peer', {
    type: 'playAction',
    clientActionId: 'action-echo-0002',
    name: 'echo',
    payload: { text: 'x' }
  });
  assert.equal(again.error.code, 'PLAY_HOST_FAILED');

  const chat = core.dispatch('alice-peer', {
    type: 'message',
    clientMessageId: 'message-chat-0001',
    kind: 'text',
    text: 'still here'
  });
  assert.equal(chat.accepted, true);
  assert.ok(chat.effects.some((effect) => effect.payload?.type === 'message'));
});

test('shout posts a public message and channel playState', () => {
  const { core } = createPlayHarness();
  join(core, 'alice-peer', 'Alice', 'session-alice-0001', 'echo');
  join(core, 'bob-peer', 'Bob', 'session-bob-0001', 'echo');
  const shouted = core.dispatch('alice-peer', {
    type: 'playAction',
    clientActionId: 'action-shout-001',
    name: 'shout',
    payload: { text: 'hello table' }
  });
  assert.equal(shouted.accepted, true);
  const playBroadcast = shouted.effects.find((effect) => effect.kind === 'broadcast' && effect.payload?.type === 'playState');
  assert.equal(playBroadcast.payload.visibility, 'channel');
  assert.equal(playBroadcast.payload.state.lastShout, 'hello table');
  assert.ok(playBroadcast.peerIds.includes('bob-peer'));
  assert.ok(shouted.effects.some((effect) => effect.payload?.type === 'message' && effect.payload.message.text === 'hello table'));
});

test('agent legalActions are enforced and a fixture agent can echo pong', async () => {
  assert.equal(isLegalAction({ name: 'echo', payload: { text: 'pong' } }, [{ name: 'echo', payload: { text: 'pong' } }]), true);
  assert.equal(isLegalAction({ name: 'echo', payload: { text: 'nope' } }, [{ name: 'echo', payload: { text: 'pong' } }]), false);
  const agent = createPlayAgent({
    role: 'echoer',
    system: () => 'json',
    view: (ctx) => ctx.privateView,
    schema: (ctx) => ctx.legalActions
  });
  const illegal = await agent.runTurn({
    legalActions: [{ name: 'echo', payload: { text: 'pong' } }],
    privateView: {},
    complete: async () => ({ ok: true, text: '{"name":"echo","payload":{"text":"hack"}}' }),
    memory: { read: () => [], append() {} }
  });
  assert.equal(illegal.name, 'skip');

  const { core, plays, flush } = createPlayHarness({
    complete: async () => ({ ok: true, text: '{"name":"echo","payload":{"text":"pong"}}' })
  });
  join(core, 'alice-peer', 'Alice', 'session-alice-0001', 'echo');
  const summoned = core.dispatch('alice-peer', {
    type: 'playAction',
    clientActionId: 'action-summon-01',
    name: 'summon',
    payload: {}
  });
  assert.equal(summoned.accepted, true);
  assert.ok(core.roster('echo').some((session) => session.kind === 'agent'));
  flush();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const view = plays.tableFor('echo').host.snapshot({ id: 'alice-peer', username: 'Alice', kind: 'human' });
  assert.equal(view.lastEcho.payload.text, 'pong');
  assert.equal(view.agentName, 'EchoBot');
});

test('play HTTP only serves page and assets of enabled plays', async (t) => {
  const app = createChatServer({
    host: '127.0.0.1',
    plays: ['echo'],
    channels: PLAY_CHANNELS,
    defaultChannelId: 'general'
  });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const page = await fetch(`${base}/plays/echo/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Play 契约夹具/);
  const script = await fetch(`${base}/plays/echo/app.js`);
  assert.equal(script.status, 200);
  const host = await fetch(`${base}/plays/echo/host.js`);
  assert.equal(host.status, 404);
  const manifest = await fetch(`${base}/plays/echo/play.json`);
  assert.equal(manifest.status, 404);
  const agents = await fetch(`${base}/plays/echo/agents/echoer.js`);
  assert.equal(agents.status, 404);
  const missing = await fetch(`${base}/plays/werewolf/`);
  assert.equal(missing.status, 404);
  const traversal = await fetch(`${base}/plays/echo/../werewolf/README.md`);
  assert.equal(traversal.status, 404);
  const info = await (await fetch(`${base}/room-info`)).json();
  assert.equal(info.channels.find((channel) => channel.id === 'echo').play, 'echo');
  assert.equal(info.channels.find((channel) => channel.id === 'general').play, undefined);
});

test('agent memory is scoped to a game and actor', () => {
  const { plays } = createPlayHarness();
  plays.store.saveGame('echo', { playId: 'echo', gameId: 'g1', state: { turn: 1 } });
  plays.store.appendMemory('g1', 'seer', { note: 'alice is wolf' });
  plays.store.appendMemory('g1', 'wolf', { note: 'secret' });
  plays.store.appendMemory('g2', 'seer', { note: 'other game' });
  assert.deepEqual(plays.store.readMemory('g1', 'seer').map((entry) => entry.body.note), ['alice is wolf']);
  assert.equal(plays.store.readMemory('g1', 'wolf').length, 1);
  plays.store.clearGame('echo');
  assert.equal(plays.store.readMemory('g1', 'seer').length, 0);
  assert.equal(plays.store.readMemory('g2', 'seer').length, 1);
});

test('echo fixture files exist on disk', () => {
  const root = path.join(__dirname, '..', 'plays', 'echo');
  assert.ok(fs.existsSync(path.join(root, 'play.json')));
  assert.ok(fs.existsSync(path.join(root, 'host.js')));
  assert.ok(fs.existsSync(path.join(root, 'page', 'index.html')));
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'plays', 'werewolf', 'host.js')));
});
