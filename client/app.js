(() => {
  'use strict';

  const { PROTOCOL_VERSION, parseServerEvent, DEFERRED_EVENTS } = PaviloProtocol;
  const store = PaviloState.createStore();
  const pendingQueue = PaviloPending.createPendingQueue();
  const { draftMatches } = PaviloPending;
  let maxImageBytes = 300_000;
  let maxImagePixels = 4_000_000;
  let maxGifDimension = 1_600;
  let roomInfo = null;
  let roomInfoReady = false;
  let roomInfoPromise = null;
  let roomInfoRetryTimer = null;
  let roomChannels = [];
  let selectedChannelId = null;
  let identity = null;
  let resumeToken = null;
  let resumeWatchdog = null;
  let reconnectingAfterClose = false;
  let replyTarget = null;
  let leaveTimer = null;
  let channelRenderKey = '';
  let composerPopoverOpen = false;

  const $ = (selector) => document.querySelector(selector);
  const loginScreen = $('#loginScreen');
  const appShell = $('#appShell');
  const loginForm = $('#loginForm');
  const usernameInput = $('#usernameInput');
  const loginError = $('#loginError');
  const connectionDot = $('#connectionDot');
  const connectionText = $('#connectionText');
  const messageScroll = $('#messageScroll');
  const messageList = $('#messageList');
  const messageCount = $('#messageCount');
  const newMessageJump = $('#newMessageJump');
  const channelList = $('#channelList');
  const mobileChannelPicker = $('#mobileChannelPicker');
  const channelDescription = $('#channelDescription');
  const typingLine = $('#typingLine');
  const composer = $('#composer');
  const composerText = $('#composerText');
  const emojiButton = $('#emojiButton');
  const composerPopover = $('#composerPopover');
  const composerPicker = $('#composerPicker');
  const copyLinkButton = $('#copyLinkButton');
  const leaveButton = $('#leaveButton');

  function storage() {
    try { return sessionStorage; } catch { return null; }
  }

  function iconMarkup(name, size) {
    const inner = globalThis.lucideCreateIcon?.(name) || '';
    if (!inner) return '';
    const dimension = size ? ` style="width:${size}px;height:${size}px"` : '';
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${dimension}>${inner}</svg>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character]));
  }

  const avatarColors = [
    ['#dceee9', '#0f7772', '#f4c85f'],
    ['#fbe4dc', '#b34d46', '#e86f57'],
    ['#fff3c8', '#8a6530', '#f0a647'],
    ['#e3e8f3', '#4a5f88', '#8299c4'],
    ['#e8e3f0', '#6f4c82', '#b28ac4'],
    ['#e2eee0', '#4d754d', '#9abe79'],
  ];

  function hashSeed(seed, salt = 0) {
    let value = (Number(seed) >>> 0) + salt * 2_654_435_761;
    value = Math.imul(value ^ value >>> 16, 2_246_828_519);
    value = Math.imul(value ^ value >>> 13, 3_266_489_917);
    return (value ^ value >>> 16) >>> 0;
  }

  function avatarMarkup(user = {}, sizeClass = '', interactive = true) {
    const seed = hashSeed(user.avatarSeed);
    const colors = avatarColors[seed % avatarColors.length];
    const x = 16 + hashSeed(seed, 1) % 8;
    const y = 15 + hashSeed(seed, 2) % 7;
    const tilt = hashSeed(seed, 3) % 18 - 9;
    const eyeOffset = hashSeed(seed, 4) % 3 - 1;
    const initial = escapeHtml((user.username || '?').slice(0, 1).toUpperCase());
    const tag = interactive ? 'button' : 'span';
    const attributes = interactive
      ? ` type="button" data-user-id="${escapeHtml(user.id || '')}" aria-label="查看 ${escapeHtml(user.username || '?')} 的个人信息"`
      : ' aria-hidden="true"';
    return `<${tag} class="avatar ${sizeClass}"${attributes} style="--avatar-bg:${colors[0]};--avatar-ink:${colors[1]};--avatar-accent:${colors[2]}">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="12" fill="var(--avatar-bg)"/>
        <path d="M-3 40C8 27 14 29 23 36s17 6 28-7v22H-3Z" fill="var(--avatar-accent)" opacity=".66"/>
        <path d="M${x - 10} ${y + 13}c0-10 7-16 14-16s14 6 14 16c0 8-6 13-14 13s-14-5-14-13Z" fill="var(--avatar-ink)" opacity=".92" transform="rotate(${tilt} 24 24)"/>
        <circle cx="${x - 4 + eyeOffset}" cy="${y + 1}" r="1.8" fill="var(--avatar-bg)"/>
        <circle cx="${x + 5 + eyeOffset}" cy="${y + 1}" r="1.8" fill="var(--avatar-bg)"/>
        <path d="M${x - 3} ${y + 8}q3 3 6 0" fill="none" stroke="var(--avatar-bg)" stroke-linecap="round" stroke-width="1.6"/>
        <text x="39" y="11" fill="var(--avatar-ink)" font-family="sans-serif" font-size="7" font-weight="800" text-anchor="middle">${initial}</text>
      </svg>
    </${tag}>`;
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(timestamp));
  }

  function formatDay(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const key = date.toLocaleDateString('zh-CN');
    if (key === today.toLocaleDateString('zh-CN')) return '今天';
    if (key === yesterday.toLocaleDateString('zh-CN')) return '昨天';
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }

  function formatDuration(joinedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - joinedAt) / 1_000));
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    return `${hours} 小时 ${minutes % 60} 分钟`;
  }

  function positiveLimit(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function channelById(channelId) {
    return roomChannels.find((channel) => channel.id === channelId) || null;
  }

  function setConnection(online, label) {
    connectionDot.classList.toggle('offline', !online);
    connectionText.textContent = label;
  }

  function showChat() {
    appShell.hidden = false;
    appShell.setAttribute('aria-hidden', 'false');
    loginScreen.hidden = true;
    loginScreen.setAttribute('aria-hidden', 'true');
    document.body.classList.add('chat-active');
  }

  function showLogin(message = '', focus = true) {
    appShell.hidden = true;
    appShell.setAttribute('aria-hidden', 'true');
    loginScreen.hidden = false;
    loginScreen.setAttribute('aria-hidden', 'false');
    document.body.classList.remove('chat-active', 'sheet-open', 'viewer-open');
    loginError.textContent = message;
    loginForm.querySelector('.enter-button').disabled = false;
    loginError.textContent = message;
    if (focus) usernameInput.focus();
  }

  function finishResume() {
    if (resumeWatchdog) window.clearTimeout(resumeWatchdog);
    resumeWatchdog = null;
    document.documentElement.classList.remove('resuming');
  }

  function renderChannelChrome(state = store.getState()) {
    const channel = channelById(state.channelId || selectedChannelId);
    $('#roomTitle').textContent = roomInfo?.roomTitle || '语亭 · 临时频道';
    if (!channel) return;
    $('#roomHeading').textContent = `${channel.name} · ${channel.id}`;
    const channelIndex = roomChannels.indexOf(channel);
    const totalChannels = roomChannels.length;
    if (totalChannels > 1) {
      $('#roomKicker').textContent = `频道 ${channelIndex + 1} / ${totalChannels}`;
    } else {
      $('#roomKicker').textContent = '临时房间';
    }
    channelDescription.textContent = channel.description || '同一 Wi‑Fi 的人可以看见这里';
  }

  function updateChannelOccupancy(state = store.getState()) {
    for (const channel of roomChannels) {
      const meta = channelList.querySelector(`[data-channel-id="${CSS.escape(channel.id)}"] .channel-meta`);
      if (!meta || !channel.enabled) continue;
      const online = state.channelOccupancy?.[channel.id];
      const known = Number.isSafeInteger(online) && online >= 0;
      const count = known ? online : 0;
      const full = known && count >= channel.maxUsers;
      meta.classList.toggle('occupied', known && count > 0 && !full);
      meta.classList.toggle('full', full);
      meta.setAttribute('aria-label', known
        ? `${count} 人在线，最多 ${channel.maxUsers} 人${full ? '，已满' : ''}`
        : `在线人数同步中，最多 ${channel.maxUsers} 人`);
      meta.title = known ? `${count} 人在线 / 最多 ${channel.maxUsers} 人${full ? ' · 已满' : ''}` : '在线人数同步中';
      meta.innerHTML = `${iconMarkup('users-round', 12)}<span class="channel-meta-value"><strong>${known ? count : '–'}</strong><span aria-hidden="true">/</span><span>${channel.maxUsers}</span></span>`;
    }
  }

  function renderChannels(state = store.getState()) {
    const channelId = state.channelId || selectedChannelId;
    const switching = Boolean(state.channel?.switching);
    const joined = Boolean(state.connection?.joined);
    const enabledCount = roomChannels.filter((channel) => channel.enabled).length;
    const channelCountEl = $('#channelCount');
    if (enabledCount > 1) {
      channelCountEl.textContent = `${enabledCount} 个`;
      channelCountEl.hidden = false;
    } else {
      channelCountEl.hidden = true;
    }
    channelList.replaceChildren(...roomChannels.map((channel) => {
      const button = document.createElement('button');
      const active = channel.id === channelId;
      button.className = `channel${active ? ' active' : ''}`;
      button.dataset.channelId = channel.id;
      button.type = 'button';
      button.disabled = switching || !channel.enabled;
      button.title = !channel.enabled ? `${channel.name}（已停用）` : channel.description || channel.name;
      button.setAttribute('aria-current', active ? 'page' : 'false');
      button.innerHTML = `<span class="channel-hash">#</span><span class="channel-name">${escapeHtml(channel.name)} · ${escapeHtml(channel.id)}</span><span class="channel-meta${channel.enabled ? '' : ' unavailable'}">${channel.enabled ? '' : '停用'}</span>`;
      button.addEventListener('click', () => switchChannel(channel.id));
      return button;
    }));
    mobileChannelPicker.replaceChildren(...roomChannels.map((channel) => {
      const option = document.createElement('option');
      option.value = channel.id;
      option.disabled = !channel.enabled;
      option.textContent = `${channel.name} · ${channel.id}${channel.enabled ? '' : '（已停用）'}`;
      return option;
    }));
    if (channelId) mobileChannelPicker.value = channelId;
    mobileChannelPicker.disabled = switching || !joined || !roomChannels.some((channel) => channel.enabled);
    updateChannelOccupancy(state);
    renderChannelChrome(state);
    channelRenderKey = `${channelId || ''}|${switching}|${joined}|${roomChannels.length}`;
  }

  function applyRoomInfo(info) {
    if (!info || typeof info.defaultChannelId !== 'string' || !Array.isArray(info.channels)) throw new Error('invalid room info');
    const channels = info.channels.filter((channel) => channel && typeof channel.id === 'string' && typeof channel.name === 'string');
    const defaultChannel = channels.find((channel) => channel.id === info.defaultChannelId && channel.enabled);
    if (!defaultChannel) throw new Error('invalid default channel');
    roomInfo = info;
    roomChannels = channels;
    maxImageBytes = positiveLimit(info.limits?.maxImageBytes, maxImageBytes);
    maxImagePixels = positiveLimit(info.limits?.maxImagePixels, maxImagePixels);
    maxGifDimension = positiveLimit(info.limits?.maxImageDimension, maxGifDimension);
    const saved = channelById(connection.readChannelId());
    if (!selectedChannelId || !channelById(selectedChannelId)?.enabled) selectedChannelId = saved?.enabled ? saved.id : defaultChannel.id;
    roomInfoReady = true;
    store.dispatch({ type: 'room/info', channels, limits: info.limits || {} });
    renderChannels();
    composerController?.update();
  }

  function scheduleRoomInfoRetry() {
    if (roomInfoRetryTimer || store.getState().connection.intentionalLeave) return;
    roomInfoRetryTimer = window.setTimeout(() => {
      roomInfoRetryTimer = null;
      loadRoomInfo().then((info) => { if (info && identity && !connection.isReady()) connection.connect(identity); });
    }, 2_000);
  }

  function loadRoomInfo() {
    if (roomInfoReady) return Promise.resolve(roomInfo);
    if (roomInfoPromise) return roomInfoPromise;
    roomInfoPromise = fetch('/room-info', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`room info ${response.status}`);
        return response.json();
      })
      .then((info) => {
        applyRoomInfo(info);
        loginError.textContent = '';
        return info;
      })
      .catch(() => {
        roomInfoReady = false;
        setConnection(false, '无法读取频道配置，准备重试…');
        loginError.textContent = '暂时无法读取频道配置，请稍后重试。';
        loginForm.querySelector('.enter-button').disabled = false;
        scheduleRoomInfoRetry();
        return null;
      })
      .finally(() => { roomInfoPromise = null; });
    return roomInfoPromise;
  }

  function checkHealth() {
    return fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
      .then((response) => response.ok)
      .catch(() => false);
  }

  function renderTyping(state = store.getState()) {
    const names = Object.entries(state.typing || {})
      .filter(([id]) => id !== state.self?.id)
      .map(([, item]) => item.username)
      .filter(Boolean);
    if (!names.length) typingLine.textContent = '';
    else if (names.length === 1) typingLine.textContent = `${names[0]} 正在输入…`;
    else typingLine.textContent = `${names.slice(0, 2).join('、')}${names.length > 2 ? '等' : ''}正在输入…`;
  }

  function pendingSnapshot(item) {
    if (!item) return null;
    const { timer, ...snapshot } = item;
    return snapshot;
  }

  function clearDraftFor(item) {
    if (!item || item.kind !== 'text' || !draftMatches(item, composerText.value)) return;
    composerText.value = '';
    mentionController.clear();
    if (replyTarget?.id === item.replyToId) composerController?.clearReply();
    composerController?.update();
  }

  function bridgePendingEvent(event) {
    const item = event.item;
    if (event.type === 'added') {
      const snapshot = pendingSnapshot(item);
      if (snapshot) store.dispatch({ type: 'pending/add', item: snapshot });
      return;
    }
    if (event.type === 'rekeyed') {
      if (event.oldId) store.dispatch({ type: 'pending/remove', id: event.oldId });
      const snapshot = pendingSnapshot(item);
      if (snapshot) store.dispatch({ type: 'pending/add', item: snapshot });
      return;
    }
    if (event.type === 'removed') {
      if (item) store.dispatch({ type: 'pending/remove', id: item.id });
      if (event.canonical) clearDraftFor(item);
      return;
    }
    if (event.type === 'reconciled') {
      clearDraftFor(item);
      return;
    }
    if (['changed', 'accepted'].includes(event.type)) {
      const snapshot = pendingSnapshot(item);
      if (snapshot) store.dispatch({ type: 'pending/update', id: item.id, item: snapshot });
      if (event.type === 'accepted') clearDraftFor(item);
    }
  }

  pendingQueue.subscribe(bridgePendingEvent);

  const imagePipeline = PaviloImages.createImages({ getLimits: () => ({
    maxImageBytes,
    maxImageDimension: maxGifDimension,
    maxImagePixels,
  }) });

  function identityForJoin() {
    const state = store.getState();
    const current = state.self || identity || {};
    return {
      username: current.username || usernameInput.value.trim(),
      avatarSeed: current.avatarSeed,
      resumeToken: state.room?.resumeToken || resumeToken || current.resumeToken,
      channelId: state.channelId || selectedChannelId || roomInfo?.defaultChannelId,
    };
  }

  const connection = PaviloConnection.createConnection({
    location: window.location,
    storage: storage(),
    online: () => navigator.onLine !== false,
    getIdentity: identityForJoin,
  });

  function positionPopover(popover, anchor, heightHint) {
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth || 344;
    const height = popover.offsetHeight || heightHint;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function closeComposerPopover(restoreFocus = false) {
    if (!composerPopoverOpen) return;
    composerPopover.hidden = true;
    composerPopoverOpen = false;
    emojiButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) emojiButton.focus();
  }

  function openComposerPopover() {
    if (composerPopoverOpen) {
      closeComposerPopover();
      return;
    }
    messagesController?.closeReactionPopover();
    mentionController.close();
    composerPopover.hidden = false;
    composerPopoverOpen = true;
    emojiButton.setAttribute('aria-expanded', 'true');
    positionPopover(composerPopover, emojiButton, 360);
    queueMicrotask(() => {
      const input = composerPicker.shadowRoot?.querySelector('input[type="search"]');
      if (input) input.focus();
      else composerPicker.focus?.();
    });
  }

  function findMessage(id) {
    return store.getState().messages.find((message) => message.id === id) || null;
  }

  function retryPending(id) {
    if (!id || !pendingQueue.get(id)) return false;
    return pendingQueue.retry(id, {
      roomEpoch: store.getState().room?.epoch,
      send: (command) => connection.send(command),
      isReady: () => connection.isReady(),
      now: Date.now,
    });
  }

  function handleModularAction(action) {
    if (!action) return;
    if (action.type === 'retry') return retryPending(action.pendingId);
    if (action.type === 'image') return overlaysController?.openImageViewer(action.messageId, action.anchor);
    if (action.type === 'profile') {
      if (!store.getState().users.some((user) => user.id === action.userId)) return notificationsController.toast('这位成员已离开当前频道。');
      return overlaysController?.openProfile(action.userId, action.anchor);
    }
    if (action.type === 'reply') {
      const message = findMessage(action.messageId);
      if (message) composerController?.setReply(message);
      return;
    }
    if (action.type === 'reaction') return connection.send({ type: 'reaction', messageId: action.messageId, emoji: action.emoji, active: action.active });
    if (action.type === 'unread/clear') return notificationsController?.clearUnread();
    if (action.type === 'typing/stop') return composerController?.stopTyping();
  }

  const controllerElements = {
    messageList, messageScroll, messageCount,
    reactionPopover: $('#reactionPopover'), reactionChoices: $('#reactionChoices'),
    mentionPopover: $('#mentionPopover'), mentionList: $('#mentionList'), mentionButton: $('#mentionButton'), mentionStatus: $('#mentionStatus'),
    peopleList: $('#peopleList'), mobilePeopleList: $('#mobilePeopleList'), peopleCount: $('#peopleCount'),
    profile: $('#profile'), profileEmpty: $('#profileEmpty'), profileAvatar: $('#profileAvatar'), profileName: $('#profileName'),
    profileYou: $('#profileYou'), profileIp: $('#profileIp'), profileDuration: $('#profileDuration'), profileJoined: $('#profileJoined'),
    mobileProfile: $('#mobileProfile'), mobileSheet: $('#mobileSheet'), mobileSheetBackdrop: $('#mobileSheetBackdrop'),
    membersButton: $('#membersButton'), mobileSheetClose: $('#mobileSheetClose'), imageViewer: $('#imageViewer'), viewerImage: $('#viewerImage'),
    viewerStage: $('#viewerStage'), viewerStatus: $('#viewerStatus'), viewerZoomLabel: $('#viewerZoomLabel'), viewerZoomIn: $('#viewerZoomIn'),
    viewerZoomOut: $('#viewerZoomOut'), viewerAuthor: $('#viewerAuthor'), viewerAvatar: $('#viewerAvatar'), viewerWhen: $('#viewerWhen'),
    viewerDimension: $('#viewerDimension'), viewerPrev: $('#viewerPrev'), viewerNext: $('#viewerNext'), viewerIndex: $('#viewerIndex'),
    viewerDownload: $('#viewerDownload'), viewerRotate: $('#viewerRotate'), viewerReset: $('#viewerReset'), viewerClose: $('#viewerClose'),
    toastRegion: $('#toastRegion'), newMessageJump, newMessageCount: $('#newMessageCount'), notifyButton: $('#notifyButton'), appFavicon: $('#appFavicon'),
    composer, composerText, sendButton: $('#sendButton'), emojiButton, attachmentButton: $('#attachmentButton'), imageInput: $('#imageInput'),
    replyingBar: $('#replyingBar'), replyingName: $('#replyingName'), replyingText: $('#replyingText'), cancelReplyButton: $('#cancelReplyButton'),
  };

  let messagesController = PaviloMessages.createMessages({
    elements: controllerElements,
    getSelf: () => store.getState().self,
    getState: () => store.getState(),
    onAction: handleModularAction,
    iconMarkup, avatarMarkup, escapeHtml, formatTime, formatDay,
    renderMentionText: (text, mentions) => PaviloMentions.renderMentionText(text, mentions, escapeHtml, store.getState().self?.id),
  });
  let overlaysController = PaviloOverlays.createOverlays({
    elements: controllerElements,
    getState: () => store.getState(),
    avatarMarkup, escapeHtml, formatTime, formatDay, formatDuration,
  });
  let notificationsController = PaviloNotifications.createNotifications({
    elements: controllerElements,
    getState: () => store.getState(),
    onAction: (action) => store.dispatch(action),
    iconMarkup, escapeHtml,
  });
  const mentionController = PaviloMentions.createMentions({ elements: controllerElements,
    getUsers: () => store.getState().users, getSelf: () => store.getState().self,
    isReady: () => connection.isReady() && !store.getState().channel.switching,
    avatarMarkup,
    onOpen: () => { closeComposerPopover(); messagesController.closeReactionPopover(); },
    onLimit: () => notificationsController.toast('剩余字数不足，无法插入完整的成员名字。', 'error'),
    onCandidates: (users) => { window.__paviloMentionCandidates = users; },
  });
  mentionController.bind();
  let composerController = PaviloComposer.createComposer({
    elements: controllerElements,
    getState: () => store.getState(),
    dispatch: (event) => store.dispatch(event),
    connection: { send: (command) => connection.send(command), isReady: () => connection.isReady() },
    pending: pendingQueue,
    mentions: mentionController,
    images: imagePipeline,
    toast: (...args) => notificationsController.toast(...args),
    clearReply: () => { replyTarget = null; },
    getReplyTarget: () => replyTarget,
    setReplyTarget: (value) => { replyTarget = value; },
    getLimits: () => ({ maxTextLength: roomInfo?.limits?.maxTextLength }),
  });
  composerController.bind();

  function syncChrome(next, event, previous) {
    if (next.channelId) selectedChannelId = next.channelId;
    const key = `${next.channelId || selectedChannelId || ''}|${Boolean(next.channel?.switching)}|${Boolean(next.connection?.joined)}|${roomChannels.length}`;
    if (key !== channelRenderKey) renderChannels(next);
    else if (next.channelOccupancy !== previous?.channelOccupancy) updateChannelOccupancy(next);
    renderChannelChrome(next);
    switch (event.type) {
      case 'connection/connect': setConnection(false, previous?.connection?.joined ? '重新连接中…' : '连接中…'); break;
      case 'connection/open': setConnection(false, '正在进入…'); break;
      case 'connection/retry': setConnection(false, '重新连接中…'); break;
      case 'connection/error': setConnection(false, '连接异常'); break;
      case 'connection/close': setConnection(false, event.wasJoined ? '连接已断开，准备重连…' : '无法连接服务'); break;
      case 'stateStart': showChat(); setConnection(false, next.channel?.switching ? '正在切换频道…' : '正在同步…'); break;
      case 'historyEnd':
      case 'state':
        if (next.connection.joined) { showChat(); finishResume(); setConnection(true, '已连接'); }
        break;
      case 'channel/request': {
        const target = channelById(next.channel?.requestedId);
        setConnection(true, target ? `正在切换到 ${target.name}…` : '正在切换频道…');
        break;
      }
      case 'error': if (next.connection.joined && !next.channel?.switching) setConnection(true, '已连接'); break;
      case 'serviceStopped':
      case 'service/stopped':
      case 'connection/leave': setConnection(false, event.type === 'connection/leave' ? '已离开' : '服务已停止'); break;
    }
  }

  store.subscribe((next, event, previous) => {
    if (next.channelId !== previous.channelId || next.self?.id !== previous.self?.id
      || previous.room.epoch && next.room.epoch && next.room.epoch !== previous.room.epoch
      || next.connection.status === 'stopped') mentionController.clear();
    syncChrome(next, event, previous);
    messagesController.onState(next, event, previous);
    overlaysController.onState(next, event, previous);
    notificationsController.onState(next, event, previous);
    composerController.update();
    renderTyping(next);
  });

  function finishJoined(epoch, authoritativeMessages, reconnect) {
    connection.markJoined(true);
    pendingQueue.reconcile(authoritativeMessages, {
      roomEpoch: epoch,
      allowRetry: reconnect,
      send: (command) => connection.send(command),
      isReady: () => connection.isReady(),
    });
    reconnectingAfterClose = false;
    composerController.update();
    window.requestAnimationFrame(() => composerText.focus());
  }

  function persistJoin(event, state) {
    if (event.channelId) {
      selectedChannelId = event.channelId;
      connection.writeChannelId(event.channelId);
    }
    if (event.self) identity = { ...(identity || {}), username: event.self.username, avatarSeed: event.self.avatarSeed, channelId: event.channelId || selectedChannelId };
    if (typeof event.resumeToken === 'string' && event.resumeToken) {
      resumeToken = event.resumeToken;
      identity = { ...(identity || {}), resumeToken };
      connection.setSession({ token: resumeToken, username: event.self.username });
    }
    if (state.channelId) selectedChannelId = state.channelId;
  }

  function returnToLoginForError(event, message) {
    connection.close({ intentional: true });
    pendingQueue.clear();
    composerController.clearReply();
    connection.clearSession();
    connection.clearChannelId();
    resumeToken = null;
    identity = null;
    showLogin(message || event.message);
  }

  function handleProtocolError(event, before) {
    if (event.clientMessageId) {
      pendingQueue.markError(event.clientMessageId, event.message);
      notificationsController.toast(event.message, 'error');
      return;
    }
    if (before.channel?.switching && ['CHANNEL_FULL', 'CHANNEL_UNAVAILABLE', 'NAME_TAKEN', 'RATE_LIMITED', 'SYNC_IN_PROGRESS'].includes(event.code)) {
      const target = channelById(before.channel.requestedId);
      const fallback = event.code === 'CHANNEL_FULL'
        ? '目标频道人数已满，当前频道保持不变。'
        : event.code === 'CHANNEL_UNAVAILABLE'
          ? '目标频道已停用或不存在，当前频道保持不变。'
          : event.code === 'NAME_TAKEN'
            ? '目标频道已有同名成员，当前频道保持不变。'
            : '暂时无法切换频道，当前频道保持不变。';
      notificationsController.toast(event.message ? `${event.message} 当前频道保持不变。` : `${target?.name || '目标频道'}：${fallback}`, 'error');
      return;
    }
    if (!before.connection.joined && ['CHANNEL_FULL', 'CHANNEL_UNAVAILABLE', 'SERVER_FULL'].includes(event.code)) {
      returnToLoginForError(event, event.message || (event.code === 'CHANNEL_FULL'
        ? '这个频道人数已满，请稍后重试或选择其他频道。' : '这个频道当前不可用，请稍后重试。'));
      return;
    }
    if (['NAME_TAKEN', 'INVALID_NAME', 'SESSION_CONFLICT'].includes(event.code)) {
      const wasVisible = !appShell.hidden || Boolean(before.connection.joined);
      if (event.code !== 'NAME_TAKEN') connection.clearSession();
      connection.close({ intentional: true });
      pendingQueue.clear();
      composerController.clearReply();
      if (wasVisible) notificationsController.toast(event.message, 'error');
      showLogin(wasVisible ? '' : event.message);
      return;
    }
    notificationsController.toast(event.message, 'error');
    if (!loginScreen.hidden) loginForm.querySelector('.enter-button').disabled = false;
  }

  function handlePresence(event, before) {
    if (before.sync?.active || event.action === 'reconnect' || appShell.hidden) return;
    if (event.userId === before.self?.id) {
      if (event.action !== 'leave') notificationsController.toast(`你已回到频道${event.username ? `（${event.username}）` : ''}`, 'success');
      return;
    }
    if (event.action === 'join' && event.user) notificationsController.toast(`${event.user.username} 进入了频道`, 'presence');
    else if (event.action === 'leave') notificationsController.toast(`${event.username} 离开了频道`, 'presence');
  }

  function handleServerMessage(payload) {
    const parsedEvent = parseServerEvent(payload);
    if (!parsedEvent) return;
    const before = store.getState();
    const event = parsedEvent.type === 'message'
      ? { ...parsedEvent, canMarkRead: notificationsController.canMarkRead() }
      : parsedEvent;
    const authoritativeMessages = event.type === 'historyEnd' ? [...(before.sync?.messages || [])] : null;
    store.dispatch(event);
    const after = store.getState();

    if (event.type === 'stateStart') {
      persistJoin(event, after);
      showChat();
      return;
    }
    if (event.type === 'historyEnd') {
      finishJoined(after.room?.epoch || event.roomEpoch, authoritativeMessages || [], reconnectingAfterClose);
      return;
    }
    if (event.type === 'state') {
      persistJoin(event, after);
      finishJoined(after.room?.epoch || event.roomEpoch, event.messages || [], reconnectingAfterClose);
      return;
    }
    if (event.type === 'ack') {
      pendingQueue.settleAck(event, after.messages || []);
      return;
    }
    if (event.type === 'message') {
      pendingQueue.reconcile([event.message], { roomEpoch: after.room?.epoch });
      return;
    }
    if (event.type === 'error') {
      handleProtocolError(event, before);
      return;
    }
    if (event.type === 'presence') handlePresence(event, before);
  }

  connection.subscribe((event) => {
    if (event.type === 'connecting') { store.dispatch({ type: 'connection/connect' }); return; }
    if (event.type === 'open') { store.dispatch({ type: 'connection/open' }); return; }
    if (event.type === 'payload') { handleServerMessage(event.payload); return; }
    if (event.type === 'error') { store.dispatch({ type: 'connection/error', error: event.error || event.event || null }); return; }
    if (event.type === 'retryScheduled') {
      store.dispatch({ type: 'connection/retry', attempt: event.attempt, max: event.max });
      // 如果尚未加入（登录阶段），在登录页显示重试进度
      if (!store.getState().connection.joined) {
        loginError.textContent = `无法连接到服务，正在重试 (${event.attempt}/${event.max})…`;
      }
      return;
    }
    if (event.type === 'maxRetriesReached') {
      store.dispatch({ type: 'connection/failed' });
      if (!store.getState().connection.joined) {
        showLogin('服务不可用，请检查服务是否正在运行。');
        notificationsController.toast('连接失败，请稍后重试或联系管理员。', 'error');
      } else {
        notificationsController.toast('无法重新连接到服务，请刷新页面或稍后再试。', 'error');
      }
      return;
    }
    if (event.type === 'close') {
      reconnectingAfterClose = Boolean(event.wasJoined);
      pendingQueue.disconnect();
      store.dispatch({ type: 'connection/close', code: event.code, reason: event.reason, intentional: event.intentional, wasJoined: event.wasJoined });
      if (event.wasJoined && !event.intentional && !(event.code === 1001 && event.reason === 'server stopped')) {
        notificationsController.toast('与房间的连接断开了，草稿与未确认消息仍在本页。', 'error');
      }
      return;
    }
    if (event.type === 'serviceStopped') {
      pendingQueue.clear();
      if (store.getState().connection.status !== 'stopped') store.dispatch({ type: 'serviceStopped' });
      connection.clearSession();
      connection.clearChannelId();
      resumeToken = null;
      identity = null;
      composerController.clearReply();
      finishResume();
      showLogin('服务已停止，本页临时聊天数据已清空。');
    }
  });

  function switchChannel(channelId) {
    const channel = channelById(channelId);
    const state = store.getState();
    if (!channel || channel.id === state.channelId) { renderChannels(state); return; }
    if (!channel.enabled) {
      notificationsController.toast('这个频道已停用，当前频道保持不变。', 'error');
      renderChannels(state);
      return;
    }
    if (state.channel?.switching) {
      notificationsController.toast('正在切换频道，请稍候。');
      return;
    }
    if (pendingQueue.unsafeChannelWork(composerText.value, composerController.imageProcessingCount)) {
      const pendingWork = pendingQueue.pendingChannelWork();
      const reason = composerController.imageProcessingCount ? '图片仍在处理中' : pendingWork ? '还有消息等待确认' : '输入框里还有草稿';
      notificationsController.toast(`${reason}，请处理后再切换频道。`, 'error');
      return;
    }
    if (!connection.isReady()) {
      notificationsController.toast('连接尚未恢复，暂时不能切换频道。', 'error');
      return;
    }
    composerController.stopTyping();
    store.dispatch({ type: 'channel/request', channelId: channel.id });
    if (!connection.sendRaw({ type: 'switchChannel', channelId: channel.id })) {
      store.dispatch({ type: 'error', code: 'CHANNEL_UNAVAILABLE', message: '切换请求未能发送。' });
    }
  }

  function submitLogin(event) {
    event.preventDefault();
    const username = usernameInput.value.trim();
    if (!username) { loginError.textContent = '请输入一个名字。'; return; }

    // 先检查健康状态
    loginForm.querySelector('.enter-button').disabled = true;
    loginError.textContent = '正在检查服务状态…';

    checkHealth().then((healthy) => {
      if (!healthy) {
        loginError.textContent = '服务不可用，请检查服务是否正在运行。';
        loginForm.querySelector('.enter-button').disabled = false;
        return;
      }

      if (!roomInfoReady) {
        loginError.textContent = '正在加载房间信息…';
        loadRoomInfo().then((info) => {
          if (info) {
            loginError.textContent = '';
            submitLogin({ preventDefault() {} });
          } else {
            loginForm.querySelector('.enter-button').disabled = false;
            loginError.textContent = '无法加载房间信息，请检查服务是否正在运行。';
          }
        });
        return;
      }

      const saved = connection.readSession();
      if (saved && saved.username !== username) {
        connection.clearSession();
        connection.clearChannelId();
        resumeToken = null;
      }
      identity = { username, channelId: selectedChannelId || roomInfo.defaultChannelId };
      resumeToken = null;
      loginError.textContent = '正在连接…';
      connection.connect(identity);
    });
  }

  function leaveRoom() {
    if (leaveTimer) { window.clearTimeout(leaveTimer); leaveTimer = null; }
    if (connection.getSocket()?.readyState === WebSocket.OPEN) connection.sendRaw({ type: 'leave' });
    connection.close({ intentional: true });
    connection.clearSession();
    connection.clearChannelId();
    pendingQueue.clear();
    composerController.clearReply();
    resumeToken = null;
    identity = null;
    selectedChannelId = roomInfo?.defaultChannelId || null;
    composerText.value = '';
    store.dispatch({ type: 'connection/leave' });
    showLogin('');
    usernameInput.value = '';
  }

  loginForm.addEventListener('submit', submitLogin);
  mobileChannelPicker.addEventListener('change', () => switchChannel(mobileChannelPicker.value));
  emojiButton.addEventListener('click', openComposerPopover);
  composerPicker.addEventListener('emoji-click', (event) => {
    const emoji = event.detail?.unicode || event.detail?.emoji?.emoji;
    if (!emoji) return;
    const start = composerText.selectionStart;
    const end = composerText.selectionEnd;
    composerText.value = `${composerText.value.slice(0, start)}${emoji}${composerText.value.slice(end)}`;
    composerText.selectionStart = composerText.selectionEnd = start + emoji.length;
    composerText.focus();
    composerText.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.addEventListener('pointerdown', (event) => {
    if (mentionController.isOpen() && !$('#mentionPopover').contains(event.target) && event.target !== composerText) mentionController.close();
    if (!$('#reactionPopover').hidden && !$('#reactionPopover').contains(event.target)) messagesController.closeReactionPopover();
    if (composerPopoverOpen && !composerPopover.contains(event.target) && event.target !== emojiButton) closeComposerPopover();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !$('#mobileSheet').hidden) return;
    if (mentionController.isOpen()) mentionController.close();
    else if (!$('#reactionPopover').hidden) messagesController.closeReactionPopover();
    else if (composerPopoverOpen) closeComposerPopover(true);
  });
  messageScroll.addEventListener('scroll', () => {
    mentionController.close();
    messagesController.closeReactionPopover();
    closeComposerPopover();
  }, { passive: true });
  window.addEventListener('online', () => { if (connection.handleOnline()) setConnection(false, '重新连接中…'); });
  window.addEventListener('offline', () => { connection.handleOffline(); setConnection(false, '网络已离线，等待恢复…'); });
  window.addEventListener('pagehide', () => composerController.stopTyping());
  leaveButton.addEventListener('click', () => {
    if (leaveButton.classList.contains('confirming')) {
      leaveButton.classList.remove('confirming');
      leaveButton.querySelector('.top-action-label').textContent = '离开';
      leaveRoom();
      return;
    }
    leaveButton.classList.add('confirming');
    leaveButton.querySelector('.top-action-label').textContent = '确认离开';
    leaveTimer = window.setTimeout(() => {
      leaveTimer = null;
      leaveButton.classList.remove('confirming');
      leaveButton.querySelector('.top-action-label').textContent = '离开';
    }, 3_000);
  });
  copyLinkButton.addEventListener('click', async () => {
    let url = window.location.href;
    try {
      if (!roomInfo) roomInfo = await fetch('/room-info', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null);
      if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && roomInfo?.lanUrls?.length) url = roomInfo.lanUrls[0];
      if (navigator.share) await navigator.share({ title: 'Pavilo / 语亭', text: '加入这个临时局域网聊天室', url });
      else {
        await navigator.clipboard.writeText(url);
        notificationsController.toast('局域网地址已复制。');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') notificationsController.toast(`请手动复制这个地址：${url}`, 'error');
    }
  });

  window.setInterval(() => {
    if (store.getState().connection.joined) store.dispatch({ type: 'typing/expire' });
  }, 1_000);

  for (const host of document.querySelectorAll('[data-icon]')) {
    host.innerHTML = iconMarkup(host.dataset.icon, Number(host.dataset.iconSize) || 0);
  }
  renderChannels();
  const savedResume = connection.readSession();
  if (savedResume) {
    resumeWatchdog = window.setTimeout(() => {
      finishResume();
      if (!store.getState().connection.joined) showLogin('暂时无法连接聊天室，正在重试。', false);
    }, 12_000);
    resumeToken = savedResume.token;
    identity = { username: savedResume.username, resumeToken, channelId: connection.readChannelId() || undefined };
    usernameInput.value = savedResume.username;
    showChat();
    messagesController.renderHistory(true);
    loadRoomInfo().then((info) => {
      if (info) {
        identity.channelId = selectedChannelId;
        connection.connect(identity);
      }
    });
  } else {
    usernameInput.focus();
    finishResume();
    loadRoomInfo();
  }

  // The composition root imports these alongside the parser so ownership of the
  // protocol version and its exact deferred-event set remains explicit.
  void PROTOCOL_VERSION;
  void DEFERRED_EVENTS;
})();
