'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { PendingQueue, createPendingQueue, draftMatches } = require('../client/pending');

function harness(options = {}) {
  let nextTimer = 1;
  const timers = new Map();
  const cleared = [];
  const ids = [...(options.ids || ['generated-1', 'generated-2'])];
  const queue = createPendingQueue({
    makeId: () => ids.shift(),
    ackTimeout: options.ackTimeout || 8_000,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { cleared.push(id); timers.delete(id); },
  });
  const events = [];
  queue.subscribe((event) => events.push(event));
  return {
    queue, events, timers, cleared,
    fire(id) { const timer = timers.get(id); timers.delete(id); timer.callback(); },
  };
}

function text(overrides = {}) {
  return { id: 'text-1', kind: 'text', text: 'hello', epoch: 'epoch-1',
    status: 'sending', attempts: 1, ...overrides };
}

test('UMD loads without DOM access and exposes identical browser and Node APIs', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/pending'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.PaviloPending).sort(), Object.keys(require('../client/pending')).sort());
  assert.equal(typeof browser.PaviloPending.PendingQueue, 'function');
  assert.equal(browser.document, undefined);
});

test('add/get/values/size and subscriptions expose queue lifecycle without DOM coupling', () => {
  const { queue, events } = harness();
  const unsubscribe = queue.subscribe(() => { throw new Error('unsubscribed listener ran'); });
  unsubscribe();
  const first = queue.add(text());
  const second = queue.add({ kind: 'image', image: { src: 'data:x', bytes: 1 } });
  assert.equal(second.id, 'generated-1');
  assert.equal(queue.size, 2);
  assert.equal(queue.get(first.id), first);
  assert.deepEqual([...queue.values()], [first, second]);
  assert.equal(events[0].type, 'added');
  assert.throws(() => queue.add(text()), /already exists/);
});

test('default ID works when randomUUID is unavailable', () => {
  const browser = { crypto: {
    getRandomValues(bytes) { bytes.fill(0xab); return bytes; },
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/pending'), 'utf8'), browser);
  const item = browser.PaviloPending.createPendingQueue().add({ kind: 'text', text: 'hello' });
  assert.match(item.id, /^cm_[0-9a-f]{32}$/);
});

test('default ID falls back without a Web Crypto object', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/pending'), 'utf8'), browser);
  const item = browser.PaviloPending.createPendingQueue().add({ kind: 'text', text: 'hello' });
  assert.match(item.id, /^cm_[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/);
  assert.ok(item.id.length >= 8 && item.id.length <= 96);
});

test('unsafe work ignores accepted entries and sending-text helper permits only one active text', () => {
  const { queue } = harness();
  queue.add(text({ status: 'accepted' }));
  assert.equal(queue.pendingChannelWork(), null);
  assert.equal(queue.unsafeChannelWork('   ', 0), false);
  assert.equal(queue.unsafeChannelWork(' draft ', 0), true);
  assert.equal(queue.unsafeChannelWork('', 1), true);
  assert.equal(queue.hasSendingText(), false);
  queue.add(text({ id: 'text-2', status: 'unconfirmed' }));
  assert.equal(queue.pendingChannelWork().id, 'text-2');
  assert.equal(queue.unsafeChannelWork('', 0), true);
  assert.equal(queue.hasSendingText(), false);
  queue.get('text-2').status = 'sending';
  assert.equal(queue.hasSendingText(), true);
});

test('transmit creates the wire command and ACK timeout makes a send unconfirmed', () => {
  const { queue, events, timers, fire } = harness();
  const item = queue.add(text({ replyToId: 'reply-1' }));
  const commands = [];
  assert.equal(queue.transmit(item.id, { isReady: () => true, send(command) { commands.push(command); return true; }, now: 42 }), true);
  assert.deepEqual(commands, [{ type: 'message', kind: 'text', clientMessageId: 'text-1', replyTo: 'reply-1', text: 'hello' }]);
  assert.equal(item.sentAt, 42);
  assert.equal(item.status, 'sending');
  assert.equal(timers.get(item.timer).delay, 8_000);
  fire(item.timer);
  assert.equal(item.status, 'unconfirmed');
  assert.equal(item.timer, null);
  assert.equal(events.at(-1).reason, 'ack-timeout');
});

test('transmit handles unavailable and failed transports without leaving ACK timers', () => {
  const { queue, timers } = harness();
  const item = queue.add(text());
  assert.equal(queue.transmit(item.id, { isReady: false, send() { throw new Error('must not call'); } }), false);
  assert.equal(item.status, 'unconfirmed');
  assert.equal(timers.size, 0);
  assert.equal(queue.transmit(item.id, { send() { return false; } }), false);
  assert.equal(item.status, 'unconfirmed');
  assert.equal(timers.size, 0);
  assert.equal(queue.transmit(item.id, { send() { throw new Error('socket closed'); } }), false);
  assert.equal(item.status, 'unconfirmed');
});

test('image transmission carries image payload and omits empty reply target', () => {
  const { queue } = harness();
  const image = { src: 'data:image/png;base64,x', bytes: 1 };
  const item = queue.add({ id: 'image-1', kind: 'image', image, epoch: 'epoch-1' });
  let command;
  queue.transmit(item.id, { send(value) { command = value; return true; } });
  assert.deepEqual(command, { type: 'message', kind: 'image', clientMessageId: 'image-1', replyTo: undefined, image });
});

test('ACK cancels timeout, marks accepted, emits draft cleanup effect, and can remove canonical echo', () => {
  const { queue, events, timers, cleared } = harness();
  const item = queue.add(text());
  queue.transmit(item.id, { send: () => true });
  const timer = item.timer;
  assert.equal(queue.settleAck({ clientMessageId: item.id }), item);
  assert.equal(item.status, 'accepted');
  assert.equal(item.timer, null);
  assert.equal(timers.size, 0);
  assert.ok(cleared.includes(timer));
  assert.equal(events.find((event) => event.type === 'accepted').cleanupAfter, 5_000);
  assert.equal(queue.size, 1, 'accepted remains until canonical echo or UI cleanup');

  const canonical = { id: 'server-1', clientMessageId: item.id };
  queue.settleAck({ clientMessageId: item.id }, [canonical]);
  assert.equal(queue.size, 0);
  assert.equal(events.at(-1).type, 'removed');
  assert.equal(events.at(-1).canonical, canonical);
  assert.equal(queue.settleAck({ clientMessageId: 'missing' }), null);
});

test('ACK from a different explicit epoch is refused', () => {
  const { queue } = harness();
  const item = queue.add(text());
  assert.equal(queue.settleAck({ clientMessageId: item.id, roomEpoch: 'epoch-2' }), null);
  assert.equal(item.status, 'sending');
});

test('canonical reconciliation removes entries and emits the canonical message for UI effects', () => {
  const { queue, events } = harness();
  const item = queue.add(text({ status: 'unconfirmed' }));
  const canonical = { id: 'server-1', clientMessageId: item.id, text: 'hello' };
  queue.reconcile([canonical], { roomEpoch: 'epoch-1' });
  assert.equal(queue.get(item.id), undefined);
  const reconciled = events.find((event) => event.type === 'reconciled');
  assert.equal(reconciled.item, item);
  assert.equal(reconciled.canonical, canonical);
});

test('reconcile retries only a same-epoch, non-sending item with attempts below two', () => {
  for (const [overrides, shouldSend] of [
    [{ id: 'eligible', status: 'unconfirmed', attempts: 1, epoch: 'epoch-1' }, true],
    [{ id: 'sending', status: 'sending', attempts: 1, epoch: 'epoch-1' }, false],
    [{ id: 'spent', status: 'unconfirmed', attempts: 2, epoch: 'epoch-1' }, false],
  ]) {
    const { queue } = harness();
    const item = queue.add(text(overrides));
    let sends = 0;
    queue.reconcile([], { roomEpoch: 'epoch-1', allowRetry: true, send() { sends += 1; return true; } });
    assert.equal(sends, shouldSend ? 1 : 0);
    assert.equal(item.attempts, shouldSend ? 2 : overrides.attempts);
  }
});

test('reconcile refuses an old epoch and marks it for explicit user retry', () => {
  const { queue, events } = harness();
  const item = queue.add(text({ status: 'unconfirmed' }));
  let sends = 0;
  queue.reconcile([], { roomEpoch: 'epoch-2', allowRetry: true, send() { sends += 1; return true; } });
  assert.equal(sends, 0);
  assert.equal(item.status, 'error');
  assert.equal(item.error, '房间已经重启，请确认后重试。');
  assert.equal(events.at(-1).reason, 'error');
});

test('explicit retry after epoch change assigns a fresh ID before sending', () => {
  const { queue, events } = harness({ ids: ['fresh-id'] });
  const item = queue.add(text({ status: 'error' }));
  let command;
  assert.equal(queue.retry(item.id, { roomEpoch: 'epoch-2', send(value) { command = value; return true; } }), true);
  assert.equal(queue.get('text-1'), undefined);
  assert.equal(queue.get('fresh-id'), item);
  assert.equal(item.id, 'fresh-id');
  assert.equal(item.epoch, 'epoch-2');
  assert.equal(item.attempts, 2);
  assert.equal(command.clientMessageId, 'fresh-id');
  const rekeyed = events.find((event) => event.type === 'rekeyed');
  assert.equal(rekeyed.oldId, 'text-1');
});

test('retry in the same epoch preserves ID and increments attempts', () => {
  const { queue } = harness();
  const item = queue.add(text({ status: 'unconfirmed' }));
  queue.retry(item.id, { roomEpoch: 'epoch-1', send: () => true });
  assert.equal(item.id, 'text-1');
  assert.equal(item.attempts, 2);
  assert.equal(item.status, 'sending');
});

test('disconnect cancels timers and changes only sending items to unconfirmed', () => {
  const { queue, timers, events } = harness();
  const sending = queue.add(text());
  const accepted = queue.add(text({ id: 'accepted', status: 'accepted' }));
  const failed = queue.add(text({ id: 'failed', status: 'error' }));
  queue.transmit(sending.id, { send: () => true });
  assert.equal(timers.size, 1);
  queue.disconnect();
  assert.equal(timers.size, 0);
  assert.equal(sending.status, 'unconfirmed');
  assert.equal(accepted.status, 'accepted');
  assert.equal(failed.status, 'error');
  assert.equal(events.filter((event) => event.reason === 'disconnect').length, 1);
});

test('markError/remove/clear cancel timers and preserve collection invariants', () => {
  const { queue, timers } = harness();
  const first = queue.add(text());
  const second = queue.add(text({ id: 'text-2' }));
  queue.transmit(first.id, { send: () => true });
  queue.transmit(second.id, { send: () => true });
  assert.equal(timers.size, 2);
  assert.equal(queue.markError(first.id, 'nope'), first);
  assert.equal(first.status, 'error');
  assert.equal(first.error, 'nope');
  assert.equal(timers.size, 1);
  assert.equal(queue.remove(first.id), first);
  assert.equal(queue.remove('missing'), null);
  queue.clear();
  assert.equal(queue.size, 0);
  assert.equal(timers.size, 0);
});

test('draftMatches trims the live draft but otherwise preserves exact sent text semantics', () => {
  const item = text({ text: 'hello world' });
  assert.equal(draftMatches(item, '  hello world\n'), true);
  assert.equal(draftMatches(item, 'hello  world'), false);
  assert.equal(draftMatches({ ...item, kind: 'image' }, 'hello world'), false);
  assert.equal(draftMatches(null, 'hello world'), false);
});
