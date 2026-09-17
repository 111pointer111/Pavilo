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

  function imageFileFromList(list) {
    if (!list) return null;
    for (const file of list) if (file && IMAGE_TYPES.has(file.type)) return file;
    return null;
  }

  function imageFileFromClipboard(clipboard) {
    if (!clipboard) return null;
    const fromFiles = imageFileFromList(clipboard.files);
    if (fromFiles) return fromFiles;
    const items = clipboard.items;
    if (!items) return null;
    for (const item of items) {
      if (item.kind === 'file' && IMAGE_TYPES.has(item.type)) {
        const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
        if (file) return file;
      }
    }
    return null;
  }

  function hasFileDrag(event) {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    if (typeof types.includes === 'function') return types.includes('Files');
    return Array.from(types).includes('Files');
  }

  function isForeignField(target, composerText) {
    if (!target || target === composerText) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(target.isContentEditable);
  }

  function createComposer({ elements, getState, dispatch, connection, pending, images,
    toast = () => {}, clearReply: onClearReply, getReplyTarget, setReplyTarget,
    getLimits = () => ({}), mentions, t = (key) => key, canCapturePaste,
    openLocalPreview, closeLocalPreview }) {
    const { composer, composerText, sendButton, emojiButton, attachmentButton, imageInput,
      replyingBar, replyingName, replyingText, cancelReplyButton } = elements;
    // Resolve browser scheduling through an explicit element, never a DOM lookup.
    const clock = composerText.ownerDocument?.defaultView || globalThis;
    const document = composerText.ownerDocument || clock.document;
    const urls = clock.URL || globalThis.URL;
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
    let attachment = null;
    let dragDepth = 0;

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

    function createPreview(file) {
      try { return urls && typeof urls.createObjectURL === 'function' ? urls.createObjectURL(file) : ''; }
      catch { return ''; }
    }

    function revokePreview(url) {
      if (!url || !String(url).startsWith('blob:')) return;
      try { urls?.revokeObjectURL?.(url); } catch { /* ignore revoke failures on detached documents */ }
    }

    function imageErrorCopy(error) {
      return error?.code === 'SOURCE_TOO_LARGE' ? t('toast.imageSourceLarge')
        : error?.code === 'GIF_TOO_LARGE' ? t('toast.imageGifLarge')
          : error?.code === 'ENCODE_TOO_LARGE' ? t('toast.imageEncodeLarge')
            : error?.code === 'CANVAS_UNAVAILABLE' ? t('toast.imageCanvas')
              : t('toast.imageUnreadable');
    }

    function paintReply(message) {
      if (replyingBar) replyingBar.hidden = !message;
      if (message) {
        if (replyingName) replyingName.textContent = message.author.username;
        if (replyingText) replyingText.textContent = message.kind === 'image' ? (message.text || t('reply.image')) : message.text;
        composer.classList.add('has-reply');
      } else composer.classList.remove('has-reply');
    }

    function paintAttachment() {
      const bar = elements.composerAttach;
      if (!bar) return;
      const present = Boolean(attachment);
      bar.hidden = !present;
      bar.classList.toggle('is-preparing', attachment?.status === 'preparing');
      bar.classList.toggle('is-error', attachment?.status === 'error');
      composer.classList.toggle('has-attach', present);
      const img = elements.composerAttachImage;
      if (img) {
        const src = attachment?.image?.src || attachment?.previewUrl || '';
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.alt = present ? t('attach.preview') : '';
      }
      if (elements.composerAttachThumb) {
        elements.composerAttachThumb.setAttribute('aria-label', t('attach.preview'));
        elements.composerAttachThumb.disabled = !present;
      }
      if (elements.composerAttachRemove) {
        elements.composerAttachRemove.setAttribute('aria-label', t('attach.remove'));
        elements.composerAttachRemove.hidden = !present;
      }
      if (elements.composerAttachLabel) {
        elements.composerAttachLabel.textContent = attachment?.status === 'error' ? t('attach.error')
          : attachment?.status === 'preparing' ? t('attach.preparing')
            : present ? t('attach.ready') : '';
      }
      if (elements.composerAttachHint) {
        elements.composerAttachHint.textContent = attachment?.status === 'error'
          ? (attachment.error || t('attach.error')) : '';
      }
      if (elements.composerAttachStatus) {
        elements.composerAttachStatus.hidden = attachment?.status !== 'preparing';
      }
      if (elements.composerAttachRetry) {
        elements.composerAttachRetry.hidden = attachment?.status !== 'error';
        elements.composerAttachRetry.textContent = t('attach.retry');
      }
    }

    function paintDrop(active) {
      const overlay = elements.composerDrop;
      if (!overlay) return;
      overlay.hidden = !active;
      overlay.setAttribute('aria-hidden', String(!active));
      (elements.composerWrap || composer)?.classList.toggle('is-dropping', active);
      elements.messageScroll?.classList.toggle('is-dropping', active);
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

    function clearAttachment() {
      generation += 1;
      if (attachment?.previewUrl) revokePreview(attachment.previewUrl);
      attachment = null;
      closeLocalPreview?.();
      paintAttachment();
      paintDrop(false);
      dragDepth = 0;
      update();
    }

    function update() {
      const state = getState();
      const switching = Boolean(state.channel?.switching);
      const readOnly = isReadOnly(state);
      const ready = isReady(state);
      const sendingText = [...pending.values()].some((item) => item.kind === 'text' && item.status === 'sending');
      const sendingCaption = [...pending.values()].some((item) => item.kind === 'image' && item.status === 'sending' && item.text && item.text === composerText.value.trim());
      const hasText = Boolean(composerText.value.trim());
      const attachmentReady = attachment?.status === 'ready';
      const preparing = attachment?.status === 'preparing';
      const canSendImage = attachmentReady && !switching && !readOnly && ready;
      const canSendText = hasText && !switching && !readOnly && ready && !sendingText && !sendingCaption;
      if (sendButton) sendButton.disabled = switching || readOnly || !ready || preparing || !(canSendImage || (!attachmentReady && canSendText));
      composerText.disabled = switching || readOnly;
      if (emojiButton) emojiButton.disabled = switching || readOnly;
      if (attachmentButton) attachmentButton.disabled = switching || readOnly || !ready;
      composer.classList.toggle('has-notice', readOnly);
      if (elements.channelReadonlyNotice) elements.channelReadonlyNotice.hidden = !readOnly;
      const maxTextLength = Number(getLimits()?.maxTextLength);
      if (Number.isFinite(maxTextLength) && maxTextLength > 0) composerText.maxLength = Math.floor(maxTextLength);
      composerText.style.height = 'auto';
      composerText.style.height = `${Math.min(composerText.scrollHeight, 145)}px`;
      paintReply(readReply());
      paintAttachment();
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
        toast(t('toast.channelSwitchingDraft'), true);
        return false;
      }
      if (isReadOnly(state)) {
        toast(t('toast.readOnlyText'), true);
        return false;
      }
      if (!isReady(state)) {
        toast(t('toast.notReadyDraft'), true);
        return false;
      }
      if (pending.size >= MAX_PENDING || [...pending.values()].some((item) => item.kind === 'text' && item.status === 'sending')) {
        toast(t('toast.pendingText'), true);
        return false;
      }
      const selected = mentions?.getMentions() || [];
      const item = addPending({ kind: 'text', text, ...(selected.length ? { mentions: selected } : {}), replyToId: readReply()?.id,
        epoch: state.room?.epoch, status: 'sending', attempts: 1 });
      if (!transmit(item)) {
        pending.remove(item.id);
        projectPending('pending/remove', item);
        update();
        toast(t('toast.sendFailedDraft'), true);
        return false;
      }
      // The draft and reply remain until the app reconciles an ACK/canonical echo.
      stopTyping();
      mentions?.close();
      update();
      return true;
    }

    function sendStaged() {
      if (attachment?.status !== 'ready' || !attachment.image) return false;
      const state = getState();
      if (state.channel?.switching || !isReady(state)) {
        toast(t('toast.imageNotReady'), true);
        return false;
      }
      if (isReadOnly(state)) {
        toast(t('toast.readOnlyImage'), true);
        return false;
      }
      const pendingImageBytes = [...pending.values()].reduce((total, item) => total + (item.image?.bytes || 0), 0);
      if (pending.size >= MAX_PENDING || pendingImageBytes + attachment.image.bytes > MAX_PENDING_IMAGE_BYTES) {
        toast(t('toast.imageQueue'), true);
        return false;
      }
      const text = composerText.value.trim();
      const selected = text ? (mentions?.getMentions() || []) : [];
      const item = addPending({
        kind: 'image',
        image: attachment.image,
        ...(text ? { text, ...(selected.length ? { mentions: selected } : {}) } : {}),
        replyToId: readReply()?.id,
        epoch: state.room?.epoch,
        status: 'sending',
        attempts: 1,
      });
      transmit(item);
      if (readReply()?.id === item.replyToId) clearReply();
      clearAttachment();
      if (text) {
        stopTyping();
        mentions?.close();
      }
      update();
      return true;
    }

    function sendAll() {
      if (composing) return false;
      if (attachment?.status === 'preparing') return false;
      if (attachment?.status === 'ready') return sendStaged();
      return sendText();
    }

    async function prepareAttachment(file, token) {
      imageProcessingCount += 1;
      update();
      try {
        const image = await images.prepareImage(file);
        if (token !== generation || !attachment || attachment.token !== token) return false;
        const current = getState();
        if (current.channel?.switching || current.channelId !== attachment.channelId
          || current.room?.epoch !== attachment.epoch || !isReady(current)) {
          attachment.status = 'error';
          attachment.error = t('toast.imageStale');
          paintAttachment();
          toast(t('toast.imageStale'), true);
          return false;
        }
        attachment.status = 'ready';
        attachment.image = image;
        attachment.error = '';
        if (attachment.previewUrl && image.src) {
          revokePreview(attachment.previewUrl);
          attachment.previewUrl = '';
        }
        paintAttachment();
        update();
        return true;
      } catch (error) {
        if (token !== generation || !attachment || attachment.token !== token) return false;
        attachment.status = 'error';
        attachment.error = imageErrorCopy(error);
        paintAttachment();
        toast(attachment.error, true);
        update();
        return false;
      } finally {
        imageProcessingCount = Math.max(0, imageProcessingCount - 1);
        update();
      }
    }

    async function stageImage(file) {
      if (!file || !IMAGE_TYPES.has(file.type)) {
        if (file) toast(t('toast.imageType'), true);
        return false;
      }
      const state = getState();
      if (state.channel?.switching || !isReady(state)) {
        toast(t('toast.imageNotReady'), true);
        return false;
      }
      if (isReadOnly(state)) {
        toast(t('toast.readOnlyImage'), true);
        return false;
      }
      if (attachment) {
        generation += 1;
        revokePreview(attachment.previewUrl);
        closeLocalPreview?.();
        attachment = null;
      }
      const token = generation;
      attachment = {
        status: 'preparing',
        file,
        previewUrl: createPreview(file),
        image: null,
        error: '',
        channelId: state.channelId,
        epoch: state.room?.epoch,
        token,
      };
      paintAttachment();
      update();
      return prepareAttachment(file, token);
    }

    function retryAttachment() {
      if (!attachment?.file || attachment.status !== 'error') return false;
      const file = attachment.file;
      const previewUrl = attachment.previewUrl;
      const token = generation;
      attachment = {
        ...attachment,
        status: 'preparing',
        image: null,
        error: '',
        token,
        previewUrl,
      };
      paintAttachment();
      return prepareAttachment(file, token);
    }

    function onSubmit(event) { event.preventDefault(); sendAll(); }
    function onInput() { update(); scheduleTyping(Boolean(composerText.value.trim())); }
    function onCompositionStart() { composing = true; }
    function onCompositionEnd() { composing = false; update(); }
    function onKeydown(event) {
      if (composing || event.isComposing || event.keyCode === 229) return;
      if (event.defaultPrevented || mentions?.handleKeydown(event)) return;
      if ((event.key === 'Backspace' || event.key === 'Delete') && attachment
        && !composerText.value && (composerText.selectionStart || 0) === 0) {
        event.preventDefault();
        clearAttachment();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        composer.requestSubmit();
      }
    }
    function onImageChange() { stageImage(imageInput.files?.[0]); imageInput.value = ''; }
    function onAttachmentClick() { imageInput.click(); }
    function onRemoveAttachment() { clearAttachment(); }
    function onRetryAttachment() { retryAttachment(); }
    function onPreviewAttachment() {
      if (!attachment) return;
      if (attachment.status === 'error') {
        retryAttachment();
        return;
      }
      const src = attachment.image?.src || attachment.previewUrl;
      if (!src) return;
      openLocalPreview?.({
        src,
        width: attachment.image?.width,
        height: attachment.image?.height,
      }, elements.composerAttachThumb);
    }

    function pasteAllowed() {
      if (typeof canCapturePaste === 'function') return canCapturePaste();
      return !elements.appShell?.hidden;
    }

    function onPaste(event) {
      if (!pasteAllowed() || isForeignField(event.target, composerText)) return;
      const file = imageFileFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      stageImage(file);
    }

    function onDragEnter(event) {
      if (!hasFileDrag(event) || !pasteAllowed()) return;
      dragDepth += 1;
      event.preventDefault();
      paintDrop(true);
    }

    function onDragOver(event) {
      if (!hasFileDrag(event) || !pasteAllowed()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      paintDrop(true);
    }

    function onDragLeave(event) {
      if (!hasFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) paintDrop(false);
    }

    function onDrop(event) {
      dragDepth = 0;
      paintDrop(false);
      if (!pasteAllowed()) return;
      const file = imageFileFromList(event.dataTransfer?.files);
      if (!file) return;
      event.preventDefault();
      stageImage(file);
    }

    const handlers = [
      [composer, 'submit', onSubmit], [composerText, 'input', onInput],
      [composerText, 'compositionstart', onCompositionStart], [composerText, 'compositionend', onCompositionEnd],
      [composerText, 'keydown', onKeydown], [composerText, 'blur', stopTyping],
      [imageInput, 'change', onImageChange], [attachmentButton, 'click', onAttachmentClick],
      [cancelReplyButton, 'click', clearReply],
      [elements.composerAttachRemove, 'click', onRemoveAttachment],
      [elements.composerAttachThumb, 'click', onPreviewAttachment],
      [elements.composerAttachRetry, 'click', onRetryAttachment],
      [document, 'paste', onPaste],
      [elements.composerWrap, 'dragenter', onDragEnter],
      [elements.composerWrap, 'dragover', onDragOver],
      [elements.composerWrap, 'dragleave', onDragLeave],
      [elements.composerWrap, 'drop', onDrop],
      [elements.messageScroll, 'dragenter', onDragEnter],
      [elements.messageScroll, 'dragover', onDragOver],
      [elements.messageScroll, 'dragleave', onDragLeave],
      [elements.messageScroll, 'drop', onDrop],
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
      composing = false;
      stopTyping();
      clearAttachment();
      return api;
    }

    const api = { bind, unbind, update, sendText, sendAll, stageImage, sendStaged, clearAttachment,
      stopTyping, setReply, clearReply,
      get imageProcessingCount() { return imageProcessingCount; },
      get hasAttachment() { return Boolean(attachment); } };
    return api;
  }

  return { createComposer, MAX_PENDING, MAX_PENDING_IMAGE_BYTES, TYPING_INTERVAL, TYPING_EXPIRY, IMAGE_TYPES };
});
