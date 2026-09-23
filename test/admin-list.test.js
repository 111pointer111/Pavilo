'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function element(tag) {
  return {
    tag,
    className: '',
    classList: {
      classes: [],
      add(name) { this.classes.push(name); }
    },
    dataset: {},
    scope: '',
    textContent: '',
    children: [],
    append(...nodes) { this.children.push(...nodes); }
  };
}

function loadList() {
  const sandbox = {
    document: { createElement: element },
    Node: function Node() {}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../admin/list.js'), 'utf8'), sandbox);
  return sandbox.PaviloAdminList;
}

test('record list renders column headers, cells, and a trailing action', () => {
  const { createRecordList } = loadList();
  const action = element('button');
  action.textContent = '移除';
  const list = createRecordList({
    columns: [
      { id: 'when', label: '时间', className: 'record-when' },
      { id: 'body', label: '内容', align: 'end' }
    ],
    rows: [{ cells: { when: '10:00', body: '亭里的一句话' }, muted: true }],
    actions: () => action
  });
  const table = list.children[0];
  const head = table.children[0].children[0];
  assert.deepEqual(head.children.map((cell) => cell.textContent), ['时间', '内容', '']);
  assert.ok(head.children[1].classList.classes.includes('num'));
  const row = table.children[1].children[0];
  assert.ok(row.classList.classes.includes('is-muted'));
  assert.equal(row.children[0].textContent, '10:00');
  assert.equal(row.children[0].dataset.cell, 'when');
  assert.equal(row.children[1].textContent, '亭里的一句话');
  assert.equal(row.children[2].children[0], action);
});

test('an empty record list is a single note, not a blank table', () => {
  const { createRecordList } = loadList();
  const list = createRecordList({ columns: [{ id: 'body', label: '内容' }], rows: [], empty: '没有发言' });
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].className, 'record-empty');
  assert.equal(list.children[0].textContent, '没有发言');
});
