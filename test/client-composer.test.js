'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const composerApi = require('../client/composer');
const { createComposer, MAX_PENDING, MAX_PENDING_IMAGE_BYTES, TYPING_INTERVAL, TYPING_EXPIRY } = composerApi;
const { createInitialState, createStore } = require('../client/state');
const { createPendingQueue } = require('../client/pending');
const { createI18n } = require('../client/i18n');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  let timestamp = 10_000;
  let nextTimer = 1;
  let nextId = 1;
  let blobId = 0;
  const timers = new Map();
  const createdUrls = [];
  const revokedUrls = [];
  const localPreviews = [];
  const listeners = new Map();
  const clock = {
    Date: { now: () => timestamp },
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, at: timestamp + delay, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    URL: {
      createObjectURL() { const url = `blob:test-${++blobId}`; createdUrls.push(url); return url; },
      revokeObjectURL(url) { revokedUrls.push(url); },
    },
  };
  function element(name) {
    const classes = new Set();
    const callbacks = new Map();
    const attrs = {};
    listeners.set(name, callbacks);
    return {
      value: '', style: {}, hidden: name === 'composerAttach' || name === 'composerDrop' || name === 'composerAttachRetry' || name === 'composerAttachStatus' || name === 'composerAttachMeta' || name === 'channelReadonlyNotice',
      disabled: false, scrollHeight: 30, maxLength: 2000, selectionStart: 0, files: null, alt: '', textContent: '',
      ownerDocument: null,
      classList: {
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
        toggle: (value, force) => {
          if (force === undefined) {
            if (classes.has(value)) classes.delete(value);
            else classes.add(value);
          } else {
            if (force) classes.add(value);
            else classes.delete(value);
          }
        },
        contains: (value) => classes.has(value)
      },
      getAttribute(key) { return Object.hasOwn(attrs, key) ? attrs[key] : null; },
      setAttribute(key, value) { attrs[key] = String(value); },
      addEventListener(type, handler) { if (!callbacks.has(type)) callbacks.set(type, new Set()); callbacks.get(type).add(handler); },
      removeEventListener(type, handler) { callbacks.get(type)?.delete(handler); },
      focus() {
        this.focusCount = (this.focusCount || 0) + 1;
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
      },
      blur() {
        this.blurCount = (this.blurCount || 0) + 1;
        if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
      },
      click() { this.clickCount = (this.clickCount || 0) + 1; },
      emit(type, payload = {}) {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, target: this, ...payload };
        for (const handler of [...(callbacks.get(type) || [])]) handler(event);
        return event;
      },
    };
  }
  const names = ['composer', 'composerText', 'sendButton', 'emojiButton', 'attachmentButton', 'imageInput',
    'replyingBar', 'replyingName', 'replyingText', 'cancelReplyButton', 'composerWrap', 'composerAttach',
    'composerAttachThumb', 'composerAttachImage', 'composerAttachStatus', 'composerAttachLabel',
    'composerAttachHint', 'composerAttachMeta', 'composerAttachRetry', 'composerAttachRemove', 'composerDrop',
    'composerHint', 'channelReadonlyNotice', 'messageScroll', 'document'];
  const elements = Object.fromEntries(names.map((name) => [name, element(name)]));
  const documentTarget = elements.document;
  documentTarget.defaultView = clock;
  clock.document = documentTarget;
  for (const item of Object.values(elements)) item.ownerDocument = documentTarget;
  elements.composer.requestSubmit = () => { elements.composer.submitCount = (elements.composer.submitCount || 0) + 1; elements.composer.emit('submit'); };
  elements.composerText.value = options.draft || '';
  let initial = createInitialState();
  initial = { ...initial, channelId: options.channelId || 'general', self: { id: 'alice', username: 'Alice' },
    channels: options.channels || [
      { id: 'general', name: 'General', readOnly: false },
      { id: 'board', name: 'Board', readOnly: true },
    ],
    room: { ...initial.room, epoch: 'epoch-one' }, connection: { ...initial.connection, joined: true, status: 'joined' } };
  const store = createStore(initial);
  const actions = [];
  const commands = [];
  const toasts = [];
  const prepared = [];
  const pending = createPendingQueue({ makeId: () => `pending-${nextId++}`, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  let ready = true;
  let sendResult = true;
  let replyTarget = null;
  let clearCount = 0;
  let limits = { maxTextLength: 2000 };
  const image = { src: 'data:image/png;base64,AAAA', width: 2, height: 2, bytes: 3 };
  const composer = createComposer({ elements, getState: store.getState,
    dispatch(event) { actions.push(event); return store.dispatch(event); },
    connection: { isReady: () => ready, send(command) { commands.push(command); return options.send ? options.send(command) : sendResult; } },
    pending, images: { prepareImage(file) { prepared.push(file); return options.prepare ? options.prepare(file) : Promise.resolve(image); } },
    toast: (...args) => toasts.push(args), clearReply: () => { clearCount += 1; },
    getReplyTarget: () => replyTarget, setReplyTarget: (value) => { replyTarget = value; }, getLimits: () => limits,
    t: createI18n({ language: 'zh-CN', storage: null }).t,
    openLocalPreview: (value, opener) => localPreviews.push({ value, opener }),
    closeLocalPreview: () => { localPreviews.push({ closed: true }); },
  });
  return { composer, elements, store, actions, commands, toasts, pending, timers, prepared, image, listeners,
    createdUrls, revokedUrls, localPreviews, document: documentTarget,
    get reply() { return replyTarget; }, get clearCount() { return clearCount; },
    setReady(value) { ready = value; }, setSendResult(value) { sendResult = value; }, setLimits(value) { limits = value; },
    advance(milliseconds) {
      const target = timestamp + milliseconds;
      while (true) {
        const entry = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        timestamp = entry[1].at;
        timers.delete(entry[0]);
        entry[1].callback();
      }
      timestamp = target;
    },
  };
}

const reply = { id: 'reply-one', author: { username: '<Bob>' }, kind: 'text', text: '<quoted>' };
const photo = { type: 'image/png', size: 10_000_000 };

test('UMD loads without DOM/browser scheduling and exposes identical APIs', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/composer'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.PaviloComposer).sort(), Object.keys(composerApi).sort());
  assert.equal(browser.document, undefined);
  assert.equal(MAX_PENDING, 32);
  assert.equal(MAX_PENDING_IMAGE_BYTES, 4_000_000);
  assert.equal(TYPING_INTERVAL, 900);
  assert.equal(TYPING_EXPIRY, 4_500);
  assert.deepEqual(Object.keys(harness().composer).sort(), ['bind', 'clearAttachment', 'clearReply', 'hasAttachment', 'imageProcessingCount', 'sendAll', 'sendStaged', 'sendText', 'setReply', 'stageImage', 'stopTyping', 'unbind', 'update']);
});

test('update keeps textarea resizing, live text limits, and exact lock behavior', () => {
  const room = harness({ draft: '  hello ' });
  room.composer.update();
  assert.equal(room.elements.sendButton.disabled, false);
  assert.equal(room.elements.composerText.style.height, '30px');
  room.elements.composerText.scrollHeight = 300;
  room.setLimits({ maxTextLength: '4500' });
  room.composer.update();
  assert.equal(room.elements.composerText.style.height, '145px');
  assert.equal(room.elements.composerText.maxLength, 4500);
  room.setReady(false);
  room.composer.update();
  assert.equal(room.elements.sendButton.disabled, true);
  assert.equal(room.elements.attachmentButton.disabled, true);
  assert.equal(room.elements.emojiButton.disabled, false);
  assert.equal(room.elements.composerText.disabled, false);
  room.store.dispatch({ type: 'channel/request', channelId: 'other' });
  room.composer.update();
  assert.equal(room.elements.composerText.disabled, true);
  assert.equal(room.elements.emojiButton.disabled, true);
});

test('text submission projects immutable pending, sends once, and preserves draft/reply until ACK', () => {
  const room = harness({ draft: '  hello\n' });
  room.composer.setReply(reply);
  room.composer.bind();
  assert.equal(room.elements.composer.emit('submit').defaultPrevented, true);
  const item = [...room.pending.values()][0];
  assert.equal(item.text, 'hello');
  assert.equal(item.epoch, 'epoch-one');
  assert.equal(item.status, 'sending');
  assert.equal(item.attempts, 1);
  assert.deepEqual(room.commands, [
    { type: 'message', kind: 'text', clientMessageId: item.id, replyTo: reply.id, text: 'hello' },
    { type: 'typing', active: false },
  ]);
  assert.equal(room.elements.composerText.value, '  hello\n');
  assert.equal(room.reply, reply);
  assert.equal(room.elements.sendButton.disabled, true);
  assert.equal(room.actions[0].type, 'pending/add');
  assert.notEqual(room.store.getState().pending[item.id], item);
  assert.equal(Object.hasOwn(room.store.getState().pending[item.id], 'timer'), false);
  assert.equal(room.store.getState().pending[item.id].sentAt, 10_000);
});

test('blank, disconnected, switching, full and sending-text paths preserve exact Chinese copy', () => {
  const blank = harness({ draft: '  \n ' });
  assert.equal(blank.composer.sendText(), false);
  assert.deepEqual(blank.toasts, []);
  for (const [setup, message] of [
    [(room) => room.setReady(false), '连接尚未恢复，草稿已保留。'],
    [(room) => room.store.dispatch({ type: 'connection/open' }), '连接尚未恢复，草稿已保留。'],
    [(room) => room.store.dispatch({ type: 'channel/request', channelId: 'other' }), '正在切换频道，草稿已保留。'],
    [(room) => room.pending.add({ kind: 'text', text: 'previous' }), '上一条文字仍在等待确认。'],
    [(room) => { for (let index = 0; index < MAX_PENDING; index += 1) room.pending.add({ kind: 'image' }); }, '上一条文字仍在等待确认。'],
  ]) {
    const room = harness({ draft: 'draft' });
    setup(room);
    const size = room.pending.size;
    assert.equal(room.composer.sendText(), false);
    assert.deepEqual(room.toasts, [[message, true]]);
    assert.equal(room.elements.composerText.value, 'draft');
    assert.equal(room.pending.size, size);
    assert.deepEqual(room.commands, []);
  }
});

test('failed text transport removes pending and leaves draft/reply editable', () => {
  const room = harness({ draft: 'draft' });
  room.composer.setReply(reply);
  room.setSendResult(false);
  assert.equal(room.composer.sendText(), false);
  assert.equal(room.pending.size, 0);
  assert.deepEqual(room.store.getState().pending, {});
  assert.deepEqual(room.actions.map((event) => event.type), ['pending/add', 'pending/update', 'pending/remove']);
  assert.deepEqual(room.toasts, [['发送失败，草稿已保留。', true]]);
  assert.equal(room.elements.composerText.value, 'draft');
  assert.equal(room.reply, reply);
  assert.equal(room.elements.sendButton.disabled, false);
  assert.equal(room.timers.size, 0);
});

test('accepted/unconfirmed/error text does not retain the sending-text lock', () => {
  for (const status of ['accepted', 'unconfirmed', 'error']) {
    const room = harness({ draft: 'next' });
    room.pending.add({ kind: 'text', text: 'old', status });
    room.composer.update();
    assert.equal(room.elements.sendButton.disabled, false);
    assert.equal(room.composer.sendText(), true);
    assert.equal(room.pending.size, 2);
  }
});

test('Enter sends, Shift+Enter preserves newline, and composition/229 never submit', () => {
  const room = harness({ draft: '输入中' });
  room.composer.bind();
  for (const event of [{ key: 'Enter', shiftKey: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }]) {
    assert.equal(room.elements.composerText.emit('keydown', event).defaultPrevented, false);
  }
  room.elements.composerText.emit('compositionstart');
  assert.equal(room.elements.composerText.emit('keydown', { key: 'Enter' }).defaultPrevented, false);
  assert.equal(room.composer.sendText(), false);
  room.elements.composerText.emit('compositionend');
  assert.equal(room.elements.composerText.emit('keydown', { key: 'Enter' }).defaultPrevented, true);
  assert.equal(room.elements.composer.submitCount, 1);
  assert.equal(room.pending.size, 1);
});

test('typing throttles to 900ms, expires after 4500ms and stops on empty input/blur', () => {
  const room = harness({ draft: 'hello' });
  room.composer.bind();
  room.elements.composerText.emit('input');
  assert.deepEqual(room.commands, [{ type: 'typing', active: true }]);
  room.advance(100);
  room.elements.composerText.emit('input');
  room.advance(799);
  assert.equal(room.commands.length, 1);
  room.advance(1);
  assert.deepEqual(room.commands.at(-1), { type: 'typing', active: true });
  room.advance(4_499);
  assert.equal(room.commands.length, 2);
  room.advance(1);
  assert.deepEqual(room.commands.at(-1), { type: 'typing', active: false });
  room.advance(900);
  room.elements.composerText.emit('input');
  room.elements.composerText.value = '   ';
  room.elements.composerText.emit('input');
  assert.deepEqual(room.commands.at(-1), { type: 'typing', active: false });
  assert.equal(room.timers.size, 0);
  room.elements.composerText.value = 'new';
  room.advance(900);
  room.elements.composerText.emit('input');
  room.elements.composerText.emit('blur');
  assert.deepEqual(room.commands.at(-1), { type: 'typing', active: false });
  assert.equal(room.timers.size, 0);
});

test('typing never sends disconnected or across a channel-switch lock', () => {
  for (const setup of [(room) => room.setReady(false), (room) => room.store.dispatch({ type: 'channel/request', channelId: 'other' })]) {
    const room = harness({ draft: 'hello' });
    room.composer.bind();
    room.elements.composerText.emit('input');
    setup(room);
    room.composer.stopTyping();
    room.advance(10_000);
    assert.deepEqual(room.commands, [{ type: 'typing', active: true }]);
    assert.equal(room.timers.size, 0);
  }
});

test('reply UI uses textContent and the unchanged image label, and cancel clears state', () => {
  const room = harness();
  room.composer.bind();
  room.composer.setReply(reply);
  assert.equal(room.reply, reply);
  assert.equal(room.elements.replyingBar.hidden, false);
  assert.equal(room.elements.replyingName.textContent, '<Bob>');
  assert.equal(room.elements.replyingText.textContent, '<quoted>');
  assert.equal(room.elements.composer.classList.contains('has-reply'), true);
  assert.equal(room.elements.composerText.focusCount, 1);
  room.composer.setReply({ id: 'reply-one', author: { username: '<Bob>' }, kind: 'image' });
  assert.equal(room.elements.replyingText.textContent, '图片');
  room.composer.setReply({ id: 'reply-one', author: { username: '<Bob>' }, kind: 'image', text: '配文' });
  assert.equal(room.elements.replyingText.textContent, '配文');
  room.elements.cancelReplyButton.emit('click');
  assert.equal(room.reply, null);
  assert.equal(room.clearCount, 1);
  assert.equal(room.elements.replyingBar.hidden, true);
  assert.equal(room.elements.composer.classList.contains('has-reply'), false);
});

test('read-only channel replaces the composer, keeps the draft, and ignores reply', async () => {
  const room = harness({ draft: 'keep me', channelId: 'board' });
  room.elements.composerText.focus();
  room.composer.update();
  assert.equal(room.elements.composer.hidden, true);
  assert.equal(room.elements.composerHint.hidden, true);
  assert.equal(room.elements.channelReadonlyNotice.hidden, false);
  assert.equal(room.elements.composerWrap.classList.contains('is-readonly'), true);
  assert.equal(room.elements.composerText.value, 'keep me');
  assert.equal(room.elements.composerText.disabled, true);
  assert.equal(room.elements.sendButton.disabled, true);
  assert.equal(room.elements.emojiButton.disabled, true);
  assert.equal(room.elements.attachmentButton.disabled, true);
  assert.equal(room.elements.composerText.blurCount, 1);
  assert.equal(room.elements.messageScroll.focusCount, 1);
  assert.equal(room.composer.sendText(), false);
  assert.deepEqual(room.toasts, [['这个频道是只读频道，无法发送消息。', true]]);
  assert.equal(await room.composer.stageImage(photo), false);
  assert.deepEqual(room.toasts.at(-1), ['这个频道是只读频道，无法发送图片。', true]);
  room.composer.setReply(reply);
  assert.equal(room.reply, null);
  assert.equal(room.elements.replyingBar.hidden, true);
  assert.equal(room.elements.composerText.value, 'keep me');
});

test('read-only paint hides a pending reply without clearing it', () => {
  const room = harness();
  room.composer.setReply(reply);
  assert.equal(room.elements.replyingBar.hidden, false);
  room.store.dispatch({
    type: 'state',
    self: room.store.getState().self,
    users: [],
    channelId: 'board',
    messages: [],
  });
  room.composer.update();
  assert.equal(room.reply, reply);
  assert.equal(room.elements.replyingBar.hidden, true);
  assert.equal(room.elements.composer.hidden, true);
  room.store.dispatch({
    type: 'state',
    self: room.store.getState().self,
    users: [],
    channelId: 'general',
    messages: [],
  });
  room.composer.update();
  assert.equal(room.elements.composer.hidden, false);
  assert.equal(room.elements.composerHint.hidden, false);
  assert.equal(room.elements.channelReadonlyNotice.hidden, true);
  assert.equal(room.elements.replyingBar.hidden, false);
});

test('image input stages instead of sending and clears the selected input immediately', async () => {
  const room = harness();
  room.composer.bind().bind();
  room.elements.attachmentButton.emit('click');
  assert.equal(room.elements.imageInput.clickCount, 1);
  room.elements.imageInput.files = [photo];
  room.elements.imageInput.value = 'selected';
  room.elements.imageInput.emit('change');
  assert.equal(room.elements.imageInput.value, '');
  await Promise.resolve();
  assert.deepEqual(room.prepared, [photo]);
  assert.equal(room.pending.size, 0);
  assert.equal(room.composer.hasAttachment, true);
  assert.equal(room.elements.composerAttach.hidden, false);
  assert.equal(room.elements.composer.classList.contains('has-attach'), true);
  assert.equal(room.elements.composerAttachMeta.hidden, true);
  assert.equal(room.elements.composerAttachLabel.textContent, '');
  assert.equal(room.composer.imageProcessingCount, 0);
  room.elements.composerAttachRemove.emit('click');
  assert.equal(room.composer.hasAttachment, false);
  assert.equal(room.elements.composerAttach.hidden, true);
  assert.equal(room.elements.composer.classList.contains('has-attach'), false);
});

test('image preparation keeps emoji and attach enabled, then sendAll queues the image and caption', async () => {
  const processing = deferred();
  const room = harness({ draft: 'draft', prepare: () => processing.promise });
  room.composer.setReply(reply);
  const staging = room.composer.stageImage(photo);
  assert.equal(room.composer.imageProcessingCount, 1);
  assert.equal(room.elements.sendButton.disabled, true);
  assert.equal(room.elements.emojiButton.disabled, false);
  assert.equal(room.elements.attachmentButton.disabled, false);
  assert.equal(room.elements.composerText.disabled, false);
  assert.equal(room.elements.composerAttachThumb.getAttribute('aria-busy'), 'true');
  processing.resolve(room.image);
  assert.equal(await staging, true);
  assert.equal(room.elements.composerAttachThumb.getAttribute('aria-busy'), 'false');
  assert.equal(room.pending.size, 0);
  assert.equal(room.composer.sendAll(), true);
  const item = [...room.pending.values()][0];
  assert.equal(item.kind, 'image');
  assert.equal(item.image, room.image);
  assert.equal(item.text, 'draft');
  assert.equal(item.replyToId, reply.id);
  assert.equal(item.epoch, 'epoch-one');
  assert.deepEqual(room.commands.filter((command) => command.type === 'message'), [{ type: 'message', kind: 'image', clientMessageId: item.id, replyTo: reply.id, image: room.image, text: 'draft' }]);
  assert.equal(room.reply, null);
  assert.equal(room.elements.composerText.value, 'draft');
  assert.equal(room.composer.hasAttachment, false);
  assert.equal(room.composer.imageProcessingCount, 0);
});

test('unsupported or unready images retain exact rejection strings and do not stage', async () => {
  const missing = harness();
  assert.equal(await missing.composer.stageImage(), false);
  assert.deepEqual(missing.toasts, []);
  for (const [file, setup, message] of [
    [{ type: 'image/svg+xml' }, () => {}, '请选择 PNG、JPEG、GIF 或 WebP 图片。'],
    [photo, (room) => room.setReady(false), '连接或频道切换尚未完成，暂时不能发送图片。'],
    [photo, (room) => room.store.dispatch({ type: 'channel/request', channelId: 'other' }), '连接或频道切换尚未完成，暂时不能发送图片。'],
  ]) {
    const room = harness();
    setup(room);
    assert.equal(await room.composer.stageImage(file), false);
    assert.deepEqual(room.toasts, [[message, true]]);
    assert.deepEqual(room.prepared, []);
    assert.equal(room.composer.hasAttachment, false);
    assert.equal(room.composer.imageProcessingCount, 0);
  }
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    const room = harness();
    assert.equal(await room.composer.stageImage({ type, size: 1 }), true);
    assert.equal(room.prepared[0].type, type);
    assert.equal(room.pending.size, 0);
  }
});

test('full pending queues reject sendStaged after a successful stage', async () => {
  const room = harness();
  assert.equal(await room.composer.stageImage(photo), true);
  for (let index = 0; index < MAX_PENDING; index += 1) room.pending.add({ kind: 'image' });
  assert.equal(room.composer.sendStaged(), false);
  assert.deepEqual(room.toasts, [['待确认的图片较多，请稍后再试。', true]]);
  assert.equal(room.composer.hasAttachment, true);
});

test('encoded image byte budget is checked at send, not at stage', async () => {
  for (const [bytes, accepted] of [[MAX_PENDING_IMAGE_BYTES - 3, true], [MAX_PENDING_IMAGE_BYTES - 2, false]]) {
    const room = harness();
    room.pending.add({ kind: 'image', image: { bytes }, status: 'unconfirmed' });
    assert.equal(await room.composer.stageImage(photo), true);
    assert.equal(room.composer.sendStaged(), accepted);
    assert.equal(room.pending.size, accepted ? 2 : 1);
    assert.deepEqual(room.toasts, accepted ? [] : [['待确认的图片较多，请稍后再试。', true]]);
  }
});

test('a second stage replaces the first without enqueueing either until send', async () => {
  const processing = deferred();
  const room = harness({ prepare: () => processing.promise });
  const first = room.composer.stageImage(photo);
  const second = room.composer.stageImage({ type: 'image/jpeg', size: 2 });
  assert.equal(room.composer.imageProcessingCount, 2);
  processing.resolve(room.image);
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(room.pending.size, 0);
  assert.equal(room.composer.hasAttachment, true);
  assert.equal(room.composer.imageProcessingCount, 0);
});

test('channel, epoch or connection changes during preparation keep the chip in error and retain reply', async () => {
  for (const change of [
    (room) => room.store.dispatch({ type: 'channel/request', channelId: 'other' }),
    (room) => room.store.dispatch({ type: 'state', channelId: 'other', roomEpoch: 'epoch-one', self: room.store.getState().self }),
    (room) => room.store.dispatch({ type: 'room/epoch', epoch: 'epoch-two' }),
    (room) => room.setReady(false),
  ]) {
    const processing = deferred();
    const room = harness({ prepare: () => processing.promise });
    room.composer.setReply(reply);
    const staging = room.composer.stageImage(photo);
    change(room);
    processing.resolve(room.image);
    assert.equal(await staging, false);
    assert.equal(room.pending.size, 0);
    assert.equal(room.reply, reply);
    assert.equal(room.composer.hasAttachment, true);
    assert.deepEqual(room.toasts, [['图片处理完成，但频道状态已变化，请重新选择后发送。', true]]);
    assert.equal(room.composer.imageProcessingCount, 0);
  }
});

test('image send failure remains unconfirmed, unlike text failure', async () => {
  const room = harness();
  room.composer.setReply(reply);
  room.setSendResult(false);
  assert.equal(await room.composer.stageImage(photo), true);
  assert.equal(room.composer.sendStaged(), true);
  const item = [...room.pending.values()][0];
  assert.equal(item.status, 'unconfirmed');
  assert.equal(room.store.getState().pending[item.id].status, 'unconfirmed');
  assert.equal(room.reply, null);
  assert.equal(room.composer.hasAttachment, false);
  assert.deepEqual(room.toasts, []);
  assert.equal(room.timers.size, 0);
});

test('preparation errors keep the chip, preserve reply, and explain the failure', async () => {
  for (const [code, message] of [
    [undefined, '图片无法读取，可能已损坏或格式不受支持。'],
    ['SOURCE_TOO_LARGE', '图片尺寸过高，请先裁剪后发送。'],
    ['GIF_TOO_LARGE', 'GIF 动图超过频道限制，请换一个更小的 GIF。'],
    ['ENCODE_TOO_LARGE', '图片内容较复杂，自动压缩后仍超过频道限制，请裁剪后重试。'],
    ['CANVAS_UNAVAILABLE', '当前浏览器无法处理图片，请刷新页面或换用最新版 Chrome。'],
  ]) {
    const room = harness({ draft: 'draft', prepare() { const error = new Error('processing failed'); error.code = code; throw error; } });
    room.composer.setReply(reply);
    assert.equal(await room.composer.stageImage(photo), false);
    assert.deepEqual(room.toasts, [[message, true]]);
    assert.equal(room.composer.hasAttachment, true);
    assert.equal(room.elements.composerAttachRetry.hidden, false);
    assert.equal(room.elements.composerAttachMeta.hidden, false);
    assert.equal(room.elements.composerAttachLabel.textContent, '无法使用这张图片');
    assert.equal(room.elements.composerAttachHint.textContent, message);
    assert.equal(room.composer.imageProcessingCount, 0);
    assert.equal(room.elements.sendButton.disabled, false);
    assert.equal(room.elements.attachmentButton.disabled, false);
  }
});

test('paste stages an image file and leaves text paste alone', async () => {
  const room = harness();
  room.composer.bind();
  const imagePaste = room.document.emit('paste', {
    clipboardData: { files: [photo], items: [] },
  });
  assert.equal(imagePaste.defaultPrevented, true);
  await Promise.resolve();
  assert.equal(room.composer.hasAttachment, true);
  const textPaste = room.document.emit('paste', {
    clipboardData: { files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
  });
  assert.equal(textPaste.defaultPrevented, false);
});

test('dropping an image stages it and non-image files are ignored', async () => {
  const room = harness();
  room.composer.bind();
  const dropped = room.elements.composerWrap.emit('drop', {
    dataTransfer: { files: [photo], types: ['Files'] },
  });
  assert.equal(dropped.defaultPrevented, true);
  await Promise.resolve();
  assert.equal(room.composer.hasAttachment, true);
  const ignored = room.elements.messageScroll.emit('drop', {
    dataTransfer: { files: [{ type: 'application/pdf', size: 12 }], types: ['Files'] },
  });
  assert.equal(ignored.defaultPrevented, false);
});

test('empty-textarea Backspace removes the staged image', async () => {
  const room = harness();
  room.composer.bind();
  assert.equal(await room.composer.stageImage(photo), true);
  room.elements.composerText.selectionStart = 0;
  const event = room.elements.composerText.emit('keydown', { key: 'Backspace' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(room.composer.hasAttachment, false);
});

test('unbind removes explicit handlers, cancels typing and rejects stale prepared uploads', async () => {
  const processing = deferred();
  const room = harness({ draft: 'hello', prepare: () => processing.promise });
  room.composer.bind();
  room.elements.composerText.emit('input');
  const staging = room.composer.stageImage(photo);
  assert.equal(room.composer.unbind(), room.composer);
  for (const callbacks of room.listeners.values()) for (const handlers of callbacks.values()) assert.equal(handlers.size, 0);
  room.elements.composer.emit('submit');
  room.advance(10_000);
  assert.deepEqual(room.commands, [{ type: 'typing', active: true }, { type: 'typing', active: false }]);
  processing.resolve(room.image);
  assert.equal(await staging, false);
  assert.equal(room.pending.size, 0);
  assert.deepEqual(room.toasts, []);
  assert.equal(room.composer.hasAttachment, false);
  assert.equal(room.composer.imageProcessingCount, 0);
  room.composer.bind();
  assert.equal(room.elements.composerText.emit('keydown', { key: 'Enter' }).defaultPrevented, true);
  assert.equal(room.pending.size, 1);
});

