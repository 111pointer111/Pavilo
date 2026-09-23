'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function element() {
  return {
    attrs: {},
    children: [],
    textContent: '',
    listeners: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; }
  };
}

function loadChart() {
  const sandbox = {
    document: {
      createElement: element,
      createElementNS: element
    },
    Node: function Node() {}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../admin/chart.js'), 'utf8'), sandbox);
  return sandbox.PaviloAdminChart;
}

function collect(node, acc = []) {
  acc.push(node);
  for (const child of node.children || []) collect(child, acc);
  return acc;
}

function tagged(root, className) {
  return collect(root).filter((node) => (node.getAttribute('class') || '').split(' ').includes(className));
}

function pointsOf(line) {
  return line.getAttribute('points').split(' ').map((pair) => {
    const [x, y] = pair.split(',');
    return { x: Number(x), y: Number(y) };
  });
}

test('foldUsage zero-fills the UTC window and sums channels', () => {
  const { foldUsage } = loadChart();
  const now = Date.parse('2026-09-23T15:00:00.000Z');
  const folded = foldUsage([
    { channelId: 'backup', day: '2026-09-23', requests: 1, promptTokens: 10, completionTokens: 5, errors: 1 },
    { channelId: 'deepseek', day: '2026-09-23', requests: 2, promptTokens: 100, completionTokens: 20, errors: 0 },
    { channelId: 'deepseek', day: '2026-09-16', requests: 9, promptTokens: 9, completionTokens: 0, errors: 0 },
    { channelId: 'deepseek', day: '2026-09-20', requests: 1, promptTokens: 0, completionTokens: 0, errors: 2 }
  ], { days: 7, now });
  assert.equal(folded.days.length, 7);
  assert.equal(folded.days[0].day, '2026-09-17');
  assert.equal(folded.days[0].tokens, 0);
  assert.equal(folded.days[3].day, '2026-09-20');
  assert.equal(folded.days[3].errors, 2);
  assert.equal(folded.days[6].tokens, 135);
  assert.deepEqual(Array.from(folded.days[6].channels, (channel) => channel.id), ['deepseek', 'backup']);
  assert.equal(folded.channels[0].id, 'deepseek');
  assert.equal(folded.channels[0].tokens, 120);
  assert.equal(folded.channels[1].tokens, 15);
});

test('an empty chart is a note, not a blank svg', () => {
  const { createChart } = loadChart();
  const chart = createChart({ categories: [], empty: '没有记录' });
  assert.equal(chart.children.length, 1);
  assert.equal(chart.children[0].className, 'record-empty');
  assert.equal(chart.children[0].textContent, '没有记录');
});

test('a line chart scales from zero, marks failures, and shows a tooltip', () => {
  const { createChart } = loadChart();
  const chart = createChart({
    kind: 'line',
    width: 320,
    height: 120,
    label: '近 7 日 tokens',
    categories: [
      { id: 'a', label: '09-17' },
      { id: 'b', label: '09-18', marker: true },
      { id: 'c', label: '09-19' }
    ],
    series: [{ id: 'tokens', values: [0, 10, 0] }],
    pointLabel: (index) => `点 ${index}`,
    tooltip: (index) => ['09-18', `${index} tokens`, '请求 1 · 失败 0', { text: 'deepseek', value: '10' }]
  });
  const svg = chart.children[0];
  assert.equal(svg.getAttribute('aria-label'), '近 7 日 tokens');
  const points = pointsOf(tagged(svg, 'chart-line')[0]);
  assert.equal(points.length, 3);
  assert.ok(points[1].y < points[0].y);
  assert.equal(points[0].y, points[2].y);
  assert.equal(tagged(svg, 'chart-marker').length, 1);
  assert.deepEqual(tagged(svg, 'chart-tick').map((node) => node.textContent), ['0', '5', '10']);
  const hits = tagged(svg, 'chart-hit');
  assert.equal(hits.length, 3);
  assert.equal(hits[1].getAttribute('aria-label'), '点 1');
  const tip = tagged(svg, 'chart-tip')[0];
  assert.equal(tip.getAttribute('display'), 'none');
  hits[1].listeners.pointerenter[0]();
  assert.equal(tip.getAttribute('display'), null);
  assert.deepEqual(tagged(tip, 'is-soft').map((node) => node.textContent), ['09-18', '请求 1 · 失败 0', 'deepseek', '10']);
  assert.equal(tagged(tip, 'is-soft').find((node) => node.textContent === '10').getAttribute('text-anchor'), 'end');
  assert.equal(tagged(svg, 'chart-dot').find((node) => node.getAttribute('data-index') === '1').getAttribute('class'), 'chart-dot is-active');
  hits[1].listeners.pointerleave[0]();
  assert.equal(tip.getAttribute('display'), 'none');
});

test('an all-zero line stays on the baseline', () => {
  const { createChart } = loadChart();
  const chart = createChart({
    width: 300,
    height: 100,
    yAxis: false,
    categories: [{ id: 'a', label: '09-17' }, { id: 'b', label: '09-18' }, { id: 'c', label: '09-19' }],
    series: [{ id: 'tokens', values: [0, 0, 0] }]
  });
  const svg = chart.children[0];
  const points = pointsOf(tagged(svg, 'chart-line')[0]);
  assert.equal(points[0].y, points[1].y);
  assert.equal(points[1].y, points[2].y);
  assert.equal(tagged(svg, 'chart-tick').length, 0);
});

test('the line curves through each point without rising above a peak', () => {
  const { createChart } = loadChart();
  const chart = createChart({
    width: 300,
    height: 120,
    categories: [
      { id: 'a', label: '09-17' },
      { id: 'b', label: '09-18' },
      { id: 'c', label: '09-19' }
    ],
    series: [{ id: 'tokens', values: [0, 10, 0] }]
  });
  const line = tagged(chart, 'chart-line')[0];
  const anchors = pointsOf(line);
  assert.match(line.getAttribute('d'), / C /);
  assert.match(line.getAttribute('d'), new RegExp(`${anchors[1].x} ${anchors[1].y}`));
  for (const match of line.getAttribute('d').matchAll(/C [\d.]+ ([\d.]+) [\d.]+ ([\d.]+)/g)) {
    assert.ok(Number(match[1]) >= anchors[1].y - 0.05);
    assert.ok(Number(match[2]) >= anchors[1].y - 0.05);
  }
});

test('a narrow line keeps the first, middle, and last day labels', () => {
  const { createChart } = loadChart();
  const categories = Array.from({ length: 7 }, (_, index) => ({ id: String(index), label: `09-${17 + index}` }));
  const chart = createChart({
    width: 220,
    height: 120,
    categories,
    series: [{ id: 'tokens', values: categories.map((_, index) => index) }]
  });
  assert.deepEqual(tagged(chart, 'chart-label').map((node) => node.textContent), ['09-17', '09-20', '09-23']);
});

test('a second track keeps its own scale instead of sharing the token axis', () => {
  const { createChart } = loadChart();
  const categories = [
    { id: 'a', label: '09-17' },
    { id: 'b', label: '09-18' },
    { id: 'c', label: '09-19' }
  ];
  const shared = createChart({
    width: 360,
    height: 120,
    categories,
    series: [
      { id: 'tokens', values: [0, 100, 0] },
      { id: 'requests', values: [0, 50, 0] }
    ]
  });
  const sharedLines = tagged(shared, 'chart-line');
  const token = pointsOf(sharedLines[0]);
  const half = pointsOf(sharedLines[1]);
  assert.ok(half[1].y > token[1].y);
  assert.ok(Math.abs(half[1].y - (token[0].y + token[1].y) / 2) < 0.2);

  const split = createChart({
    width: 360,
    height: 120,
    categories,
    series: [
      { id: 'tokens', label: 'tokens', values: [0, 70, 10] },
      { id: 'requests', label: '请求', values: [0, 1, 2], axis: 'end', mark: 'bar' }
    ]
  });
  const line = pointsOf(tagged(split, 'chart-line')[0]);
  const columns = tagged(split, 'chart-column');
  assert.equal(columns.length, 3);
  const top = (column) => Number(column.getAttribute('y'));
  assert.equal(top(columns[2]), line[1].y);
  assert.ok(top(columns[1]) > line[1].y);
  assert.ok(Number(columns[1].getAttribute('height')) > 0);
  assert.equal(Number(columns[0].getAttribute('height')), 0);
  assert.deepEqual(tagged(split, 'is-end').map((node) => node.textContent), ['0', '1', '2']);
  assert.deepEqual(
    Array.from(split.children[0].children, (node) => node.children[1].textContent),
    ['tokens', '请求']
  );
  assert.equal(split.children[0].children[1].className, 'is-b is-bar');
});

test('bars share a zero baseline and a long channel name is cut', () => {
  const { createChart } = loadChart();
  const id = 'a'.repeat(32);
  const chart = createChart({
    kind: 'bar',
    width: 480,
    categories: [{ id: 'deepseek', label: 'deepseek' }, { id, label: id }],
    series: [{ id: 'tokens', values: [100, 25] }],
    tooltip: () => ['deepseek', '100 tokens']
  });
  const bars = tagged(chart, 'chart-bar');
  assert.equal(bars.length, 2);
  assert.equal(bars[0].getAttribute('x'), bars[1].getAttribute('x'));
  assert.ok(Number(bars[0].getAttribute('width')) > Number(bars[1].getAttribute('width')) * 3);
  const labels = tagged(chart, 'chart-bar-label').map((node) => node.textContent);
  assert.equal(labels[0], 'deepseek');
  assert.ok(labels[1].endsWith('…'));
  assert.ok(labels[1].length < id.length);
});
