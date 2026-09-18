'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const messagesApi = require('../client/messages');
const { createMessages, isNearBottom, captureReadingOffset, readingScrollTop, isEmojiOnly } = messagesApi;
const { createI18n } = require('../client/i18n');

const self = { id: 'alice', username: 'Alice', avatarSeed: 1 };
const bob = { id: 'bob', username: 'Bob', avatarSeed: 2 };
function message(id, overrides = {}) {
  return { id, kind: 'text', author: bob, createdAt: 1_000, text: 'hello', reactions: {}, ...overrides };
}

// Only the DOM operations used by this renderer are simulated. Layout is assigned
// explicitly so scroll tests do not depend on browser layout or timing.
function harness(messages = [], options = {}) {
  const handlers = {};
  let rebuilds = 0;
  let state = { messages, pending: {}, self, connection: { joined: true }, channel: {} };
  function node(tag) {
    return {
      tag, dataset: {}, style: {}, hidden: false, children: [], innerHTML: '', className: '',
      querySelectorAll() { return []; },
      querySelector(selector) {
        if (selector === '.message-empty') return this.children.find((child) => child.className === 'message-empty');
        if (selector === '.pending-status') {
          this.status ||= { innerHTML: '', classList: { toggle() {} } };
          return this.status;
        }
        return null;
      },
      setAttribute(name, value) { this.attrs = { ...this.attrs, [name]: value }; },
      append(child) {
        if (child.tag === 'fragment') { for (const entry of child.children) this.append(entry); return; }
        child.parent = this;
        this.children.push(child);
        if (child.tag === 'article') {
          child.offsetTop = this.children.filter((entry) => entry.tag === 'article').length * 100 - 100;
          child.offsetHeight = 100;
        }
      },
      replaceChildren() { rebuilds += 1; this.children = []; },
      remove() { this.parent.children = this.parent.children.filter((child) => child !== this); },
      addEventListener(type, handler) { handlers[`${tag}:${type}`] = handler; },
    };
  }
  const messageList = node('list');
  const messageScroll = { scrollTop: 150, clientHeight: 100, style: { scrollBehavior: 'smooth' },
    focus(options) { this.focusOptions = options; } };
  Object.defineProperty(messageScroll, 'scrollHeight', {
    get() { return messageList.children.filter((child) => child.tag === 'article').length * 100; },
  });
  const document = { createElement: node, createDocumentFragment: () => node('fragment'),
    documentElement: { classList: { contains() { return false; } } },
    defaultView: { innerWidth: 800, innerHeight: 600, clearTimeout() {} } };
  messageList.ownerDocument = document;
  const elements = { messageList, messageScroll, messageCount: {}, reactionPopover: node('popover'), reactionChoices: node('choices') };
  elements.reactionPopover.hidden = true;
  const actions = [];
  const renderer = createMessages({ elements, getSelf: () => self, getState: () => state,
    onAction: (action) => actions.push(action), iconMarkup: (name) => `<svg>${name}</svg>`,
    avatarMarkup: (user) => `<avatar>${user.username}</avatar>`,
    escapeHtml: (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    formatTime: () => '12:00', formatDay: options.formatDay || (() => '今天'),
    t: createI18n({ language: 'zh-CN', storage: null }).t });
  return { renderer, elements, handlers, actions, get rebuilds() { return rebuilds; },
    transition(next, event) { const previous = state; state = next; renderer.onState(next, event, previous); },
    getState: () => state };
}

test('UMD exposes the same browser and Node APIs without touching the DOM', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/messages'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.PaviloMessages).sort(), Object.keys(messagesApi).sort());
  assert.equal(browser.document, undefined);
  const { renderer } = harness();
  assert.deepEqual(Object.keys(renderer).sort(), ['closeReactionPopover', 'onState', 'openReactionPopover', 'removePending', 'renderHistory', 'renderPending']);
});

test('near-bottom threshold remains strictly less than ninety pixels', () => {
  assert.equal(isNearBottom({ scrollHeight: 1_000, scrollTop: 811, clientHeight: 100 }), true);
  assert.equal(isNearBottom({ scrollHeight: 1_000, scrollTop: 810, clientHeight: 100 }), false);
});

test('reading anchor is the first message intersecting the viewport, not the expired edge', () => {
  const nodes = new Map([
    ['old', { offsetTop: 0, offsetHeight: 100 }],
    ['visible', { offsetTop: 120, offsetHeight: 80 }],
    ['later', { offsetTop: 220, offsetHeight: 80 }],
  ]);
  assert.deepEqual(captureReadingOffset({ scrollTop: 100, scrollHeight: 600 }, nodes),
    { id: 'visible', delta: 20, bottom: 500 });
  assert.deepEqual(captureReadingOffset({ scrollTop: 150, scrollHeight: 600 }, nodes),
    { id: 'visible', delta: -30, bottom: 450 });
});

test('restoration follows surviving content and falls back to bottom distance on eviction', () => {
  const anchor = { id: 'visible', delta: -30, bottom: 450 };
  assert.equal(readingScrollTop(anchor, 700, new Map([['visible', { offsetTop: 220 }]])), 250);
  assert.equal(readingScrollTop(anchor, 700, new Map()), 250);
  assert.deepEqual(captureReadingOffset({ scrollTop: 350, scrollHeight: 600 }, new Map()),
    { id: null, bottom: 250 });
  assert.equal(readingScrollTop({ id: null, bottom: 250 }, 500, new Map()), 250);
});

test('text, reply, reaction, action and day-divider markup stays unchanged and escaped', () => {
  const room = harness([message('one', { text: '<hello>', replyTo: { username: '<Bob>', text: '&quote' },
    reactions: { '👍': { count: 2, userIds: [self.id] }, '🔥': { count: 0, userIds: [] } } })]);
  room.renderer.renderHistory();
  const [divider, article] = room.elements.messageList.children;
  assert.equal(divider.className, 'day-divider');
  assert.equal(divider.innerHTML, '<span>今天</span>');
  assert.equal(article.className, 'message');
  assert.equal(article.dataset.messageId, 'one');
  assert.equal(article.innerHTML, '<div class="message-avatar"><avatar>Bob</avatar></div><div class="message-main"><div class="message-meta"><span class="message-author">Bob</span><time class="message-time" datetime="1970-01-01T00:00:01.000Z">12:00</time></div><div class="message-stack"><div class="message-bubble has-reactions"><div class="reply-quote"><strong>回复 &lt;Bob&gt;</strong><span>&amp;quote</span></div><div class="message-body">&lt;hello&gt;</div><div class="reaction-list" aria-label="消息回应"><button class="reaction-button active" type="button" data-reaction="👍" data-message-id="one" aria-label="👍 取消回应，2 人" aria-pressed="true"><span class="reaction-emoji">👍</span><span class="reaction-count">2</span></button></div></div><div class="message-actions"><button class="message-action reaction-action" type="button" data-message-id="one" data-popover-align="right" aria-label="表情回应" title="表情回应"><span class="icon" data-icon="smile-plus" data-icon-size="16" aria-hidden="true"></span><span class="icon reaction-plus" data-icon="plus" data-icon-size="10" aria-hidden="true"></span></button><button class="message-action reply-action" type="button" data-message-id="one" aria-label="回复这条消息" title="回复"><span class="icon" data-icon="reply" data-icon-size="14" aria-hidden="true"></span></button></div></div></div>');
  assert.equal(room.elements.messageCount.textContent, '1 条消息');
});

test('image dimensions, image button accessibility and emoji-only class match the source', () => {
  const room = harness([message('photo', { kind: 'image', text: '', image: { src: 'data:image/png;base64,aa"', width: 780, height: 600 } }),
    message('emoji', { author: self, text: '🔥 😂' })]);
  room.renderer.renderHistory();
  const articles = room.elements.messageList.children.filter((child) => child.tag === 'article');
  assert.match(articles[0].innerHTML, /<button class="message-image-link" type="button" data-viewer-message-id="photo" aria-label="查看 Bob 分享的图片"><img class="message-image" src="data:image\/png;base64,aa&quot;" alt="Bob 分享的图片" loading="lazy" decoding="async" width="390" height="300" style="width:390px;max-width:100%"><\/button>/);
  assert.match(articles[0].innerHTML, /class="message-bubble bare-media"/);
  assert.match(articles[1].innerHTML, /class="message-bubble bare-emoji"/);
  assert.match(articles[1].innerHTML, /<div class="message-body emoji-only emoji-few"><span class="inline-emoji">🔥<\/span> <span class="inline-emoji">😂<\/span><\/div>/);
  assert.equal(articles[1].className, 'message self');
});

test('emoji-only detection covers ZWJ, VS16 and keycaps, and mixed text stays in a bubble', () => {
  assert.equal(isEmojiOnly('🔥 😂'), true);
  assert.equal(isEmojiOnly('❤️'), true);
  assert.equal(isEmojiOnly('👨‍💻'), true);
  assert.equal(isEmojiOnly('👍🏻'), true);
  assert.equal(isEmojiOnly('1️⃣'), true);
  assert.equal(isEmojiOnly('☺️'), true);
  assert.equal(isEmojiOnly('  '), false);
  assert.equal(isEmojiOnly('©'), false);
  assert.equal(isEmojiOnly('你好 😂'), false);
  assert.equal(isEmojiOnly('😂哈哈'), false);

  const room = harness([
    message('heart', { author: self, text: '❤️' }),
    message('zwj', { text: '👨‍💻' }),
    message('mixed', { text: '你好 😂' }),
    message('caption', { kind: 'image', text: '😂', image: { src: 'data:image/png;base64,aa', width: 80, height: 50 } }),
  ]);
  room.renderer.renderHistory();
  const articles = room.elements.messageList.children.filter((child) => child.tag === 'article');
  assert.match(articles[0].innerHTML, /class="message-bubble bare-emoji"/);
  assert.match(articles[0].innerHTML, /message-body emoji-only emoji-solo/);
  assert.match(articles[0].innerHTML, /<span class="inline-emoji">❤️<\/span>/);
  assert.match(articles[1].innerHTML, /class="message-bubble bare-emoji"/);
  assert.match(articles[1].innerHTML, /<span class="inline-emoji">👨‍💻<\/span>/);
  assert.doesNotMatch(articles[2].innerHTML, /bare-emoji/);
  assert.doesNotMatch(articles[2].innerHTML, /emoji-only/);
  assert.match(articles[2].innerHTML, /class="message-bubble"/);
  assert.match(articles[2].innerHTML, /你好 <span class="inline-emoji">😂<\/span>/);
  assert.match(articles[3].innerHTML, /class="message-bubble has-media"/);
  assert.doesNotMatch(articles[3].innerHTML, /emoji-only/);
  assert.match(articles[3].innerHTML, /<span class="inline-emoji">😂<\/span>/);
});

test('pending emoji-only drafts skip the bubble the same way as sent ones', () => {
  const room = harness();
  room.renderer.renderHistory();
  const pending = { id: 'pending-emoji', kind: 'text', text: '❤️', status: 'sending' };
  room.transition({ ...room.getState(), pending: { [pending.id]: pending } }, { type: 'pending/add' });
  const article = room.elements.messageList.children.find((child) => child.tag === 'article');
  assert.match(article.innerHTML, /class="message-bubble bare-emoji"/);
  assert.match(article.innerHTML, /message-body emoji-only emoji-solo/);
  assert.match(article.innerHTML, /<span class="inline-emoji">❤️<\/span>/);
});

test('image-only messages with reactions keep a padded bubble and chips inside it', () => {
  const room = harness([message('photo', { kind: 'image', text: '',
    image: { src: 'data:image/png;base64,aa', width: 780, height: 600 },
    reactions: { '👍': { count: 1, userIds: [self.id] }, '😂': { count: 3, userIds: [bob.id] } } })]);
  room.renderer.renderHistory();
  const article = room.elements.messageList.children.find((child) => child.tag === 'article');
  assert.match(article.innerHTML, /class="message-bubble has-media has-reactions" style="--thumb-w:390px"/);
  assert.doesNotMatch(article.innerHTML, /bare-media/);
  assert.match(article.innerHTML, /message-image-link[\s\S]*<div class="reaction-list"/);
  assert.doesNotMatch(article.innerHTML, /message-actions[\s\S]*reaction-list/);
  assert.match(article.innerHTML, /<span class="reaction-emoji">👍<\/span><span class="reaction-count">1<\/span>/);
  assert.match(article.innerHTML, /<span class="reaction-emoji">😂<\/span><span class="reaction-count">3<\/span>/);
});

test('image captions render below the thumbnail in the same bubble', () => {
  const room = harness([message('photo', { kind: 'image', text: '<look>', image: { src: 'data:image/png;base64,aa"', width: 780, height: 600 } })]);
  room.renderer.renderHistory();
  const article = room.elements.messageList.children.find((child) => child.tag === 'article');
  assert.match(article.innerHTML, /class="message-bubble has-media" style="--thumb-w:390px"/);
  assert.match(article.innerHTML, /data-viewer-message-id="photo"/);
  assert.match(article.innerHTML, /<div class="message-bubble has-media" style="--thumb-w:390px">[\s\S]*<div class="message-body">&lt;look&gt;<\/div>/);
  assert.match(article.innerHTML, /style="width:390px;max-width:100%"/);
});

test('mixed-media bubbles stay image-above-caption and hug each displayed thumbnail', () => {
  const room = harness([
    message('wide', { kind: 'image', text: 'wide', image: { src: 'data:image/png;base64,aa', width: 1600, height: 400 } }),
    message('square', { kind: 'image', text: 'square', image: { src: 'data:image/png;base64,bb', width: 600, height: 600 } }),
    message('tall', { kind: 'image', text: 'tall', image: { src: 'data:image/png;base64,cc', width: 200, height: 800 } }),
    message('small', { kind: 'image', text: 'small', image: { src: 'data:image/png;base64,dd', width: 80, height: 50 } }),
  ]);
  room.renderer.renderHistory();
  const articles = room.elements.messageList.children.filter((child) => child.tag === 'article');
  assert.match(articles[0].innerHTML, /class="message-bubble has-media" style="--thumb-w:390px"/);
  assert.match(articles[0].innerHTML, /width="390" height="98" style="width:390px;max-width:100%"/);
  assert.match(articles[0].innerHTML, /message-image-link[\s\S]*message-body/);
  assert.match(articles[1].innerHTML, /class="message-bubble has-media" style="--thumb-w:300px"/);
  assert.match(articles[1].innerHTML, /width="300" height="300" style="width:300px;max-width:100%"/);
  assert.match(articles[2].innerHTML, /class="message-bubble has-media" style="--thumb-w:75px"/);
  assert.match(articles[2].innerHTML, /width="75" height="300" style="width:75px;max-width:100%"/);
  assert.match(articles[3].innerHTML, /class="message-bubble has-media" style="--thumb-w:80px"/);
  assert.match(articles[3].innerHTML, /width="80" height="50" style="width:80px;max-width:100%"/);
});

test('pending mixed images hug the pending thumbnail, not the sent 390px cap', () => {
  const room = harness();
  room.renderer.renderHistory();
  const pending = {
    id: 'pending-img',
    kind: 'image',
    text: 'soon',
    status: 'sending',
    image: { src: 'data:image/png;base64,aa', width: 200, height: 800 },
  };
  room.transition({ ...room.getState(), pending: { [pending.id]: pending } }, { type: 'pending/add' });
  const article = room.elements.messageList.children.find((child) => child.tag === 'article');
  assert.match(article.innerHTML, /class="message-bubble has-media" style="--thumb-w:45px"/);
  assert.match(article.innerHTML, /width="45" height="180" style="width:45px;max-width:100%"/);
  assert.match(article.innerHTML, /pending-image[\s\S]*message-body/);
});

test('consecutive messages from one author hide the later avatars', () => {
  const room = harness([
    message('one', { createdAt: 1_000 }),
    message('two', { createdAt: 2_000, text: 'again' }),
    message('own', { author: self, createdAt: 3_000, text: 'mine' }),
    message('own-two', { author: self, createdAt: 4_000, text: 'still mine' }),
  ]);
  room.renderer.renderHistory();
  const articles = room.elements.messageList.children.filter((child) => child.tag === 'article');
  assert.equal(articles[0].className, 'message');
  assert.match(articles[0].innerHTML, /<avatar>Bob<\/avatar>/);
  assert.equal(articles[1].className, 'message continued');
  assert.match(articles[1].innerHTML, /class="message-gutter-time"/);
  assert.doesNotMatch(articles[1].innerHTML, /<avatar>/);
  assert.match(articles[1].innerHTML, /class="visually-hidden">Bob</);
  assert.equal(articles[2].className, 'message self');
  assert.match(articles[2].innerHTML, /<avatar>Alice<\/avatar>/);
  assert.equal(articles[3].className, 'message self continued');
  assert.match(articles[3].innerHTML, /class="message-gutter-time"/);
});

test('a new day breaks consecutive grouping even for the same author', () => {
  const days = new Map([[1_000, '昨天'], [2_000, '今天']]);
  const room = harness([
    message('one', { createdAt: 1_000 }),
    message('two', { createdAt: 2_000, text: 'later' }),
  ], { formatDay: (stamp) => days.get(stamp) || '今天' });
  room.renderer.renderHistory();
  const articles = room.elements.messageList.children.filter((child) => child.tag === 'article');
  assert.equal(articles.length, 2);
  assert.equal(articles[0].className, 'message');
  assert.equal(articles[1].className, 'message');
  assert.match(articles[1].innerHTML, /<avatar>Bob<\/avatar>/);
});

test('pending drafts continue from the last own message without a second avatar', () => {
  const room = harness([message('own', { author: self, text: 'sent' })]);
  room.renderer.renderHistory();
  const pending = { id: 'pending-one', kind: 'text', text: 'draft', status: 'sending' };
  room.transition({ ...room.getState(), pending: { [pending.id]: pending } }, { type: 'pending/add' });
  const articles = room.elements.messageList.children.filter((child) => child.tag === 'article');
  assert.equal(articles[0].className, 'message self');
  assert.equal(articles[1].className, 'message self pending-message continued');
  assert.match(articles[1].innerHTML, /class="message-gutter-time"/);
});

test('prune and append paint once, sample the old DOM and keep reading anchored instantly', () => {
  const original = Array.from({ length: 6 }, (_, index) => message(String(index)));
  const room = harness(original);
  room.renderer.renderHistory();
  room.elements.messageScroll.scrollTop = 150;
  const newMessage = message('new');
  const next = { ...room.getState(), messages: [...original.slice(1), newMessage] };
  room.transition(next, { type: 'message', removedIds: ['0'], message: newMessage });
  assert.equal(room.rebuilds, 2, 'one initial paint, one combined update');
  assert.equal(room.elements.messageScroll.scrollTop, 50, 'the original first visible message stays fifty pixels above the viewport');
  assert.equal(room.elements.messageScroll.style.scrollBehavior, 'smooth', 'smooth gestures are restored after instant anchoring');
});

test('own messages deliberately pin to the bottom and unrelated changes do not repaint', () => {
  const original = Array.from({ length: 6 }, (_, index) => message(String(index)));
  const room = harness(original);
  room.renderer.renderHistory();
  room.elements.messageScroll.scrollTop = 150;
  room.transition({ ...room.getState(), users: [self, bob] }, { type: 'presence' });
  assert.equal(room.rebuilds, 1);
  const ownMessage = message('own', { author: self });
  room.transition({ ...room.getState(), messages: [...original, ownMessage] }, { type: 'message', message: ownMessage });
  assert.equal(room.elements.messageScroll.scrollTop, 700);
  assert.equal(room.rebuilds, 2);
});

test('pending statuses update the same article, survive rebuilds, and disappear after canonical echo', () => {
  const room = harness();
  room.renderer.renderHistory();
  const pending = { id: 'pending-one', kind: 'text', text: '<draft>', status: 'sending' };
  room.transition({ ...room.getState(), pending: { [pending.id]: pending } }, { type: 'pending/add' });
  const article = room.elements.messageList.children[0];
  assert.equal(article.className, 'message self pending-message');
  assert.match(article.innerHTML, /<div class="message-body">&lt;draft&gt;<\/div>/);
  assert.equal(article.status.innerHTML, '<span>等待房间确认…</span>');
  room.renderer.renderPending({ ...pending, status: 'error' });
  assert.equal(room.elements.messageList.children[0], article);
  assert.equal(article.status.innerHTML, '<span>发送失败，可重试</span><button type="button" class="pending-retry" data-pending-id="pending-one">重试</button>');
  room.renderer.renderHistory();
  assert.equal(room.elements.messageList.children[0].dataset.pendingId, pending.id);
  const canonical = message('canonical', { author: self, clientMessageId: pending.id });
  room.transition({ ...room.getState(), pending: {}, messages: [canonical] }, { type: 'message', message: canonical });
  assert.deepEqual(room.elements.messageList.children.filter((child) => child.tag === 'article').map((child) => child.dataset.messageId), ['canonical']);
});

test('reaction choices toggle, stay within the viewport and emit the existing wire command', () => {
  const room = harness([message('one', { reactions: { '👍': { count: 1, userIds: [self.id] } } })]);
  const anchor = { dataset: { popoverAlign: 'right' }, getBoundingClientRect: () => ({ left: 700, right: 760, top: 550, bottom: 580 }) };
  room.renderer.openReactionPopover('one', anchor);
  assert.equal(room.elements.reactionPopover.hidden, false);
  assert.equal(room.elements.reactionPopover.style.left, '416px');
  assert.equal(room.elements.reactionPopover.style.top, '484px');
  assert.match(room.elements.reactionChoices.innerHTML, /class="reaction-choice active"[^>]*data-emoji="👍"[^>]*aria-pressed="true"/);
  const button = { dataset: { emoji: '👍' }, getAttribute: () => 'true' };
  room.handlers['choices:click']({ target: { closest: () => button } });
  assert.deepEqual(room.actions, [{ type: 'reaction', messageId: 'one', emoji: '👍', active: false }]);
  assert.equal(room.elements.reactionPopover.hidden, true);
  assert.deepEqual(room.elements.messageScroll.focusOptions, { preventScroll: true });
  room.renderer.openReactionPopover('one', anchor);
  room.renderer.openReactionPopover('one', anchor);
  assert.equal(room.elements.reactionPopover.hidden, true);
});

test('delegated message clicks emit renderer actions once and preserve their priority', () => {
  const room = harness();
  const retry = { dataset: { pendingId: 'pending-one' } };
  room.handlers['list:click']({ target: { closest: (selector) => selector === '.pending-retry' ? retry : null } });
  const image = { dataset: { viewerMessageId: 'photo' } };
  room.handlers['list:click']({ target: { closest: (selector) => selector === '[data-viewer-message-id]' ? image : null } });
  const avatar = { dataset: { userId: bob.id } };
  room.handlers['list:click']({ target: { closest: (selector) => selector === '[data-user-id]' ? avatar : null } });
  const reply = { dataset: { messageId: 'one' } };
  room.handlers['list:click']({ target: { closest: (selector) => selector === '.reply-action' ? reply : null } });
  assert.deepEqual(room.actions, [{ type: 'retry', pendingId: 'pending-one' },
    { type: 'image', messageId: 'photo', anchor: image }, { type: 'profile', userId: bob.id, anchor: avatar },
    { type: 'reply', messageId: 'one' }]);
});
