'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { DEFAULTS } = require('../config');
const { createConversationStore } = require('../src/storage');
const { createMemoryStore } = require('../src/storage/memory-store');
const { createSqliteStore } = require('../src/storage/sqlite-store');
const { isNodeSqliteAvailable } = require('../src/storage/sqlite-engine');
const { publicMessage } = require('../src/core/events');

function storeConfig(overrides = {}) {
  const config = { ...DEFAULTS, ...overrides };
  config.channels = (overrides.channels || DEFAULTS.channels).map((channel) => ({ ...channel }));
  return config;
}

function textMessage(seq, text = `message ${seq}`, extra = {}) {
  const message = {
    id: `m${seq}_msg`,
    seq,
    clientMessageId: `client-${seq}`,
    kind: 'text',
    author: { id: 'u1', username: 'Alice', avatarSeed: 1, joinedAt: 1000 },
    createdAt: 1000 + seq,
    replyTo: null,
    reactions: {},
    text,
    reactionUsers: new Map(),
    ...extra
  };
  message.byteSize = Buffer.byteLength(JSON.stringify(publicMessage(message)));
  return message;
}

function sqliteConfig(filePath, engine, overrides = {}) {
  const config = storeConfig(overrides);
  config.storage = {
    driver: 'sqlite',
    sqlite: {
      path: filePath,
      engine,
      retentionDays: overrides.retentionDays === undefined ? 30 : overrides.retentionDays
    }
  };
  return config;
}

function sqliteFactory(engine) {
  return (overrides = {}, runtime = {}) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-sqlite-'));
    const config = sqliteConfig(path.join(directory, 'pavilo.db'), engine, overrides);
    const store = createSqliteStore(config, runtime);
    const close = store.close.bind(store);
    store.close = () => {
      try { close(); } catch { /* already closed */ }
      fs.rmSync(directory, { recursive: true, force: true });
    };
    return store;
  };
}

function betterSqliteAvailable() {
  try {
    require('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

function runContract(label, createStore) {
  test(`${label}: appends oldest-first and reports working-set stats`, () => {
    const store = createStore();
    const first = textMessage(store.incrementSeq('general'), 'one');
    const second = textMessage(store.incrementSeq('general'), 'two');
    store.appendMessage('general', first);
    store.appendMessage('general', second);
    assert.deepEqual(store.loadWorkingSet('general').map((message) => message.text), ['one', 'two']);
    assert.equal(store.getMessage('general', first.id).text, 'one');
    assert.equal(store.getChannelState('general').latestSeq, 2);
    assert.deepEqual(store.stats().find((channel) => channel.id === 'general'), {
      id: 'general',
      messages: 2,
      roomBytes: first.byteSize + second.byteSize,
      latestSeq: 2
    });
    store.close();
  });

  test(`${label}: FIFO eviction drops working-set rows and does not reuse seq`, () => {
    const store = createStore({ maxMessages: 2 });
    const removed = [];
    for (let seq = 1; seq <= 3; seq += 1) {
      const message = textMessage(store.incrementSeq('general'), `n${seq}`);
      removed.push(store.appendMessage('general', message).removedIds);
    }
    assert.deepEqual(removed, [[], [], ['m1_msg']]);
    assert.deepEqual(store.loadWorkingSet('general').map((message) => message.text), ['n2', 'n3']);
    if (store.driver === 'memory') assert.equal(store.getMessage('general', 'm1_msg'), null);
    else assert.equal(store.getMessage('general', 'm1_msg').text, 'n1');
    assert.equal(store.getChannelState('general').latestSeq, 3);
    if (store.driver === 'sqlite') {
      const page = store.loadHistoryPage('general', { beforeSeq: 2, limit: 10 });
      assert.deepEqual(page.messages.map((message) => message.text), ['n1']);
      assert.equal(page.exhausted, true);
      assert.equal(store.durableMessageCount('general'), 3);
    }
    store.close();
  });

  test(`${label}: incrementSeq consumes sequence even when the message is not stored`, () => {
    const store = createStore();
    const seq = store.incrementSeq('general');
    assert.equal(seq, 1);
    assert.equal(store.getChannelState('general').latestSeq, 1);
    assert.equal(store.loadWorkingSet('general').length, 0);
    store.close();
  });

  test(`${label}: idempotent append records fingerprint and ack in the same write`, () => {
    const store = createStore();
    const message = textMessage(store.incrementSeq('general'), 'once');
    const ack = { type: 'ack', clientMessageId: message.clientMessageId, messageId: message.id, seq: message.seq, createdAt: message.createdAt };
    store.appendMessage('general', message, {
      idempotency: { scope: 'general:token-a', clientMessageId: message.clientMessageId, fingerprint: 'fp-one', ack }
    });
    const previous = store.findIdempotent('general:token-a', message.clientMessageId);
    assert.equal(previous.fingerprint, 'fp-one');
    assert.deepEqual(previous.ack, ack);
    assert.equal(store.findIdempotent('general:token-b', message.clientMessageId), null);
    store.close();
  });

  test(`${label}: updateReactions mutates in place and can FIFO the target`, () => {
    const store = createStore({ maxRoomBytes: 300 });
    const message = textMessage(store.incrementSeq('general'), 'x');
    store.appendMessage('general', message);
    const grown = store.updateReactions('general', message.id, (item) => {
      item.reactionUsers.set('👍', new Set(['u1']));
      item.reactions = { '👍': { count: 1, userIds: ['u1'] } };
      item.byteSize = 400;
    });
    assert.deepEqual(grown.removedIds, [message.id]);
    assert.equal(grown.message, null);
    assert.equal(store.loadWorkingSet('general').length, 0);
    if (store.driver === 'memory') assert.equal(store.updateReactions('general', message.id, () => {}), null);
    else assert.equal(store.updateReactions('general', message.id, () => {}).message.id, message.id);
    store.close();
  });

  test(`${label}: loadHistoryPage walks history oldest-first and exhausts at the start`, () => {
    const store = createStore();
    for (const text of ['a', 'b', 'c']) {
      store.appendMessage('general', textMessage(store.incrementSeq('general'), text));
    }
    const page = store.loadHistoryPage('general', { beforeSeq: 4, limit: 2 });
    assert.deepEqual(page.messages.map((message) => message.text), ['b', 'c']);
    assert.equal(page.exhausted, false);
    const start = store.loadHistoryPage('general', { beforeSeq: 2, limit: 2 });
    assert.deepEqual(start.messages.map((message) => message.text), ['a']);
    assert.equal(start.exhausted, true);
    store.close();
  });

  test(`${label}: images round-trip as the public image object`, () => {
    const store = createStore();
    const image = {
      src: 'data:image/png;base64,AAAA',
      mime: 'image/png',
      width: 1,
      height: 1,
      bytes: 3
    };
    const message = textMessage(store.incrementSeq('general'), '', { kind: 'image', image });
    delete message.text;
    message.byteSize = Buffer.byteLength(JSON.stringify(publicMessage(message)));
    store.appendMessage('general', message);
    assert.deepEqual(store.getMessage('general', message.id).image, image);
    store.close();
  });

  test(`${label}: integrity is clean and recent rows survive pruneExpired`, () => {
    const store = createStore();
    store.appendMessage('general', textMessage(store.incrementSeq('general'), 'keep'));
    assert.deepEqual(store.pruneExpired(2000), { deleted: 0 });
    assert.equal(store.loadWorkingSet('general').length, 1);
    const report = store.integrity();
    assert.equal(report.ok, true);
    assert.equal(report.driver, store.driver);
    store.close();
  });
}

function runDurableContract(label, engine) {
  test(`${label}: restart keeps epoch, seq, working set and idempotency`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-sqlite-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const config = sqliteConfig(path.join(directory, 'pavilo.db'), engine);
    const runtime = { now: () => 1000, randomId: (prefix) => `${prefix}_restart` };
    const first = createSqliteStore(config, runtime);
    const epoch = first.getChannelState('general').epoch;
    const message = textMessage(first.incrementSeq('general'), 'stay');
    const ack = { type: 'ack', clientMessageId: message.clientMessageId, messageId: message.id, seq: message.seq, createdAt: message.createdAt };
    first.appendMessage('general', message, {
      idempotency: { scope: 'general:token-a', clientMessageId: message.clientMessageId, fingerprint: 'fp-stay', ack }
    });
    first.close();

    const second = createSqliteStore(config, runtime);
    t.after(() => second.close());
    assert.equal(second.getChannelState('general').epoch, epoch);
    assert.equal(second.getChannelState('general').latestSeq, 1);
    assert.deepEqual(second.loadWorkingSet('general').map((item) => item.text), ['stay']);
    assert.equal(second.findIdempotent('general:token-a', message.clientMessageId).fingerprint, 'fp-stay');
  });

  test(`${label}: seq holes survive restart when the message was never stored`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-sqlite-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const config = sqliteConfig(path.join(directory, 'pavilo.db'), engine);
    const first = createSqliteStore(config);
    first.incrementSeq('general');
    first.close();
    const second = createSqliteStore(config);
    t.after(() => second.close());
    assert.equal(second.getChannelState('general').latestSeq, 1);
    assert.equal(second.loadWorkingSet('general').length, 0);
    assert.equal(second.incrementSeq('general'), 2);
  });

  test(`${label}: pruneExpired deletes old rows and does not reuse seq`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-sqlite-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    let clock = 1_000;
    const config = sqliteConfig(path.join(directory, 'pavilo.db'), engine, { retentionDays: 30 });
    const store = createSqliteStore(config, { now: () => clock });
    t.after(() => { try { store.close(); } catch { /* closed */ } });
    store.appendMessage('general', textMessage(store.incrementSeq('general'), 'old'));
    clock = 1_000 + 31 * 24 * 60 * 60 * 1000;
    assert.equal(store.pruneExpired().deleted, 1);
    assert.equal(store.loadWorkingSet('general').length, 0);
    assert.equal(store.durableMessageCount('general'), 0);
    assert.equal(store.getChannelState('general').latestSeq, 1);
    store.close();
    const reopened = createSqliteStore(config, { now: () => clock });
    t.after(() => reopened.close());
    assert.equal(reopened.durableMessageCount('general'), 0);
    assert.equal(reopened.getChannelState('general').latestSeq, 1);
  });

  test(`${label}: applying migrations twice is a no-op`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-sqlite-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const config = sqliteConfig(path.join(directory, 'pavilo.db'), engine);
    const first = createSqliteStore(config);
    first.appendMessage('general', textMessage(first.incrementSeq('general'), 'kept'));
    first.close();
    const second = createSqliteStore(config);
    t.after(() => second.close());
    assert.equal(second.loadWorkingSet('general')[0].text, 'kept');
    assert.equal(second.integrity().ok, true);
  });

  test(`${label}: a failed append transaction leaves no durable message`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-sqlite-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const config = sqliteConfig(path.join(directory, 'pavilo.db'), engine);
    const store = createSqliteStore(config);
    t.after(() => { try { store.close(); } catch { /* closed */ } });
    const first = textMessage(store.incrementSeq('general'), 'ok');
    store.appendMessage('general', first);
    const duplicate = { ...first, text: 'conflict' };
    assert.throws(() => store.appendMessage('general', duplicate));
    assert.equal(store.durableMessageCount('general'), 1);
    assert.deepEqual(store.loadWorkingSet('general').map((message) => message.text), ['ok']);
  });
}

runContract('memory', (overrides, runtime) => createMemoryStore(storeConfig(overrides), runtime));

test('memory: clear resets working set and seq but keeps epoch', () => {
  const store = createMemoryStore(storeConfig());
  const epoch = store.getChannelState('general').epoch;
  store.appendMessage('general', textMessage(store.incrementSeq('general'), 'gone'));
  store.clear();
  assert.equal(store.loadWorkingSet('general').length, 0);
  assert.equal(store.getChannelState('general').latestSeq, 0);
  assert.equal(store.getChannelState('general').epoch, epoch);
  store.close();
});

test('createConversationStore defaults to memory and rejects unknown drivers', () => {
  const store = createConversationStore(storeConfig());
  assert.equal(store.driver, 'memory');
  assert.equal(store.ephemeral, true);
  store.close();
  assert.throws(() => createConversationStore(storeConfig({ storage: { driver: 'postgres' } })), /Unsupported storage driver/);
});

if (isNodeSqliteAvailable()) {
  runContract('sqlite/node', sqliteFactory('node'));
  runDurableContract('sqlite/node', 'node');
  test('createConversationStore opens sqlite with node engine', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-sqlite-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = createConversationStore(sqliteConfig(path.join(directory, 'pavilo.db'), 'node'));
    t.after(() => store.close());
    assert.equal(store.driver, 'sqlite');
    assert.equal(store.ephemeral, false);
    assert.equal(store.engine, 'node');
  });
} else {
  test('sqlite/node engine', { skip: 'node:sqlite is unavailable' }, () => {});
}

if (betterSqliteAvailable()) {
  runContract('sqlite/better-sqlite3', sqliteFactory('better-sqlite3'));
  runDurableContract('sqlite/better-sqlite3', 'better-sqlite3');
} else {
  test('sqlite/better-sqlite3 engine', { skip: 'better-sqlite3 is not installed' }, () => {});
}
