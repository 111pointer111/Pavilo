'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { smartUpdate, shouldRebuildList } = require('../client/performance');

// 计数用的最小元素替身：记录每次属性写入，用于断言"没有变化就不写"。
function makeElement(initial = {}) {
  const writes = [];
  const element = {
    writes,
    dataset: {},
    getAttribute: () => null,
  };
  for (const [key, value] of Object.entries(initial)) element[key] = value;
  for (const key of ['textContent', 'innerHTML', 'className', 'hidden', 'disabled', 'title']) {
    let current = element[key];
    Object.defineProperty(element, key, {
      get: () => current,
      set: (value) => { writes.push([key, value]); current = value; },
    });
  }
  return element;
}

test('smartUpdate writes a property when it differs', () => {
  const element = makeElement({ textContent: 'old' });
  smartUpdate(element, { textContent: 'new' });
  assert.equal(element.textContent, 'new');
  assert.deepEqual(element.writes, [['textContent', 'new']]);
});

test('smartUpdate skips writing a property that already matches', () => {
  const element = makeElement({ textContent: 'same', className: 'channel-meta' });
  smartUpdate(element, { textContent: 'same', className: 'channel-meta' });
  assert.deepEqual(element.writes, []);
});

test('smartUpdate updates only the changed keys of a mixed update', () => {
  const element = makeElement({ innerHTML: '<b>1</b>', className: 'channel-meta', title: '1 人在线' });
  smartUpdate(element, { innerHTML: '<b>2</b>', className: 'channel-meta', title: '1 人在线' });
  assert.deepEqual(element.writes, [['innerHTML', '<b>2</b>']]);
});

test('smartUpdate routes data- keys through dataset', () => {
  const element = makeElement();
  smartUpdate(element, { 'data-state': 'busy' });
  assert.equal(element.dataset.state, 'busy');
  assert.deepEqual(element.writes, []);
});

test('smartUpdate ignores a missing element instead of throwing', () => {
  assert.doesNotThrow(() => smartUpdate(null, { textContent: 'x' }));
  assert.doesNotThrow(() => smartUpdate(undefined, { textContent: 'x' }));
  assert.doesNotThrow(() => smartUpdate(makeElement(), null));
});

test('smartUpdate falls back to plain property comparison for unknown keys', () => {
  const element = makeElement({ title: 'a' });
  smartUpdate(element, { title: 'b' });
  assert.deepEqual(element.writes, [['title', 'b']]);
});

const users = [{ id: 'u1', username: 'A' }, { id: 'u2', username: 'B' }];
const userKey = (user) => `${user.id}:${user.username}`;

test('shouldRebuildList treats a missing side as needing a rebuild', () => {
  assert.equal(shouldRebuildList(null, users), true);
  assert.equal(shouldRebuildList(users, null), true);
  assert.equal(shouldRebuildList(null, null), true);
});

test('shouldRebuildList keeps the list when keys and order match', () => {
  const next = [{ id: 'u1', username: 'A' }, { id: 'u2', username: 'B' }];
  assert.equal(shouldRebuildList(users, next, userKey), false);
});

test('shouldRebuildList rebuilds when the length changes', () => {
  assert.equal(shouldRebuildList(users, [users[0]]), true);
});

test('shouldRebuildList rebuilds when the order changes', () => {
  assert.equal(shouldRebuildList(users, [users[1], users[0]]), true);
});

test('shouldRebuildList rebuilds when a key changes without a length change', () => {
  const renamed = [{ id: 'u1', username: 'A2' }, { id: 'u2', username: 'B' }];
  assert.equal(shouldRebuildList(users, renamed, userKey), true);
});

test('shouldRebuildList defaults to comparing by id', () => {
  assert.equal(shouldRebuildList(users, [{ id: 'u1' }, { id: 'u2' }]), false);
  assert.equal(shouldRebuildList(users, [{ id: 'u3' }, { id: 'u2' }]), true);
});