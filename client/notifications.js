(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloNotifications = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TOAST_KINDS = {
    info: { icon: 'bell', title: '通知' },
    error: { icon: 'circle-alert', title: '出错了' },
    success: { icon: 'circle-check', title: '已完成' },
    presence: { icon: 'users-round', title: '有人进出' },
  };
  const TOAST_MAX_STACK = 6;
  const TOAST_FULL_SLOTS = 3;
  const TOAST_BUDGET_PX = 460;
  const TOAST_ESTIMATED_FULL_PX = 66;
  const TOAST_SLIDE = 240;
  const APPEARANCE_BONUS = 5000;

  function toastDuration(message) {
    return Math.max(2400, Math.min(6000, 1500 + message.length * 95));
  }

  function createNotifications({ elements, getState, onAction, iconMarkup, escapeHtml }) {
    const { toastRegion, messageScroll, newMessageJump, newMessageCount,
      notifyButton, appFavicon } = elements;
    const document = toastRegion.ownerDocument;
    const window = document.defaultView || globalThis;
    const cleanups = [];
    const timeouts = new Set();
    const intervals = new Set();
    const frames = new Set();
    const nodes = new Set();
    let nativeNotification = null;
    let lastState = getState();
    let destroyed = false;

    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function later(callback, delay) {
      const timer = window.setTimeout(() => {
        timeouts.delete(timer);
        if (!destroyed) callback();
      }, delay);
      timeouts.add(timer);
      return timer;
    }

    function frame(callback) {
      if (typeof window.requestAnimationFrame !== 'function') return;
      const id = window.requestAnimationFrame(() => {
        frames.delete(id);
        if (!destroyed) callback();
      });
      frames.add(id);
    }

    function startTimer(state) {
      const timer = window.setInterval(() => toastStack.tick(state), 32);
      intervals.add(timer);
      state.timer = timer;
    }

    function stopTimer(state) {
      window.clearInterval(state.timer);
      intervals.delete(state.timer);
      state.timer = 0;
    }

    function removeNode(node) {
      node.remove();
      nodes.delete(node);
    }

    function createToast(message, { kind = 'info', title, action,
      onAction: onToastAction, closeLabel } = {}) {
      if (destroyed) return null;
      const tone = TOAST_KINDS[kind] || TOAST_KINDS.info;
      const node = document.createElement('div');
      nodes.add(node);
      node.className = 'toast';
      node.dataset.variant = kind;
      node.style.setProperty('--toast-life', `${toastDuration(message)}ms`);
      node.innerHTML = `<div class="toast-head">
        ${iconMarkup(tone.icon)}
        <span class="toast-title">${escapeHtml(title || tone.title)}</span>
        <button class="toast-close" type="button" aria-label="${escapeHtml(closeLabel || '关闭通知')}"></button>
      </div><p class="toast-copy"></p><div class="toast-foot" hidden></div>`;
      node.querySelector('.toast-copy').textContent = message;
      node.querySelector('.toast-close').innerHTML = iconMarkup('x');

      let closed = false;
      let onClose = null;
      const state = { node, until: 0, hovered: false, held: false, timer: 0 };
      function dismiss() {
        if (closed || destroyed) return;
        closed = true;
        stopTimer(state);
        if (onClose) onClose();
        node.classList.add('leaving');
        later(() => {
          removeNode(node);
          if (!toastRegion.querySelector('.toast')) toastStack.compactAll(true);
        }, TOAST_SLIDE);
      }
      state.dismiss = dismiss;
      node.addEventListener('animationend', (event) => {
        if (event.animationName === 'toast-out' && closed) removeNode(node);
      });
      node.querySelector('.toast-close').addEventListener('click', dismiss);
      if (action) {
        const button = document.createElement('button');
        button.className = 'toast-action';
        button.type = 'button';
        button.textContent = action;
        button.addEventListener('click', () => {
          if (destroyed) return;
          dismiss();
          onToastAction?.();
        });
        state.held = true;
        node.querySelector('.toast-foot').append(button);
      }
      if (!state.held) state.until = Date.now() + toastDuration(message);

      // Background tabs may never run rAF; keep the original 48ms fallback.
      let armed = false;
      const arm = () => {
        if (armed || closed) return;
        armed = true;
        node.dataset.ready = '';
      };
      frame(() => frame(arm));
      later(arm, 48);
      onClose = toastStack.open(state);
      node.addEventListener('pointerenter', () => toastStack.setHover(state, true));
      node.addEventListener('pointerleave', () => toastStack.setHover(state, false));
      node.addEventListener('focusin', () => toastStack.setHover(state, true));
      node.addEventListener('focusout', () => {
        if (!destroyed) later(() => toastStack.setHover(state, node.contains(document.activeElement)), 0);
      });
      return { node, dismiss };
    }

    const toastStack = {
      items: [],
      open(state) {
        this.items.push(state);
        toastRegion.prepend(state.node);
        while (this.items.length > TOAST_MAX_STACK) this.drop(this.items[0], true);
        this.compactAll(false);
        startTimer(state);
        return () => stopTimer(state);
      },
      drop(state, immediate) {
        stopTimer(state);
        const index = this.items.indexOf(state);
        if (index >= 0) this.items.splice(index, 1);
        if (immediate) removeNode(state.node);
        else state.dismiss();
      },
      setHover(state, hovered) {
        if (destroyed || state.hovered === hovered) return;
        state.hovered = hovered;
        state.node.classList.toggle('pinned', hovered);
        this.syncPause();
      },
      syncPause() {
        for (const state of this.items) {
          const paused = state.hovered || state.held;
          state.node.toggleAttribute('data-paused', paused);
          if (paused) {
            if (state.timer) stopTimer(state);
            state.remaining = Math.max(0, state.until - Date.now());
          } else if (state.until) {
            state.until = Date.now() + state.remaining;
            startTimer(state);
          }
        }
      },
      tick(state) {
        if (destroyed || state.node.hasAttribute('data-paused')) return;
        state.remaining = state.held ? 0 : Math.max(0, state.until - Date.now());
        if (state.held || state.remaining > 0) return;
        const computed = window.getComputedStyle(state.node, '::after');
        const life = parseFloat(window.getComputedStyle(state.node).getPropertyValue('--toast-life')) || 0;
        const bar = parseFloat(computed.width) || 0;
        const host = state.node.offsetWidth;
        const left = bar > 1 ? (host ? life * (bar / host) : bar) : 0;
        if (left > 80) {
          state.until = Date.now() + Math.min(400, left);
          state.remaining = state.until - Date.now();
          return;
        }
        this.drop(state, false);
      },
      resync() {
        for (const state of this.items) {
          if (state.held) continue;
          const width = parseFloat(window.getComputedStyle(state.node, '::after').width);
          if (Number.isNaN(width)) continue;
          const fraction = Math.min(1, Math.max(0, width / (state.node.offsetWidth || 1)));
          const life = parseFloat(window.getComputedStyle(state.node).getPropertyValue('--toast-life')) || 0;
          state.until = Date.now() + life * fraction;
        }
      },
      syncCompact() {
        const limit = window.innerHeight * .6;
        let guard = this.items.length;
        while (this.items.length > 1 && guard-- > 0 && this.stackHeight() > limit) {
          if (!this.compactOldest()) break;
        }
      },
      stackHeight() {
        const gap = parseFloat(window.getComputedStyle(toastRegion).rowGap) || 0;
        return this.items.reduce((sum, state) => sum + state.node.getBoundingClientRect().height
          + (state.node === this.items.at(-1) ? 0 : gap), 0);
      },
      compactAll(relaxed) {
        const slots = Math.max(1, Math.min(TOAST_FULL_SLOTS,
          Math.floor(TOAST_BUDGET_PX / TOAST_ESTIMATED_FULL_PX)));
        const expanded = relaxed ? this.items : this.items.slice(-slots);
        for (const state of this.items) {
          const compact = !expanded.includes(state);
          state.node.classList.toggle('compact', compact);
          const copy = state.node.querySelector('.toast-copy');
          if (compact) copy.title = copy.textContent;
          else copy.removeAttribute('title');
        }
        this.syncCompact();
      },
      compactOldest() {
        const state = this.items.find((item) => !item.node.classList.contains('compact'));
        if (!state) return false;
        state.node.classList.add('compact');
        return true;
      },
    };

    function toast(message, variant = 'info') {
      const kind = variant === true ? 'error' : variant === false ? 'info' : variant;
      return createToast(message, { kind });
    }

    function updateUnreadUI(count = 0) {
      count = Math.max(0, count);
      const badge = count > 99 ? '99+' : String(count);
      newMessageJump.hidden = count === 0;
      newMessageCount.textContent = badge;
      document.title = count ? `(${badge}) Pavilo / 语亭` : 'Pavilo / 语亭';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#dceee9"/><g transform="scale(.25)"><path fill="#0f7772" d="M127 46C119 47 113 61 105 69C87 87 66 99 37 108C30 110 32 119 40 124L51 129V199C51 205 56 210 63 210H84L98 189C87 186 81 180 81 171V142C81 133 86 129 95 122C111 111 122 101 129 89C137 103 147 113 161 122C171 129 175 135 175 143V171C175 183 168 190 156 192H116C108 194 102 201 96 207C92 210 94 210 101 210H193C200 210 205 205 205 198V129L217 123C225 119 225 110 219 108C187 98 166 84 152 70L134 48C132 45 130 45 127 46Z"/>${count ? `<circle cx="200" cy="56" r="48" fill="#e86f57"/><text x="200" y="72" text-anchor="middle" font-size="40" font-family="sans-serif" font-weight="700" fill="white">${badge}</text>` : '<circle cx="196.7" cy="71.7" r="15.1" fill="#e86f57"/>'}</g></svg>`;
      appFavicon.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    function closeNative() {
      if (!nativeNotification) return;
      nativeNotification.onclick = null;
      nativeNotification.close();
      nativeNotification = null;
    }

    function clearUnread() {
      if (destroyed) return;
      updateUnreadUI(0);
      closeNative();
      onAction?.({ type: 'unread/clear' });
    }

    function canMarkRead() {
      return document.visibilityState === 'visible' && document.hasFocus()
        && messageScroll.scrollHeight - messageScroll.scrollTop - messageScroll.clientHeight < 90;
    }

    function maybeClearUnread() {
      if (!destroyed && canMarkRead()) clearUnread();
    }

    function notifyNewMessage(message, state) {
      if (message.author?.id === state.self?.id || canMarkRead()) return;
      const mentioned = message.mentions?.some((mention) => mention.id === state.self?.id);
      if (mentioned) createToast(`${message.author.username} 在频道中提到了你`, { title: '有人提到了你' });
      const Notification = window.Notification;
      if (typeof Notification !== 'function' || Notification.permission !== 'granted'
        || !document.hidden && document.hasFocus()) return;
      closeNative();
      try {
        nativeNotification = new Notification(mentioned ? '有人提到了你' : '语亭有新消息', {
          body: '回到房间查看', tag: 'pavilo-messages', renotify: false,
        });
        nativeNotification.onclick = () => {
          if (destroyed) return;
          window.focus();
          messageScroll.scrollTop = messageScroll.scrollHeight;
          clearUnread();
          nativeNotification?.close();
        };
      } catch {
        nativeNotification = null;
      }
    }

    function onState(next, event = {}, previous = lastState) {
      if (destroyed) return;
      lastState = next;
      if (!previous || next.unread !== previous.unread) updateUnreadUI(next.unread);
      if (!next.unread) closeNative();
      if (next.sync?.active) return;
      if (event.type === 'message' && event.message
        && (!event.roomEpoch || !next.room?.epoch || event.roomEpoch === next.room.epoch)) {
        const isNew = !previous?.messages?.some((message) => message.id === event.message.id);
        if (isNew && next.unread) notifyNewMessage(event.message, next);
        maybeClearUnread();
      } else if (event.type === 'historyEnd' && previous?.sync?.active) {
        // Deferred events were reduced already; replay only their notification effects.
        const known = new Set();
        const snapshot = (previous.sync.messages || []).filter((message) => {
          if (known.has(message.id)) return false;
          known.add(message.id);
          return true;
        }).sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0)
          || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
          .slice(-(next.maxMessages || 300));
        known.clear();
        for (const message of snapshot) known.add(message.id);
        for (const deferred of previous.sync.deferred || []) {
          if (deferred.roomEpoch && next.room?.epoch && deferred.roomEpoch !== next.room.epoch) continue;
          const message = deferred.type === 'message' ? deferred.message : null;
          const isNew = message && !known.has(message.id);
          if (['message', 'reaction'].includes(deferred.type)) {
            for (const id of deferred.removedIds || []) known.delete(id);
          }
          if (message) known.add(message.id);
          if (isNew && next.unread) notifyNewMessage(message, next);
        }
        maybeClearUnread();
      }
    }

    function layoutToasts() {
      toastStack.syncCompact();
      toastStack.resync();
    }

    listen(window, 'resize', layoutToasts);
    listen(document, 'visibilitychange', () => { if (!document.hidden) toastStack.resync(); });
    listen(newMessageJump, 'click', () => {
      messageScroll.scrollTo({ top: messageScroll.scrollHeight, behavior: 'smooth' });
      clearUnread();
    });
    listen(messageScroll, 'scroll', maybeClearUnread, { passive: true });
    listen(window, 'focus', maybeClearUnread);
    listen(document, 'visibilitychange', () => {
      if (document.hidden) {
        onAction?.({ type: 'typing/stop' });
        for (const state of toastStack.items) if (!state.held) state.until += APPEARANCE_BONUS;
      } else {
        toastStack.resync();
        maybeClearUnread();
      }
    });
    listen(notifyButton, 'click', async () => {
      const Notification = window.Notification;
      if (!window.isSecureContext || !('Notification' in window)) {
        toast('当前局域网地址不支持系统通知；页内、标题和图标提醒仍然有效。', true);
        return;
      }
      if (Notification.permission === 'denied') {
        toast('系统通知已被浏览器拒绝，请在网站设置中修改。', true);
        return;
      }
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (destroyed) return;
      if (permission === 'granted') {
        notifyButton.classList.add('active');
        notifyButton.title = '系统提醒已开启';
        notifyButton.setAttribute('aria-label', '系统提醒已开启');
        notifyButton.querySelector('.top-action-label').textContent = '提醒已开';
        toast('系统提醒已开启；只在页面不活跃时提醒。');
      } else {
        toast('未开启系统通知；页内提醒仍然有效。', true);
      }
    });

    updateUnreadUI(lastState.unread);
    if (!window.isSecureContext || !('Notification' in window)) {
      notifyButton.title = '系统提醒在当前地址不可用';
      notifyButton.setAttribute('aria-label', '系统提醒不可用，页内提醒仍然有效');
      notifyButton.querySelector('.top-action-label').textContent = '页内提醒';
    } else if (window.Notification.permission === 'granted') {
      notifyButton.classList.add('active');
      notifyButton.title = '系统提醒已开启';
      notifyButton.querySelector('.top-action-label').textContent = '提醒已开';
    } else if (window.Notification.permission === 'denied') {
      notifyButton.title = '系统提醒已被浏览器拒绝';
      notifyButton.querySelector('.top-action-label').textContent = '提醒已拒';
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      for (const timer of timeouts) window.clearTimeout(timer);
      for (const timer of intervals) window.clearInterval(timer);
      for (const id of frames) window.cancelAnimationFrame?.(id);
      timeouts.clear();
      intervals.clear();
      frames.clear();
      for (const node of nodes) node.remove();
      nodes.clear();
      toastStack.items.length = 0;
      closeNative();
    }

    return { toast, createToast, clearUnread, onState, canMarkRead, maybeClearUnread, destroy };
  }

  return { createNotifications };
});
