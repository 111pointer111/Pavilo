(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloMessages = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '🔥'];

  function isNearBottom(scroll) {
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90;
  }

  // Geometry is sampled before a rebuild, while these nodes still represent what
  // the reader sees. Bottom distance is the fallback when the anchor is evicted.
  function captureReadingOffset(scroll, nodes) {
    const top = scroll.scrollTop;
    for (const [id, node] of nodes) {
      if (node.offsetTop + node.offsetHeight > top) {
        return { id, delta: node.offsetTop - top, bottom: scroll.scrollHeight - top };
      }
    }
    return { id: null, bottom: scroll.scrollHeight - top };
  }

  function readingScrollTop(anchor, scrollHeight, nodes) {
    const node = anchor.id ? nodes.get(anchor.id) : null;
    return node ? node.offsetTop - anchor.delta : scrollHeight - anchor.bottom;
  }

  function createMessages({ elements, getSelf, getState, onAction, iconMarkup,
    avatarMarkup, escapeHtml, formatTime, formatDay, renderMentionText, t = (key) => key }) {
    const { messageList, messageScroll, messageCount, reactionPopover, reactionChoices } = elements;
    const textMarkup = renderMentionText || ((text) => escapeHtml(text));
    const document = messageList.ownerDocument;
    const window = document.defaultView || globalThis;
    const messageNodes = new Map();
    const pendingNodes = new Map();
    const avatarSeed = getSelf()?.avatarSeed ?? (window.crypto?.getRandomValues
      ? window.crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 0x7fffffff));
    let reactionMessageId = null;
    let lastState = null;
    let snapshotPainted = Boolean(getState().connection?.joined);

    function hydrateIcons(root) {
      for (const host of root.querySelectorAll('[data-icon]')) {
        host.innerHTML = iconMarkup(host.dataset.icon, Number(host.dataset.iconSize) || 0);
        delete host.dataset.icon;
      }
    }

    function renderReply(message) {
      if (!message.replyTo) return '';
      return `<div class="reply-quote"><strong>${escapeHtml(t('reply.quote', { name: message.replyTo.username }))}</strong><span>${escapeHtml(message.replyTo.text)}</span></div>`;
    }

    function imageMarkup(message, author) {
      const rawWidth = Number(message.image?.width) || 640;
      const rawHeight = Number(message.image?.height) || 480;
      const scale = Math.min(1, 390 / rawWidth, 300 / rawHeight);
      const width = Math.max(1, Math.round(rawWidth * scale));
      const height = Math.max(1, Math.round(rawHeight * scale));
      const source = escapeHtml(message.image.src);
      return `<button class="message-image-link" type="button" data-viewer-message-id="${escapeHtml(message.id)}" aria-label="${escapeHtml(t('image.viewAria', { name: author.username }))}"><img class="message-image" src="${source}" alt="${escapeHtml(t('image.alt', { name: author.username }))}" loading="lazy" decoding="async" width="${width}" height="${height}"></button>`;
    }

    function reactionMarkup(message) {
      const entries = Object.entries(message.reactions || {}).filter(([, item]) => item && item.count > 0);
      if (!entries.length) return '';
      return `<div class="reaction-list" aria-label="${escapeHtml(t('reaction.group'))}">${entries.map(([emoji, item]) => {
        const active = item.userIds?.includes(getSelf()?.id);
        const label = t(active ? 'reaction.toggleOff' : 'reaction.toggleOn', { emoji, count: item.count || 0 });
        return `<button class="reaction-button${active ? ' active' : ''}" type="button" data-reaction="${escapeHtml(emoji)}" data-message-id="${escapeHtml(message.id)}" aria-label="${escapeHtml(label)}" aria-pressed="${Boolean(active)}"><span>${escapeHtml(emoji)}</span><span class="reaction-count">${item.count || 0}</span></button>`;
      }).join('')}</div>`;
    }

    function isEmojiOnly(text) {
      return /^\s*(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\s)+$/u.test(text || '');
    }

    function textBodyMarkup(text, mentions) {
      if (!text) return '';
      return `<div class="message-body${isEmojiOnly(text) ? ' emoji-only' : ''}">${textMarkup(text, mentions)}</div>`;
    }

    function messageBodyMarkup(message, author) {
      const image = message.kind === 'image' && message.image?.src ? imageMarkup(message, author) : '';
      const text = message.kind === 'text' || message.text ? textBodyMarkup(message.text, message.mentions) : '';
      return `${renderReply(message)}${image}${text}${reactionMarkup(message)}`;
    }

    function actionMarkup(messageId) {
      return `<div class="message-actions"><button class="message-action reaction-action" type="button" data-message-id="${escapeHtml(messageId)}" aria-label="${escapeHtml(t('reaction.add'))}"><span class="icon" data-icon="smile-plus" data-icon-size="16" aria-hidden="true"></span><span class="icon reaction-plus" data-icon="plus" data-icon-size="10" aria-hidden="true"></span></button><button class="message-action reply-action" type="button" data-message-id="${escapeHtml(messageId)}" aria-label="${escapeHtml(t('reaction.replyAria'))}"><span class="icon" data-icon="reply" data-icon-size="12" aria-hidden="true"></span>${escapeHtml(t('reaction.reply'))}</button></div>`;
    }

    function createMessageNode(message) {
      const self = getSelf();
      const author = message.author || self || { id: '', username: t('people.unknown'), avatarSeed: 0 };
      const article = document.createElement('article');
      article.className = `message${author.id === self?.id ? ' self' : ''}`;
      article.dataset.messageId = message.id;
      article.innerHTML = `<div class="message-avatar">${avatarMarkup(author)}</div><div class="message-main"><div class="message-meta"><span class="message-author">${escapeHtml(author.username)}</span><time class="message-time" datetime="${new Date(message.createdAt).toISOString()}">${formatTime(message.createdAt)}</time></div>${messageBodyMarkup(message, author)}${actionMarkup(message.id)}</div>`;
      hydrateIcons(article);
      messageNodes.set(message.id, article);
      return article;
    }

    function createDayDivider(timestamp) {
      const divider = document.createElement('div');
      divider.className = 'day-divider';
      divider.dataset.day = formatDay(timestamp);
      divider.innerHTML = `<span>${escapeHtml(divider.dataset.day)}</span>`;
      return divider;
    }

    function createWelcomeCard(channel) {
      if (!channel?.welcome) return null;
      const card = document.createElement('div');
      card.className = 'welcome-card';
      card.innerHTML = `<div class="welcome-icon" data-icon="megaphone" data-icon-size="20" aria-hidden="true"></div><div class="welcome-content"><div class="welcome-title">${escapeHtml(t('welcome.title', { name: channel.name }))}</div><div class="welcome-text">${escapeHtml(channel.welcome)}</div></div>`;
      hydrateIcons(card);
      return card;
    }

    function restoreReadingOffset(anchor) {
      // Corrections must land immediately even when gestures use smooth scrolling.
      const previousBehavior = messageScroll.style.scrollBehavior;
      messageScroll.style.scrollBehavior = 'auto';
      messageScroll.scrollTop = readingScrollTop(anchor, messageScroll.scrollHeight, messageNodes);
      messageScroll.style.scrollBehavior = previousBehavior;
    }

    function paintPending(item, scroll = true) {
      let node = pendingNodes.get(item.id);
      if (!node) {
        messageList.querySelector('.message-empty')?.remove();
        node = document.createElement('article');
        node.className = 'message self pending-message';
        node.dataset.pendingId = item.id;
        const self = getSelf();
        const body = [
          item.kind === 'image' && item.image?.src
            ? `<img class="pending-image" src="${escapeHtml(item.image.src)}" alt="${escapeHtml(t('pending.imageAlt'))}">`
            : '',
          item.text ? `<div class="message-body">${textMarkup(item.text, item.mentions)}</div>` : '',
        ].join('');
        node.innerHTML = `<div class="message-avatar">${avatarMarkup(self || { username: t('people.self'), avatarSeed }, '', false)}</div><div class="message-main"><div class="message-meta"><span class="message-author">${escapeHtml(self?.username || t('people.self'))}</span><span class="message-time">${escapeHtml(t('pending.now'))}</span></div>${body}<div class="pending-status" role="status" aria-live="polite"></div></div>`;
        hydrateIcons(node);
        pendingNodes.set(item.id, node);
        messageList.append(node);
      }
      const status = node.querySelector('.pending-status');
      const label = item.status === 'sending' ? t('pending.sending')
        : item.status === 'accepted' ? t('pending.accepted')
          : item.status === 'error' ? t('pending.error') : t('pending.unconfirmed');
      status.classList.toggle('error', item.status === 'error' || item.status === 'unconfirmed');
      status.innerHTML = `<span>${escapeHtml(label)}</span>${item.status === 'error' || item.status === 'unconfirmed' ? `<button type="button" class="pending-retry" data-pending-id="${escapeHtml(item.id)}">${escapeHtml(t('pending.retry'))}</button>` : ''}`;
      if (scroll && isNearBottom(messageScroll)) messageScroll.scrollTop = messageScroll.scrollHeight;
    }

    function removePending(item) {
      if (!item) return;
      if (item.timer) window.clearTimeout(item.timer);
      pendingNodes.get(item.id)?.remove();
      pendingNodes.delete(item.id);
    }

    function paintHistory(state, forceBottom = false, readingOffset = null, pinToBottom = false) {
      const messages = state.messages || [];
      const shouldBottom = forceBottom || pinToBottom || isNearBottom(messageScroll);
      messageNodes.clear();
      pendingNodes.clear();
      messageList.replaceChildren();
      const channel = state.channels?.find((ch) => ch.id === state.channelId);
      const welcomeCard = createWelcomeCard(channel);
      if (welcomeCard) messageList.append(welcomeCard);
      if (!messages.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'message-empty';
        placeholder.hidden = document.documentElement.classList.contains('resuming') || Boolean(channel?.welcome);
        placeholder.innerHTML = `<span class="message-empty-mark" aria-hidden="true">${escapeHtml(t('empty.mark'))}</span><strong>${escapeHtml(t('empty.title'))}</strong><p>${escapeHtml(t('empty.copy'))}</p>`;
        messageList.append(placeholder);
      } else {
        let lastDay = '';
        const fragment = document.createDocumentFragment();
        for (const message of messages) {
          const day = formatDay(message.createdAt);
          if (day !== lastDay) { fragment.append(createDayDivider(message.createdAt)); lastDay = day; }
          fragment.append(createMessageNode(message));
        }
        messageList.append(fragment);
      }
      messageCount.textContent = t('chat.messagesCount', { count: messages.length });
      const pending = Object.values(state.pending || {});
      for (const item of pending) paintPending(item, false);
      if (!messages.length && !pending.length) return;
      if (shouldBottom) messageScroll.scrollTop = messageScroll.scrollHeight;
      else if (readingOffset) restoreReadingOffset(readingOffset);
    }

    function renderHistory(forceBottom = false, readingOffset = null, pinToBottom = false) {
      const state = getState();
      paintHistory(state, forceBottom, readingOffset, pinToBottom);
      lastState = state;
    }

    function updateReactionNode(message) {
      const node = messageNodes.get(message.id);
      if (!node) return;
      const list = node.querySelector('.reaction-list');
      const markup = reactionMarkup(message);
      if (list) list.outerHTML = markup;
      else if (markup) node.querySelector('.message-actions')?.insertAdjacentHTML('beforebegin', markup);
    }

    function renderReactionChoices() {
      const message = getState().messages.find((item) => item.id === reactionMessageId);
      const reactions = message?.reactions || {};
      reactionChoices.innerHTML = REACTION_EMOJIS.map((emoji) => {
        const active = Boolean(reactions[emoji]?.userIds?.includes(getSelf()?.id));
        return `<button class="reaction-choice${active ? ' active' : ''}" type="button" data-emoji="${escapeHtml(emoji)}" aria-label="${escapeHtml(active ? t('reaction.choiceOff', { emoji }) : emoji)}" aria-pressed="${active}">${escapeHtml(emoji)}</button>`;
      }).join('');
    }

    function closeReactionPopover() {
      if (reactionPopover.hidden) return;
      reactionPopover.hidden = true;
      reactionMessageId = null;
    }

    function openReactionPopover(messageId, anchor) {
      if (!reactionPopover.hidden && reactionMessageId === messageId) {
        closeReactionPopover();
        return;
      }
      reactionMessageId = messageId;
      renderReactionChoices();
      reactionPopover.hidden = false;
      const rect = anchor.getBoundingClientRect();
      const width = reactionPopover.offsetWidth || 344;
      const height = reactionPopover.offsetHeight || 60;
      const left = anchor.dataset.popoverAlign === 'right'
        ? Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
        : Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      let top = rect.bottom + 6;
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
      reactionPopover.style.left = `${left}px`;
      reactionPopover.style.top = `${top}px`;
    }

    function onState(next, event = {}, previous = lastState) {
      const messagesChanged = !previous || next.messages !== previous.messages;
      if (messagesChanged) {
        const reactionOnly = event.type === 'reaction' && previous
          && next.messages.length === previous.messages.length
          && next.messages.every((message, index) => message.id === previous.messages[index].id);
        if (reactionOnly) {
          const message = next.messages.find((item) => item.id === event.messageId);
          if (message) updateReactionNode(message);
        } else {
          const snapshot = event.type === 'state' || event.type === 'historyEnd';
          const forceBottom = snapshot && (!snapshotPainted || previous?.channel?.switching);
          const ownMessage = event.type === 'message' && event.message?.author?.id === getSelf()?.id;
          const pinToBottom = Boolean(forceBottom || ownMessage || isNearBottom(messageScroll));
          const readingOffset = pinToBottom ? null : captureReadingOffset(messageScroll, messageNodes);
          paintHistory(next, forceBottom, readingOffset, pinToBottom);
        }
      }
      if (!messagesChanged || event.type === 'reaction') {
        const pending = next.pending || {};
        for (const id of [...pendingNodes.keys()]) if (!Object.hasOwn(pending, id)) removePending({ id });
        for (const item of Object.values(pending)) {
          if (!previous || item !== previous.pending?.[item.id] || !pendingNodes.has(item.id)) paintPending(item);
        }
      }
      if (event.type === 'state' || event.type === 'historyEnd') snapshotPainted = true;
      lastState = next;
    }

    messageList.addEventListener('click', (event) => {
      const retry = event.target.closest('.pending-retry');
      if (retry) { onAction({ type: 'retry', pendingId: retry.dataset.pendingId }); return; }
      const image = event.target.closest('[data-viewer-message-id]');
      if (image) { onAction({ type: 'image', messageId: image.dataset.viewerMessageId, anchor: image }); return; }
      const reaction = event.target.closest('.reaction-button');
      if (reaction) {
        onAction({ type: 'reaction', messageId: reaction.dataset.messageId, emoji: reaction.dataset.reaction,
          active: reaction.getAttribute('aria-pressed') !== 'true' });
        return;
      }
      const avatar = event.target.closest('[data-user-id]');
      if (avatar) { onAction({ type: 'profile', userId: avatar.dataset.userId, anchor: avatar }); return; }
      const reply = event.target.closest('.reply-action');
      if (reply) { onAction({ type: 'reply', messageId: reply.dataset.messageId }); return; }
      const reactionAction = event.target.closest('.reaction-action');
      if (reactionAction) openReactionPopover(reactionAction.dataset.messageId, reactionAction);
    });

    reactionChoices.addEventListener('click', (event) => {
      const button = event.target.closest('.reaction-choice');
      if (!button || !reactionMessageId) return;
      onAction({ type: 'reaction', messageId: reactionMessageId, emoji: button.dataset.emoji,
        active: button.getAttribute('aria-pressed') !== 'true' });
      closeReactionPopover();
      messageScroll.focus({ preventScroll: true });
    });

    return { onState, renderHistory, renderPending: paintPending, removePending,
      closeReactionPopover, openReactionPopover };
  }

  return { createMessages, isNearBottom, captureReadingOffset, readingScrollTop };
});
