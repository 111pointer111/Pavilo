(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloComposer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_PENDING = 32;
  const MAX_PENDING_IMAGE_BYTES = 4_000_000;
  const TYPING_INTERVAL = 900;
  const TYPING_EXPIRY = 4_500;
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

  function createComposer({ elements, getState, dispatch, connection, pending, images,
    toast = () => {}, clearReply: onClearReply, getReplyTarget, setReplyTarget,
    getLimits = () => ({}), mentions }) {
    const { composer, composerText, sendButton, emojiButton, attachmentButton, imageInput,
      replyingBar, replyingName, replyingText, cancelReplyButton } = elements;
    // Resolve browser scheduling through an explicit element, never a DOM lookup.
    const clock = composerText.ownerDocument?.defaultView || globalThis;
    const now = () => (clock.Date || Date).now();
    const setTimer = (callback, delay) => clock.setTimeout(callback, delay);
    const clearTimer = (timer) => { if (timer != null) clock.clearTimeout(timer); };
    let replyTarget = null;
    const readReply = getReplyTarget || (() => replyTarget);
    const writeReply = setReplyTarget || ((message) => { replyTarget = message; });
    let typingTimer = null;
    let typingLastSent = 0;
    let composing = false;
    let imageProcessingCount = 0;
    let generation = 0;
    let bound = false;

    function currentChannel(state) {
      return (state.channels || []).find((c) => c.id === state.channelId) || null;
    }

    function isReadOnly(state = getState()) {
      return Boolean(currentChannel(state)?.readOnly);
    }

    function isReady(state = getState()) {
      return Boolean(state.connection?.joined && (!connection.isReady || connection.isReady()));
    }

    function send(command) {
      if (getState().channel?.switching || !isReady()) return false;
      try { return Boolean(connection.send(command)); } catch { return false; }
    }

    function paintReply(message) {
      if (replyingBar) replyingBar.hidden = !message;
      if (message) {
        if (replyingName) replyingName.textContent = message.author.username;
        if (replyingText) replyingText.textContent = message.kind === 'image' ? '图片' : message.text;
        composer.classList.add('has-reply');
      } else composer.classList.remove('has-reply');
    }

    function setReply(message) {
      if (!message) { clearReply(); return; }
      writeReply(message);
      paintReply(message);
      composerText.focus();
    }

    function clearReply() {
      writeReply(null);
      if (onClearReply) onClearReply();
      paintReply(null);
    }

    function update() {
      const state = getState();
      const switching = Boolean(state.channel?.switching);
      const readOnly = isReadOnly(state);
      const locked = switching || imageProcessingCount > 0;
      const ready = isReady(state);
      const sendingText = [...pending.values()].some((item) => item.kind === 'text' && item.status === 'sending');
      if (sendButton) sendButton.disabled = locked || readOnly || !composerText.value.trim() || !ready || sendingText;
      composerText.disabled = switching || readOnly;
      if (emojiButton) emojiButton.disabled = locked || readOnly;
      if (attachmentButton) attachmentButton.disabled = locked || readOnly || !ready;
      composer.classList.toggle('has-notice', readOnly);
      if (elements.channelReadonlyNotice) elements.channelReadonlyNotice.hidden = !readOnly;
      const maxTextLength = Number(getLimits()?.maxTextLength);
      if (Number.isFinite(maxTextLength) && maxTextLength > 0) composerText.maxLength = Math.floor(maxTextLength);
      composerText.style.height = 'auto';
      composerText.style.height = `${Math.min(composerText.scrollHeight, 145)}px`;
      paintReply(readReply());
      mentions?.update();
    }

    function scheduleTyping(active) {
      clearTimer(typingTimer);
      typingTimer = null;
      if (!isReady() || getState().channel?.switching || isReadOnly()) return;
      const elapsed = now() - typingLastSent;
      if (active && elapsed < TYPING_INTERVAL) {
        typingTimer = setTimer(() => scheduleTyping(true), TYPING_INTERVAL - elapsed);
        return;
      }
      if (active && !composerText.value.trim()) active = false;
      if (send({ type: 'typing', active })) typingLastSent = now();
      if (active) typingTimer = setTimer(() => scheduleTyping(false), TYPING_EXPIRY);
    }

    function stopTyping() {
      clearTimer(typingTimer);
      typingTimer = null;
      scheduleTyping(false);
    }

    // PendingQueue owns IDs, transport commands and ACK timers. The reducer gets
    // immutable display snapshots, never a live queue item or a timer handle.
    // The app may also bridge queue events: skip an already projected mutation.
    function projectPending(type, item) {
      const current = getState().pending?.[item.id];
      if (type === 'pending/remove') {
        if (current) dispatch({ type, id: item.id });
        return;
      }
      const { timer, ...snapshot } = item;
      if (type === 'pending/add') {
        if (!current) dispatch({ type, item: snapshot });
      } else if (current && Object.keys(snapshot).some((key) => current[key] !== snapshot[key])) {
        dispatch({ type, id: item.id, item: snapshot });
      }
    }

    function addPending(input) {
      const item = pending.add(input);
      projectPending('pending/add', item);
      return item;
    }

    function transmit(item) {
      const sent = pending.transmit(item.id, { send, isReady, roomEpoch: getState().room?.epoch, now });
      projectPending('pending/update', item);
      return sent;
    }

    function sendText() {
      if (composing) return false;
      const text = composerText.value.trim();
      if (!text) return false;
      const state = getState();
      if (state.channel?.switching) {
        toast('正在切换频道，草稿已保留。', true);
        return false;
      }
      if (isReadOnly(state)) {
        toast('这个频道是只读频道，无法发送消息。', true);
        return false;
      }
      if (!isReady(state)) {
        toast('连接尚未恢复，草稿已保留。', true);
        return false;
      }
      if (pending.size >= MAX_PENDING || [...pending.values()].some((item) => item.kind === 'text' && item.status === 'sending')) {
        toast('上一条文字仍在等待确认。', true);
        return false;
      }
      const selected = mentions?.getMentions() || [];
      const item = addPending({ kind: 'text', text, ...(selected.length ? { mentions: selected } : {}), replyToId: readReply()?.id,
        epoch: state.room?.epoch, status: 'sending', attempts: 1 });
      if (!transmit(item)) {
        pending.remove(item.id);
        projectPending('pending/remove', item);
        update();
        toast('发送失败，草稿已保留。', true);
        return false;
      }
      // The draft and reply remain until the app reconciles an ACK/canonical echo.
      stopTyping();
      mentions?.close();
      update();
      return true;
    }

    async function sendImage(file) {
      if (!file || !IMAGE_TYPES.has(file.type)) {
        if (file) toast('请选择 PNG、JPEG、GIF 或 WebP 图片。', true);
        return false;
      }
      const state = getState();
      if (state.channel?.switching || !isReady(state)) {
        toast('连接或频道切换尚未完成，暂时不能发送图片。', true);
        return false;
      }
      if (isReadOnly(state)) {
        toast('这个频道是只读频道，无法发送图片。', true);
        return false;
      }
      if (pending.size >= MAX_PENDING) {
        toast('待确认的图片较多，请稍后再试。', true);
        return false;
      }
      const sourceChannelId = state.channelId;
      const sourceEpoch = state.room?.epoch;
      const sourceGeneration = generation;
      imageProcessingCount += 1;
      update();
      try {
        const image = await images.prepareImage(file);
        if (sourceGeneration !== generation) return false;
        // Spend the budget on the encoded image, not a multi-megabyte source photo.
        const pendingImageBytes = [...pending.values()].reduce((total, item) => total + (item.image?.bytes || 0), 0);
        if (pending.size >= MAX_PENDING || pendingImageBytes + image.bytes > MAX_PENDING_IMAGE_BYTES) {
          toast('待确认的图片较多，请稍后再试。', true);
          return false;
        }
        const current = getState();
        if (current.channel?.switching || current.channelId !== sourceChannelId
          || current.room?.epoch !== sourceEpoch || !isReady(current)) {
          toast('图片处理完成，但频道状态已变化，请重新选择后发送。', true);
          return false;
        }
        const item = addPending({ kind: 'image', image, replyToId: readReply()?.id,
          epoch: current.room?.epoch, status: 'sending', attempts: 1 });
        transmit(item);
        if (readReply()?.id === item.replyToId) clearReply();
        return true;
      } catch (error) {
        if (sourceGeneration === generation) {
          const message = error.code === 'SOURCE_TOO_LARGE'
            ? '图片尺寸过高，请先裁剪后发送。'
            : error.code === 'GIF_TOO_LARGE'
              ? 'GIF 动图超过频道限制，请换一个更小的 GIF。'
              : error.code === 'ENCODE_TOO_LARGE'
                ? '图片内容较复杂，自动压缩后仍超过频道限制，请裁剪后重试。'
                : error.code === 'CANVAS_UNAVAILABLE'
                  ? '当前浏览器无法处理图片，请刷新页面或换用最新版 Chrome。'
                  : '图片无法读取，可能已损坏或格式不受支持。';
          toast(message, true);
        }
        return false;
      } finally {
        imageProcessingCount = Math.max(0, imageProcessingCount - 1);
        update();
      }
    }

    function onSubmit(event) { event.preventDefault(); sendText(); }
    function onInput() { update(); scheduleTyping(Boolean(composerText.value.trim())); }
    function onCompositionStart() { composing = true; }
    function onCompositionEnd() { composing = false; update(); }
    function onKeydown(event) {
      if (composing || event.isComposing || event.keyCode === 229) return;
      if (event.defaultPrevented || mentions?.handleKeydown(event)) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        composer.requestSubmit();
      }
    }
    function onImageChange() { sendImage(imageInput.files?.[0]); imageInput.value = ''; }
    function onAttachmentClick() { imageInput.click(); }
    const handlers = [
      [composer, 'submit', onSubmit], [composerText, 'input', onInput],
      [composerText, 'compositionstart', onCompositionStart], [composerText, 'compositionend', onCompositionEnd],
      [composerText, 'keydown', onKeydown], [composerText, 'blur', stopTyping],
      [imageInput, 'change', onImageChange], [attachmentButton, 'click', onAttachmentClick],
      [cancelReplyButton, 'click', clearReply],
    ];

    function bind() {
      if (!bound) {
        for (const [element, type, handler] of handlers) if (element) element.addEventListener(type, handler);
        bound = true;
      }
      update();
      return api;
    }

    function unbind() {
      if (bound) {
        for (const [element, type, handler] of handlers) if (element) element.removeEventListener(type, handler);
        bound = false;
      }
      generation += 1;
      composing = false;
      stopTyping();
      return api;
    }

    const api = { bind, unbind, update, sendText, sendImage, stopTyping, setReply, clearReply,
      get imageProcessingCount() { return imageProcessingCount; } };
    return api;
  }

  return { createComposer, MAX_PENDING, MAX_PENDING_IMAGE_BYTES, TYPING_INTERVAL, TYPING_EXPIRY };
});
