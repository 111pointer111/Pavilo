'use strict';

// 这组断言防的是 v0.5.0 真实发生过的问题：
// client/ 下新增了模块、也写了单元测试，但既没进静态白名单、也没被 index.html 加载，
// 于是"测试全绿"却没有任何代码在使用它。这里把两边的对应关系钉死。

const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { CLIENT_FILES } = require('../src/transport/http');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function scriptSources() {
  return [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
}

test('client asset wiring', async (t) => {
  await t.test('every whitelisted client module is loaded by index.html', () => {
    const loaded = new Set(scriptSources());
    const missing = [...CLIENT_FILES].filter((file) => !loaded.has(file));
    assert.deepEqual(missing, [], `index.html 未加载：${missing.join(', ')}`);
  });

  await t.test('every /client/ script in index.html is served by the whitelist', () => {
    const served = new Set(CLIENT_FILES);
    const unserved = scriptSources()
      .filter((src) => src.startsWith('/client/'))
      .filter((src) => !served.has(src));
    assert.deepEqual(unserved, [], `白名单未包含：${unserved.join(', ')}`);
  });

  await t.test('every whitelisted client module exists on disk', () => {
    const absent = [...CLIENT_FILES].filter((file) => !fs.existsSync(path.join(ROOT, file)));
    assert.deepEqual(absent, [], `文件不存在：${absent.join(', ')}`);
  });

  await t.test('every /client/ script is loaded before app.js', () => {
    const sources = scriptSources().filter((src) => src.startsWith('/client/'));
    const appIndex = sources.indexOf('/client/app.js');
    assert.notEqual(appIndex, -1, 'index.html 必须加载 /client/app.js');
    assert.equal(appIndex, sources.length - 1, `app.js 必须是最后一个客户端脚本，实际顺序：${sources.join(', ')}`);
  });

  await t.test('client modules loaded before overlays.js export what it depends on', () => {
    // overlays.js 在渲染成员列表时调用 PaviloPerformance，因此它必须排在 performance.js 之后。
    const sources = scriptSources();
    const performanceIndex = sources.indexOf('/client/performance.js');
    const overlaysIndex = sources.indexOf('/client/overlays.js');
    assert.notEqual(performanceIndex, -1, 'index.html 必须加载 /client/performance.js');
    assert.ok(performanceIndex < overlaysIndex, 'performance.js 必须先于 overlays.js 加载');
  });
});