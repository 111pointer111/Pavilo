'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const mentions = require('../client/mentions');

const users = [
  { id: 'alice', username: 'Alice' },
  { id: 'bob', username: 'Bob' },
  { id: 'carol', username: 'Carol Smith' },
];

test('mention helpers only trigger after whitespace and filter deterministically', () => {
  assert.deepEqual(mentions.triggerAtCursor('hello @Bo', 9), { start: 6, end: 9, query: 'Bo' });
  assert.equal(mentions.triggerAtCursor('email@Bob', 9), null);
  assert.deepEqual(mentions.filterUsers(users, 's').map((user) => user.id), ['carol']);
  assert.deepEqual(mentions.filterUsers(users, '').map((user) => user.id), ['alice', 'bob', 'carol']);
});

test('mention ranges require an authoritative selected member and safe boundaries', () => {
  assert.deepEqual(mentions.mentionRanges('@Bob, @Carol Smith!', [{ id: 'bob', username: 'Bob' }, { id: 'carol', username: 'Carol Smith' }]), [
    { id: 'bob', username: 'Bob', start: 0, end: 4 },
    { id: 'carol', username: 'Carol Smith', start: 6, end: 18 },
  ]);
  assert.deepEqual(mentions.mentionRanges('@Bobber @Bob', [{ id: 'bob', username: 'Bob' }]).map(({ username }) => username), ['Bob']);
  const html = mentions.renderMentionText('@<Bob>', [{ id: 'bob', username: '<Bob>' }]);
  assert.match(html, /class="message-mention"/);
  assert.match(html, /&lt;Bob&gt;/);
  assert.doesNotMatch(html, /<Bob>/);
});

test('reconcile marks removes edited mention tokens and shifts later marks', () => {
  const marks = [{ id: 'bob', username: 'Bob', start: 0, end: 4 }, { id: 'carol', username: 'Carol Smith', start: 5, end: 17 }];
  assert.deepEqual(mentions.reconcileMarks('@Bob @Carol Smith', '@Bobby @Carol Smith', marks), [
    { id: 'carol', username: 'Carol Smith', start: 7, end: 19 },
  ]);
});
