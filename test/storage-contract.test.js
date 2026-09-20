'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { DEFAULTS } = require('../config');
const { createConversationStore } = require('../src/storage');
const { createMemoryStore } = require('../src/storage/memory-store');
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

function runContract(label, createStore) {
  test(`${label}: appends oldest-first and reports working-set stats`, () => {
    const store = createStore(storeConfig());
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
    const store = createStore(storeConfig({ maxMessages: 2 }));
    const removed = [];
    for (let seq = 1; seq <= 3; seq += 1) {
      const message = textMessage(store.incrementSeq('general'), `n${seq}`);
      removed.push(store.appendMessage('general', message).removedIds);
    }
    assert.deepEqual(removed, [[], [], ['m1_msg']]);
    assert.deepEqual(store.loadWorkingSet('general').map((message) => message.text), ['n2', 'n3']);
    assert.equal(store.getMessage('general', 'm1_msg'), null);
    assert.equal(store.getChannelState('general').latestSeq, 3);
    store.close();
  });

  test(`${label}: incrementSeq consumes sequence even when the message is not stored`, () => {
    const store = createStore(storeConfig());
    const seq = store.incrementSeq('general');
    assert.equal(seq, 1);
    assert.equal(store.getChannelState('general').latestSeq, 1);
    assert.equal(store.loadWorkingSet('general').length, 0);
    store.close();
  });

  test(`${label}: idempotent append records fingerprint and ack in the same write`, () => {
    const store = createStore(storeConfig());
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
    const store = createStore(storeConfig({ maxRoomBytes: 300 }));
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
    assert.equal(store.updateReactions('general', message.id, () => {}), null);
    store.close();
  });

  test(`${label}: loadHistoryPage walks the working set oldest-first and exhausts at the start`, () => {
    const store = createStore(storeConfig());
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
    const store = createStore(storeConfig());
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

  test(`${label}: clear resets working set and seq but keeps epoch`, () => {
    const store = createStore(storeConfig());
    const epoch = store.getChannelState('general').epoch;
    store.appendMessage('general', textMessage(store.incrementSeq('general'), 'gone'));
    store.clear();
    assert.equal(store.loadWorkingSet('general').length, 0);
    assert.equal(store.getChannelState('general').latestSeq, 0);
    assert.equal(store.getChannelState('general').epoch, epoch);
    assert.equal(store.findIdempotent('general:token-a', 'client-1'), null);
    store.close();
  });

  test(`${label}: pruneExpired is a no-op without retention and integrity is clean`, () => {
    const store = createStore(storeConfig());
    store.appendMessage('general', textMessage(store.incrementSeq('general'), 'keep'));
    assert.deepEqual(store.pruneExpired(), { deleted: 0 });
    assert.equal(store.loadWorkingSet('general').length, 1);
    assert.deepEqual(store.integrity(), { ok: true, driver: store.driver });
    store.close();
  });
}

runContract('memory', (config, runtime) => createMemoryStore(config, runtime));

test('createConversationStore defaults to memory and rejects unknown drivers', () => {
  const store = createConversationStore(storeConfig());
  assert.equal(store.driver, 'memory');
  assert.equal(store.ephemeral, true);
  store.close();
  assert.throws(() => createConversationStore(storeConfig({ storage: { driver: 'postgres' } })), /Unsupported storage driver/);
});
