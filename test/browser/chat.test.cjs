'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const TIMEOUT = 15_000;
const MAX_MESSAGES = 20;
const MAX_TEXT_LENGTH = 120;

function loadPlaywright() {
  try {
    return require(process.env.PAVILO_PLAYWRIGHT_PATH || 'playwright');
  } catch (cause) {
    throw new Error('Browser tests need Playwright and Google Chrome. Set PAVILO_PLAYWRIGHT_PATH to an installed playwright package (no production dependency is required).', { cause });
  }
}

// Load the real YAML and server entry point in an isolated process, but request an
// ephemeral loopback port after validation rather than reserving a guessed port.
const SERVER_BOOT = `
  const { loadConfig } = require(process.env.PAVILO_ROOT + '/config.js');
  const { createChatServer } = require(process.env.PAVILO_ROOT + '/server.js');
  const app = createChatServer(loadConfig({ env: { PAVILO_CONFIG: process.env.PAVILO_CONFIG } }).config);
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    try { await app.stop(); process.exit(0); }
    catch (error) { process.stderr.write(error.stack + '\\n'); process.exit(1); }
  }
  process.on('message', (message) => { if (message === 'stop') stop(); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('disconnect', stop);
  app.listen(Number(process.env.PAVILO_TEST_PORT || 0), '127.0.0.1')
    .then((address) => process.send({ port: address.port }))
    .catch((error) => { console.error(error); process.exit(1); });
`;

async function startServer(configPath, port = 0) {
  const child = spawn(process.execPath, ['-e', SERVER_BOOT], {
    cwd: ROOT,
    env: { ...process.env, PAVILO_ROOT: ROOT, PAVILO_CONFIG: configPath, PAVILO_TEST_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { output = (output + chunk).slice(-16_384); });
  }
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ error: error.message }));
  });
  async function stop() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try {
      if (child.connected) {
        try { child.send('stop'); } catch { child.kill('SIGTERM'); }
      } else child.kill('SIGTERM');
      const result = await exited;
      assert.equal(result.code, 0, `Owned server did not stop gracefully: ${JSON.stringify(result)}\n${output}`);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Server startup timed out\n${output}`)), TIMEOUT);
      const onMessage = (message) => {
        if (Number.isInteger(message?.port)) finish(null, message);
      };
      const onExit = (code, signal) => finish(new Error(`Server exited before listening (${code || signal})\n${output}`));
      const onError = (error) => finish(error);
      function finish(error, value) {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('exit', onExit);
        child.off('error', onError);
        if (error) reject(error);
        else resolve(value);
      }
      child.on('message', onMessage);
      child.once('exit', onExit);
      child.once('error', onError);
    });
    return { child, stop, port: address.port, baseUrl: `http://127.0.0.1:${address.port}` };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}

function trackSockets() {
  const NativeWebSocket = window.WebSocket;
  const trace = { sockets: [], received: [], sent: [] };
  window.__paviloBrowserTest = trace;
  window.WebSocket = class extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      trace.sockets.push(this);
      this.addEventListener('message', (event) => {
        try { trace.received.push(JSON.parse(event.data)); } catch {}
      });
    }
    send(data) {
      try {
        const command = JSON.parse(data);
        trace.sent.push(command);
        if (trace.rejectNextMessage && command.type === 'message') {
          trace.rejectNextMessage = false;
          return super.send(JSON.stringify({ ...command, kind: 'unsupported' }));
        }
      } catch {}
      return super.send(data);
    }
  };
}

async function ready(page, channelId) {
  await page.waitForFunction((expected) => {
    const trace = window.__paviloBrowserTest;
    const socket = trace.sockets.at(-1);
    const stateIndex = trace.received.findLastIndex((event) => event.type === 'stateStart' && event.channelId === expected);
    const state = trace.received[stateIndex];
    const ended = trace.received.slice(stateIndex + 1).some((event) => event.type === 'historyEnd' && event.roomEpoch === state?.roomEpoch);
    return Boolean(stateIndex >= 0 && state?.channelId === expected && ended
      && socket && socket.readyState === WebSocket.OPEN
      && document.querySelector('#connectionText').textContent === '已连接'
      && !document.querySelector('#connectionDot').classList.contains('offline')
      && !document.querySelector('#appShell').hidden
      && document.querySelector('#loginScreen').hidden
      && !document.querySelector('#composerText').disabled
      && !document.querySelector('#mobileChannelPicker').disabled);
  }, channelId);
}

async function login(page, baseUrl, name) {
  const blockedHidden = [];
  const onConsole = (msg) => {
    if (String(msg.text()).includes('Blocked aria-hidden')) blockedHidden.push(msg.text());
  };
  page.on('console', onConsole);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#usernameInput').fill(name);
    await page.waitForFunction(() => !document.querySelector('#loginForm .enter-button').disabled);
    // The room's supported login interaction is form submission, not a synthetic click.
    await page.locator('#usernameInput').press('Enter');
    await ready(page, 'projects');
  } finally {
    page.off('console', onConsole);
  }
  assert.equal(blockedHidden.length, 0, blockedHidden.join('\n'));
}

async function switchChannel(page, channelId) {
  const picker = page.locator('#mobileChannelPicker');
  if (await picker.isVisible()) await picker.selectOption(channelId);
  else await page.locator('#channelList .channel').filter({ hasText: `· ${channelId}` }).click();
  await ready(page, channelId);
}

async function canonical(page, text) {
  await page.waitForFunction((expected) => {
    const messages = [...document.querySelectorAll('#messageList .message[data-message-id]')];
    return messages.filter((node) => node.querySelector('.message-body')?.textContent === expected).length === 1
      && !document.querySelector('#messageList .pending-message');
  }, text);
}

async function sendText(page, text, receivers = []) {
  await page.locator('#composerText').fill(text);
  await page.locator('#composerText').press('Enter');
  await Promise.all([page, ...receivers].map((receiver) => canonical(receiver, text.trim())));
}

async function identity(page) {
  return page.evaluate(() => window.__paviloBrowserTest.received.filter((event) => event.type === 'stateStart').at(-1).self);
}

async function frames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function readingAnchor(page) {
  return page.locator('#messageScroll').evaluate((scroll) => {
    const bounds = scroll.getBoundingClientRect();
    const node = [...scroll.querySelectorAll('.message[data-message-id]')]
      .find((item) => item.getBoundingClientRect().bottom > bounds.top + 1);
    if (!node) throw new Error('No visible message anchor');
    return { id: node.dataset.messageId, top: node.getBoundingClientRect().top - bounds.top };
  });
}

async function assertAnchor(page, anchor) {
  await frames(page);
  const offset = await page.locator(`[data-message-id="${anchor.id}"].message`).evaluate((node) => (
    node.getBoundingClientRect().top - document.querySelector('#messageScroll').getBoundingClientRect().top
  ));
  assert.ok(Math.abs(offset - anchor.top) <= 2, `Reading anchor drifted ${offset - anchor.top}px`);
}

test('browser contracts survive module extraction', { timeout: 180_000 }, async (t) => {
  const { chromium } = loadPlaywright();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pavilo-browser-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'private-room.yaml');
  await writeFile(configPath, `version: 1
server:
  host: 127.0.0.1
room:
  title: Browser contract room
  defaultChannel: projects
  exposeMemberIps: false
  exposeLanUrls: false
channels:
  - id: projects
    name: Projects
    description: Shared browser contracts
  - id: solo
    name: Solo
    maxUsers: 1
  - id: disabled
    name: Disabled
    enabled: false
limits:
  maxMessagesPerChannel: ${MAX_MESSAGES}
  maxTextLength: ${MAX_TEXT_LENGTH}
rateLimits:
  messages: 1000
  typing: 1000
`);
  let server = await startServer(configPath);
  t.after(() => server.stop());
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  let priorFailure = false;
  async function contract(name, callback) {
    await t.test(name, { skip: priorFailure ? 'An earlier browser contract failed' : false }, async () => {
      try { await callback(); }
      catch (error) { priorFailure = true; throw error; }
    });
  }
  const failures = [];
  const pages = [];
  async function newPage(options) {
    const context = await browser.newContext(options);
    context.setDefaultTimeout(TIMEOUT);
    await context.addInitScript(trackSockets);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== server.baseUrl && !['data:', 'blob:'].includes(url.protocol)) {
        failures.push(`External request: ${url.href}`);
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(`Page error: ${error.stack || error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on('requestfailed', (request) => {
      // Reloading cancels the picker's in-flight dataset fetch; it is not a
      // missing module. Keep every other asset/network failure observable.
      const cancelledDataset = new URL(request.url()).pathname === '/vendor/emoji-picker/data.json'
        && request.failure()?.errorText === 'net::ERR_ABORTED';
      // During the graceful stop test, /healthz may fail if the server is stopping
      const healthCheckDuringStop = new URL(request.url()).pathname === '/healthz'
        && request.failure()?.errorText === 'net::ERR_ABORTED';
      if (request.resourceType() !== 'websocket' && !cancelledDataset && !healthCheckDuringStop) {
        failures.push(`Failed request: ${request.url()} (${request.failure()?.errorText})`);
      }
    });
    page.on('websocket', (socket) => {
      const url = new URL(socket.url());
      if (url.host !== new URL(server.baseUrl).host) failures.push(`External WebSocket: ${url.href}`);
    });
    pages.push(page);
    return page;
  }
  t.after(() => assert.deepEqual(failures, [], 'Browser must not produce page errors, failed assets, or external requests'));
  const alice = await newPage({ viewport: { width: 1440, height: 900 } });
  const bob = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  await contract('GET and HEAD expose only explicit public files', async () => {
    const fixturePaths = ['/server.js', '/config.js', '/package.json', '/package-lock.json', '/pavilo.yaml', '/pavilo.example.yaml', '/private-room.yaml', '/src/core/index.js', '/src/transport/http.js', '/client/not-public.js', '/client/../server.js', '/test/browser/chat.test.cjs', '/docs/IMPLEMENTATION-PLAN.md', '/.git/config', '/node_modules/yaml/package.json'];
    for (const pathname of fixturePaths) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${server.baseUrl}${pathname}`, { method });
        assert.equal(response.status, 404, `${method} ${pathname} must stay private`);
        if (method === 'HEAD') assert.equal(await response.text(), '');
        else await response.text();
      }
    }
    const metadata = await fetch(`${server.baseUrl}/room-info`).then((response) => response.json());
    assert.equal(metadata.defaultChannelId, 'projects');
    assert.equal(metadata.limits.maxTextLength, MAX_TEXT_LENGTH);
    assert.deepEqual(metadata.lanUrls, []);
  });

  await contract('two Enter logins adopt custom limits and a non-general default', async () => {
    await login(alice, server.baseUrl, 'Browser Alice');
    await login(bob, server.baseUrl, 'Browser Bob');
    assert.equal(await alice.title(), 'Pavilo / 语亭');
    assert.match(await alice.locator('#roomTitle').textContent(), /Browser contract room/);
    for (const page of pages) {
      await page.waitForFunction(() => document.querySelector('#peopleCount').textContent === '2 在线');
      await page.waitForFunction(() => document.querySelector('[data-channel-id="projects"] .channel-meta-value').textContent.replace(/\s/g, '') === '2/64');
      assert.equal(await page.locator('#roomHeading').textContent(), 'Projects · projects');
      assert.equal(await page.locator('#channelDescription').textContent(), 'Shared browser contracts');
      assert.equal(Object.hasOwn(await identity(page), 'ip'), false);
      assert.equal(await page.locator('#composerText').getAttribute('maxlength'), String(MAX_TEXT_LENGTH));
      assert.equal(await page.locator('#channelList .channel').filter({ hasText: '· disabled' }).isDisabled(), true);
      assert.equal(await page.locator('#mobileChannelPicker option[value="disabled"]').isDisabled(), true);
    }
    await sendText(alice, '  canonical hello  ', [bob]);
    assert.equal(await alice.locator('#messageList .pending-message').count(), 0);
    const text = 'L'.repeat(MAX_TEXT_LENGTH);
    await alice.locator('#composerText').fill('L'.repeat(MAX_TEXT_LENGTH + 25));
    assert.equal((await alice.locator('#composerText').inputValue()).length, MAX_TEXT_LENGTH);
    await alice.locator('#composerText').press('Enter');
    await Promise.all(pages.map((page) => canonical(page, text)));
  });

  await contract('text sends receive ACKs and canonical echoes without randomUUID or Web Crypto', async () => {
    for (const mode of ['no-randomUUID', 'no-crypto']) {
      await alice.evaluate((mode) => {
        const crypto = globalThis.crypto;
        window.__paviloBrowserTest.cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: mode === 'no-randomUUID'
          ? { getRandomValues: crypto.getRandomValues.bind(crypto) } : undefined });
      }, mode);
      try {
        assert.equal(await alice.evaluate(() => typeof globalThis.crypto?.randomUUID), 'undefined');
        assert.equal(await alice.evaluate(() => typeof globalThis.crypto?.getRandomValues),
          mode === 'no-randomUUID' ? 'function' : 'undefined');
        const ids = [];
        for (let index = 0; index < 2; index += 1) {
          const text = `${mode} send ${index}`;
          await sendText(alice, text, [bob]);
          const id = await alice.evaluate((text) => window.__paviloBrowserTest.sent
            .findLast((event) => event.type === 'message' && event.text === text).clientMessageId, text);
          assert.match(id, /^[A-Za-z0-9_-]{8,96}$/);
          if (mode === 'no-randomUUID') assert.match(id, /^cm_[0-9a-f]{32}$/);
          assert.equal(await alice.evaluate((id) => window.__paviloBrowserTest.received
            .some((event) => event.type === 'ack' && event.clientMessageId === id), id), true);
          assert.equal(await bob.evaluate((id) => window.__paviloBrowserTest.received
            .some((event) => event.type === 'message' && event.message.clientMessageId === id), id), true);
          assert.equal(await alice.locator('#composerText').inputValue(), '');
          ids.push(id);
        }
        assert.equal(new Set(ids).size, ids.length);
      } finally {
        await alice.evaluate(() => {
          Object.defineProperty(globalThis, 'crypto', window.__paviloBrowserTest.cryptoDescriptor);
          delete window.__paviloBrowserTest.cryptoDescriptor;
        });
      }
    }
  });

  await contract('channel isolation and a full-channel failure preserve the source state', async () => {
    await switchChannel(bob, 'solo');
    await sendText(bob, 'solo secret');
    for (const page of pages) await page.waitForFunction(() => document.querySelector('#peopleCount').textContent === '1 在线');
    assert.equal(await alice.locator('#peopleList').textContent().then((text) => text.includes('Browser Bob')), false);
    assert.equal(await bob.locator('#peopleList').textContent().then((text) => text.includes('Browser Alice')), false);
    assert.equal(await alice.locator('.message-body').filter({ hasText: 'solo secret' }).count(), 0);
    const before = await identity(alice);
    const existing = await alice.locator('#messageList .message[data-message-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId));
    const errors = await alice.evaluate(() => window.__paviloBrowserTest.received.filter((event) => event.type === 'error').length);
    await alice.locator('#channelList .channel').filter({ hasText: '· solo' }).click();
    await alice.waitForFunction((count) => window.__paviloBrowserTest.received.filter((event) => event.type === 'error').length > count, errors);
    assert.equal(await alice.locator('#channelList .channel').filter({ hasText: '· projects' }).getAttribute('aria-current'), 'page');
    assert.equal(await alice.locator('#roomHeading').textContent(), 'Projects · projects');
    await ready(alice, 'projects');
    assert.equal(await alice.evaluate(() => window.__paviloBrowserTest.received.filter((event) => event.type === 'error').at(-1).code), 'CHANNEL_FULL');
    assert.deepEqual(await identity(alice), before);
    assert.deepEqual(await alice.locator('#messageList .message[data-message-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId)), existing);
    await sendText(alice, 'source survives failed switch');
    assert.equal(await bob.locator('.message-body').filter({ hasText: 'source survives failed switch' }).count(), 0);
  });

  await contract('refresh retains identity, selected channel, and canonical history', async () => {
    const before = await identity(bob);
    await bob.reload({ waitUntil: 'domcontentloaded' });
    await ready(bob, 'solo');
    assert.deepEqual(await identity(bob), before);
    await canonical(bob, 'solo secret');
    assert.equal(await bob.evaluate(() => sessionStorage.getItem('pavilo.channel')), 'solo');
    await switchChannel(bob, 'projects');
    await canonical(bob, 'canonical hello');
    assert.equal(await bob.locator('.message-body').filter({ hasText: 'solo secret' }).count(), 0);
  });

  await contract('transient socket loss reconnects without changing identity or duplicating messages', async () => {
    const before = await identity(alice);
    const count = await alice.evaluate(() => window.__paviloBrowserTest.sockets.length);
    await alice.locator('#composerText').fill('draft survives reconnect');
    await alice.evaluate(() => {
      const socket = window.__paviloBrowserTest.sockets.findLast((item) => item.readyState === WebSocket.OPEN);
      if (!socket) throw new Error('No live socket to drop');
      socket.close(4001, 'browser test transient drop');
    });
    await alice.waitForFunction((previous) => window.__paviloBrowserTest.sockets.length > previous, count);
    await ready(alice, 'projects');
    assert.deepEqual(await identity(alice), before);
    assert.equal(await alice.locator('#composerText').inputValue(), 'draft survives reconnect');
    await alice.locator('#composerText').press('Enter');
    await Promise.all(pages.map((page) => canonical(page, 'draft survives reconnect')));
    await canonical(alice, 'canonical hello');
  });

  await contract('correlated failure preserves the draft and manual retry reuses its ID', async () => {
    const text = 'retry after server validation';
    await alice.evaluate(() => { window.__paviloBrowserTest.rejectNextMessage = true; });
    await alice.locator('#composerText').fill(text);
    await alice.locator('#composerText').press('Enter');
    await alice.waitForFunction(() => document.querySelector('.pending-retry'));
    const pendingId = await alice.locator('.pending-retry').getAttribute('data-pending-id');
    assert.equal(await alice.locator('#composerText').inputValue(), text);
    await alice.locator('.pending-retry').click();
    await Promise.all(pages.map((page) => canonical(page, text)));
    const submittedIds = await alice.evaluate((expected) => window.__paviloBrowserTest.sent
      .filter((event) => event.type === 'message' && event.text === expected).map((event) => event.clientMessageId), text);
    assert.deepEqual(submittedIds.slice(-2), [pendingId, pendingId]);
    assert.equal(await alice.locator('#composerText').inputValue(), '');
  });

  await contract('IME Enter and keyCode 229 do not prematurely submit', async () => {
    await alice.locator('#composerText').fill('输入法确认之后发送');
    const before = await alice.evaluate(() => window.__paviloBrowserTest.sent.filter((event) => event.type === 'message').length);
    const results = await alice.locator('#composerText').evaluate((input) => {
      const composing = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      const legacy = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true });
      input.dispatchEvent(composing);
      input.dispatchEvent(legacy);
      return [composing.defaultPrevented, legacy.defaultPrevented];
    });
    assert.deepEqual(results, [false, false]);
    assert.equal(await alice.evaluate(() => window.__paviloBrowserTest.sent.filter((event) => event.type === 'message').length), before);
    assert.equal(await alice.locator('#composerText').inputValue(), '输入法确认之后发送');
    await alice.locator('#composerText').press('Enter');
    await Promise.all(pages.map((page) => canonical(page, '输入法确认之后发送')));
  });

  await contract('canvas image upload is canonical and viewer zoom, rotation, Escape restore focus', async () => {
    const source = await alice.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 4000;
      canvas.height = 3000;
      const context = canvas.getContext('2d');
      context.fillStyle = '#0f7772';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#f4c85f';
      context.fillRect(400, 200, 900, 400);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await alice.locator('#imageInput').setInputFiles({ name: 'canvas-contract.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64') });
    await alice.waitForFunction(() => {
      const bar = document.querySelector('#composerAttach');
      return bar && !bar.hidden && !bar.classList.contains('is-preparing') && !document.querySelector('.pending-message');
    });
    assert.equal(await alice.locator('.message[data-message-id] .message-image-link').count(), 0);
    await alice.locator('#composerAttachThumb').click();
    await alice.waitForFunction(() => !document.querySelector('#imageViewer').hidden && document.querySelector('#viewerDownload').hidden);
    await alice.keyboard.press('Escape');
    await alice.waitForFunction(() => document.querySelector('#imageViewer').hidden);
    await alice.locator('#sendButton').click();
    for (const page of pages) {
      await page.waitForFunction(() => document.querySelectorAll('.message[data-message-id] .message-image-link').length === 1 && !document.querySelector('.pending-message'));
    }
    const image = await alice.evaluate(() => window.__paviloBrowserTest.received.filter((event) => event.type === 'message' && event.message.kind === 'image').at(-1).message.image);
    assert.equal(image.width, 1600);
    assert.equal(image.height, 1200);
    assert.ok(image.bytes > 0 && image.bytes <= 300_000);
    assert.equal(await alice.locator('.message-image-link').getAttribute('data-viewer-message-id'), await bob.locator('.message-image-link').getAttribute('data-viewer-message-id'));
    const opener = alice.locator('.message-image-link');
    await opener.click();
    await alice.waitForFunction(() => !document.querySelector('#imageViewer').hidden && document.querySelector('#viewerImage').dataset.loaded === 'true');
    const initialZoom = Number.parseInt(await alice.locator('#viewerZoomLabel').textContent(), 10);
    await alice.locator('#viewerZoomIn').click();
    assert.ok(Number.parseInt(await alice.locator('#viewerZoomLabel').textContent(), 10) > initialZoom);
    await alice.locator('#viewerRotate').click();
    assert.match(await alice.locator('#viewerImage').getAttribute('style'), /rotate\(90deg\)/);
    await alice.screenshot({ path: path.join(directory, 'image-viewer.png') });
    await alice.keyboard.press('Escape');
    await alice.waitForFunction(() => document.querySelector('#imageViewer').hidden);
    assert.equal(await opener.evaluate((node) => node === document.activeElement), true);
  });

  await contract('staged image plus caption become one canonical bubble', async () => {
    const source = await alice.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 24;
      const context = canvas.getContext('2d');
      context.fillStyle = '#e86f57';
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await alice.locator('#imageInput').setInputFiles({ name: 'caption.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64') });
    await alice.waitForFunction(() => {
      const bar = document.querySelector('#composerAttach');
      return bar && !bar.hidden && !bar.classList.contains('is-preparing') && !document.querySelector('#sendButton').disabled;
    });
    await alice.locator('#composerText').fill('看这个');
    await alice.locator('#sendButton').click();
    for (const page of pages) {
      await page.waitForFunction(() => [...document.querySelectorAll('.message[data-message-id]')].some((article) => (
        article.querySelector('.message-image-link') && article.querySelector('.message-body')?.textContent.includes('看这个')
      )) && !document.querySelector('.pending-message'));
    }
    const count = await alice.locator('#messageList .message[data-message-id]').count();
    const last = alice.locator('#messageList .message[data-message-id]').nth(count - 1);
    assert.equal(await last.locator('.message-image-link').count(), 1);
    assert.equal(await last.locator('.message-body').textContent(), '看这个');
  });

  await contract('append and capacity eviction preserve a scrolled-up message anchor', async () => {
    let count = await alice.locator('#messageList .message[data-message-id]').count();
    while (count < MAX_MESSAGES - 2) {
      await sendText(bob, `scroll seed ${String(count).padStart(2, '0')}\nline two\nline three`, [alice]);
      count += 1;
    }
    await alice.locator('#messageScroll').evaluate((scroll) => {
      scroll.style.scrollBehavior = 'auto';
      assertOverflow();
      scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * .5;
      function assertOverflow() {
        if (scroll.scrollHeight <= scroll.clientHeight + 200) throw new Error('Scroll fixture does not overflow enough');
      }
    });
    await frames(alice);
    const anchor = await readingAnchor(alice);
    const first = await alice.locator('#messageList .message[data-message-id]').first().getAttribute('data-message-id');
    await sendText(bob, 'append while Alice reads history', [alice]);
    await assertAnchor(alice, anchor);
    await sendText(bob, 'fill channel capacity', [alice]);
    await assertAnchor(alice, anchor);
    await sendText(bob, 'evict oldest while Alice reads history', [alice]);
    assert.equal(await alice.locator('#messageList .message[data-message-id]').count(), MAX_MESSAGES);
    assert.equal(await alice.locator(`.message[data-message-id="${first}"]`).count(), 0);
    await assertAnchor(alice, anchor);
    assert.equal(await alice.locator('#newMessageJump').isVisible(), true);
    await alice.locator('#newMessageJump').click();
    await alice.waitForFunction(() => {
      const scroll = document.querySelector('#messageScroll');
      return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 2;
    });
  });

  await contract('mention picker selects a roster member and highlights only confirmed tokens', async () => {
    await alice.locator('#composerText').fill('ping');
    await alice.locator('#mentionButton').click();
    await alice.waitForFunction(() => !document.querySelector('#mentionPopover').hidden);
    assert.equal(await alice.locator('#composerText').inputValue(), 'ping @');
    assert.equal(await alice.locator('#composerText').getAttribute('aria-expanded'), 'true');
    await alice.locator('#composerText').pressSequentially('Bob');
    await alice.waitForFunction(() => document.querySelector('#mentionList .mention-option-name')?.textContent === 'Browser Bob'
      && document.querySelectorAll('#mentionList .mention-option').length === 1);
    await alice.locator('#composerText').press('Enter');
    await alice.waitForFunction(() => document.querySelector('#mentionPopover').hidden);
    assert.equal(await alice.locator('#composerText').inputValue(), 'ping @Browser Bob ');
    await alice.locator('#composerText').pressSequentially('hi');
    await alice.locator('#composerText').press('Enter');
    await Promise.all(pages.map((page, index) => page.waitForFunction(() => {
      const body = [...document.querySelectorAll('#messageList .message-body')].at(-1);
      return body?.textContent === 'ping @Browser Bob hi' && body.querySelectorAll('.message-mention').length === 1;
    }).catch((error) => {
      throw new Error(`${index === 0 ? 'Alice' : 'Bob'} never rendered the mention: ${error.message}`);
    })));
    const sentCommand = await alice.evaluate(() => window.__paviloBrowserTest.sent
      .filter((c) => c.type === 'message' && c.text?.includes('@Browser Bob')).at(-1));
    assert.ok(sentCommand, 'mention command was sent');
    assert.equal(sentCommand.mentions.length, 1);
    assert.equal(typeof sentCommand.mentions[0], 'string');
    await alice.waitForFunction((clientMessageId) => {
      return window.__paviloBrowserTest.received
        .some((e) => e.type === 'message' && e.message?.clientMessageId === clientMessageId);
    }, sentCommand.clientMessageId);
    const receivedMessage = await alice.evaluate((clientMessageId) => {
      const event = window.__paviloBrowserTest.received
        .find((e) => e.type === 'message' && e.message?.clientMessageId === clientMessageId);
      return event?.message;
    }, sentCommand.clientMessageId);
    assert.ok(receivedMessage, `message echo with clientMessageId ${sentCommand.clientMessageId} was received`);
    assert.ok(receivedMessage.mentions);
    assert.equal(receivedMessage.mentions.length, 1);
    assert.equal(receivedMessage.mentions[0].username, 'Browser Bob');
    const mentionNode = alice.locator('#messageList .message-body').filter({ hasText: 'ping @Browser Bob hi' }).locator('.message-mention');
    assert.equal(await mentionNode.count(), 1);
    assert.equal(await mentionNode.evaluate((node) => node.dataset.userId), receivedMessage.mentions[0].id);
    await mentionNode.hover();
    await alice.screenshot({ path: path.join(directory, 'mentions.png') });
    await mentionNode.click();
    await alice.waitForFunction(() => document.querySelector('#profileName')?.textContent === 'Browser Bob');
    assert.equal(await mentionNode.getAttribute('aria-label'), '提及 Browser Bob');
  });

  await contract('hand-typed mention text stays plain and picker edits degrade safely', async () => {
    await sendText(alice, '@Browser Bob typed by hand');
    assert.equal(await alice.evaluate(() => window.__paviloBrowserTest.sent
      .filter((command) => command.type === 'message' && command.text === '@Browser Bob typed by hand').at(-1).mentions), undefined);
    await bob.waitForFunction(() => {
      const body = [...document.querySelectorAll('#messageList .message-body')].at(-1);
      return body.textContent === '@Browser Bob typed by hand' && body.querySelectorAll('.message-mention').length === 0;
    });
    await alice.locator('#mentionButton').click();
    await alice.locator('#composerText').pressSequentially('B');
    await alice.waitForFunction(() => !document.querySelector('#mentionPopover').hidden);
    await alice.locator('#composerText').press('Escape');
    await alice.waitForFunction(() => document.querySelector('#mentionPopover').hidden);
    assert.equal(await alice.locator('#composerText').getAttribute('aria-expanded'), 'false');
    await alice.locator('#composerText').press('Backspace');
    assert.equal(await alice.locator('#composerText').inputValue(), '@');
  });

  await contract('mobile mention picker stays inside a keyboard-sized viewport', async () => {
    await bob.locator('#composerText').focus();
    await bob.setViewportSize({ width: 390, height: 430 });
    await bob.locator('#mentionButton').click();
    await bob.waitForFunction(() => !document.querySelector('#mentionPopover').hidden);
    await frames(bob);
    const bounds = await bob.locator('#mentionPopover').evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: window.innerWidth, height: window.innerHeight };
    });
    assert.ok(bounds.top >= -1 && bounds.bottom <= bounds.height + 1, `Mention popover escaped the keyboard-sized viewport: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.left >= -1 && bounds.right <= bounds.width + 1, `Mention popover overflowed horizontally: ${JSON.stringify(bounds)}`);
    await bob.screenshot({ path: path.join(directory, 'mobile-mentions.png') });
    assert.ok(await bob.locator('#mentionList .mention-option').count() >= 2);
    await bob.locator('#composerText').press('Escape');
    await bob.waitForFunction(() => document.querySelector('#mentionPopover').hidden);
    await bob.locator('#composerText').fill('');
    await bob.setViewportSize({ width: 390, height: 844 });
  });

  await contract('mobile drawer traps keyboard focus and composer survives a keyboard-sized viewport', async () => {
    await bob.locator('#membersButton').click();
    await bob.waitForFunction(() => !document.querySelector('#mobileSheet').hidden);
    assert.equal(await bob.locator('#membersButton').getAttribute('aria-expanded'), 'true');
    assert.equal(await bob.locator('#mobileSheetClose').evaluate((node) => node === document.activeElement), true);
    await bob.keyboard.press('Shift+Tab');
    assert.equal(await bob.evaluate(() => document.querySelector('#mobileSheet').contains(document.activeElement)), true);
    await bob.keyboard.press('Escape');
    await bob.waitForFunction(() => document.querySelector('#mobileSheet').hidden);
    assert.equal(await bob.locator('#membersButton').evaluate((node) => node === document.activeElement), true);
    await bob.locator('#composerText').focus();
    // Headless Chromium has no OS keyboard. Resize its visual viewport to exercise
    // the same layout contract and dispatch actual keyboard events in the composer.
    await bob.setViewportSize({ width: 390, height: 430 });
    await frames(bob);
    const layout = await bob.locator('#composer').evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, height: window.innerHeight, width: document.documentElement.scrollWidth, viewport: window.innerWidth };
    });
    assert.ok(layout.top >= 0 && layout.bottom <= layout.height + 1, `Composer is outside the keyboard-sized viewport: ${JSON.stringify(layout)}`);
    assert.ok(layout.width <= layout.viewport + 1, 'Mobile layout must not overflow horizontally');
    await bob.screenshot({ path: path.join(directory, 'mobile-keyboard-sized.png') });
    await sendText(bob, 'mobile keyboard send', [alice]);
    await bob.setViewportSize({ width: 390, height: 844 });
  });

  await contract('graceful stop returns both pages to login and restart starts empty', async () => {
    const oldPort = server.port;
    await server.stop();
    for (const page of pages) {
      await page.waitForFunction(() => !document.querySelector('#loginScreen').hidden && document.querySelector('#appShell').hidden);
      assert.match(await page.locator('#loginError').textContent(), /服务已停止/);
      assert.equal(await page.locator('#messageList .message').count(), 0);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('pavilo.resume')), null);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('pavilo.channel')), null);
      assert.equal(await page.locator('#usernameInput').evaluate((node) => node === document.activeElement), true);
    }
    server = await startServer(configPath, oldPort);
    await login(alice, server.baseUrl, 'Browser Alice');
    assert.equal(await alice.locator('#messageList .message[data-message-id]').count(), 0);
    assert.equal(await alice.locator('#messageCount').textContent(), '0 条消息');
  });
  assert.deepEqual(failures, []);
});
