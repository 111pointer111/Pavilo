'use strict';

(function () {
  const i18nFactory = globalThis.PaviloAdminI18n;
  const stored = (() => {
    try { return localStorage.getItem(i18nFactory.STORAGE_KEY); } catch { return null; }
  })();
  const i18n = i18nFactory.createI18n(stored || 'zh-CN');

  const loginScreen = document.getElementById('loginScreen');
  const desk = document.getElementById('desk');
  const loginForm = document.getElementById('loginForm');
  const tokenInput = document.getElementById('tokenInput');
  const tokenReveal = document.getElementById('tokenReveal');
  const loginSubmit = document.getElementById('loginSubmit');
  const loginError = document.getElementById('loginError');
  const pageTitle = document.getElementById('pageTitle');
  const pageLead = document.getElementById('pageLead');
  const pageCrumb = document.getElementById('pageCrumb');
  const pageSource = document.getElementById('pageSource');
  const pageStatus = document.getElementById('pageStatus');
  const headActions = document.getElementById('headActions');
  const mobileTitle = document.getElementById('mobileTitle');
  const menuButton = document.getElementById('menuButton');
  const railBackdrop = document.getElementById('railBackdrop');
  const overviewSheets = document.getElementById('overviewSheets');
  const gatewaySheets = document.getElementById('gatewaySheets');
  const gatewayLedger = document.getElementById('gatewayLedger');
  const channelList = document.getElementById('channelList');
  const usageBox = document.getElementById('usageBox');
  const form = document.getElementById('channelForm');
  const keyHelp = document.getElementById('keyHelp');
  const keyReveal = document.getElementById('keyReveal');
  const saveButton = document.getElementById('saveButton');
  const probeButton = document.getElementById('probeButton');
  const probeResult = document.getElementById('probeResult');
  const deleteButton = document.getElementById('deleteButton');
  const channelDanger = document.getElementById('channelDanger');
  const roomForm = document.getElementById('roomForm');
  const roomDefaultChannel = document.getElementById('roomDefaultChannel');
  const roomMaxUsersHint = document.getElementById('roomMaxUsersHint');
  const roomSaveButton = document.getElementById('roomSaveButton');
  const roomRevertButton = document.getElementById('roomRevertButton');
  const chatList = document.getElementById('chatList');
  const chatForm = document.getElementById('chatForm');
  const chatPlayRow = document.getElementById('chatPlayRow');
  const chatPlay = document.getElementById('chatPlay');
  const chatSaveButton = document.getElementById('chatSaveButton');
  const chatDeleteButton = document.getElementById('chatDeleteButton');
  const chatDanger = document.getElementById('chatDanger');
  const toast = document.getElementById('toast');
  const dialog = document.getElementById('dialog');
  const dialogTitle = document.getElementById('dialogTitle');
  const dialogCopy = document.getElementById('dialogCopy');
  const dialogCancel = document.getElementById('dialogCancel');
  const dialogOk = document.getElementById('dialogOk');
  const views = {
    overview: document.getElementById('viewOverview'),
    room: document.getElementById('viewRoom'),
    people: document.getElementById('viewPeople'),
    seat: document.getElementById('viewSeat'),
    chat: document.getElementById('viewChat'),
    chatForm: document.getElementById('viewChatForm'),
    gateway: document.getElementById('viewGateway'),
    channels: document.getElementById('viewChannels'),
    form: document.getElementById('viewChannelForm'),
    usage: document.getElementById('viewUsage')
  };
  const peopleList = document.getElementById('peopleList');
  const peopleToolbar = document.getElementById('peopleToolbar');
  const peopleLog = document.getElementById('peopleLog');
  const denyForm = document.getElementById('denyForm');
  const denyList = document.getElementById('denyList');
  const denySource = document.getElementById('denySource');
  const denyRevertButton = document.getElementById('denyRevertButton');
  const seatPaper = document.getElementById('seatPaper');
  const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
  const DEEPSEEK_MODEL = 'deepseek-chat';

  let session = null;
  let dashboard = null;
  let channels = [];
  let pavilionError = null;
  let pavilion = emptyPavilion();
  let usage = { tracking: true, rows: [] };
  let toastTimer = 0;
  let dialogResolve = null;
  let trackedForm = null;
  let formSnapshotValue = '';
  let dirty = false;
  let lastHash = location.hash;
  let ignoreHash = false;
  let peopleState = { seats: [], moderation: { ipDenyList: [] }, sources: {}, log: [], online: 0, leased: 0 };
  let peopleFilter = { channel: '', leased: false };
  let peopleTimer = 0;
  let seatHistory = { messages: [], exhausted: true };

  function emptyPavilion() {
    return {
      sources: { room: 'yaml', channels: 'yaml', moderation: 'yaml' },
      updatedAt: { room: null, channels: null, moderation: null },
      room: {},
      channels: [],
      plays: [],
      occupancy: {},
      maxUsersCap: 80
    };
  }

  function acceptPavilion(payload) {
    pavilion = {
      sources: payload.sources || { room: 'yaml', channels: 'yaml', moderation: 'yaml' },
      updatedAt: payload.updatedAt || { room: null, channels: null, moderation: null },
      room: payload.room || {},
      channels: Array.isArray(payload.channels) ? payload.channels : [],
      plays: Array.isArray(payload.plays) ? payload.plays : [],
      occupancy: payload.occupancy || {},
      maxUsersCap: payload.maxUsersCap || payload.room?.maxUsers || 1
    };
    pavilionError = null;
  }

  function t(key, vars) { return i18n.t(key, vars); }

  function paintLang() {
    const current = i18n.language();
    document.querySelectorAll('.lang').forEach((button) => {
      button.setAttribute('aria-pressed', button.getAttribute('data-lang') === current ? 'true' : 'false');
    });
  }

  function paintReveal(button, input) {
    if (!button || !input) return;
    button.textContent = t(input.type === 'password' ? 'reveal.show' : 'reveal.hide');
  }

  function paintI18n() {
    i18n.apply(document);
    paintLang();
    paintReveal(tokenReveal, tokenInput);
    paintReveal(keyReveal, form.apiKey);
  }

  function showToast(message, kind) {
    toast.textContent = message;
    toast.className = kind === 'err' ? 'toast err' : 'toast';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function closeDialog(result) {
    dialog.hidden = true;
    const resolve = dialogResolve;
    dialogResolve = null;
    if (resolve) resolve(Boolean(result));
  }

  function confirmDialog({ title, copy, ok, danger }) {
    return new Promise((resolve) => {
      if (dialogResolve) dialogResolve(false);
      dialogResolve = resolve;
      dialogTitle.textContent = title;
      dialogCopy.textContent = copy;
      dialogOk.textContent = ok || t('dialog.ok');
      dialogOk.className = danger ? 'danger fill' : '';
      dialog.hidden = false;
      dialogOk.focus();
    });
  }

  function snapshotOf(node) {
    if (!node) return '';
    const data = {};
    for (const field of node.elements) {
      if (!field.name) continue;
      data[field.name] = field.type === 'checkbox' ? field.checked : field.value;
    }
    return JSON.stringify(data);
  }

  function trackForm(node) {
    trackedForm = node;
    formSnapshotValue = snapshotOf(node);
    dirty = false;
  }

  function clearDirty() {
    dirty = false;
    formSnapshotValue = trackedForm ? snapshotOf(trackedForm) : '';
  }

  function refreshDirty() {
    if (!trackedForm) {
      dirty = false;
      return;
    }
    dirty = snapshotOf(trackedForm) !== formSnapshotValue;
  }

  async function guardLeave() {
    refreshDirty();
    if (!dirty) return true;
    const ok = await confirmDialog({
      title: t('form.unsavedTitle'),
      copy: t('form.unsavedCopy'),
      ok: t('form.leave')
    });
    if (ok) {
      dirty = false;
      trackedForm = null;
      formSnapshotValue = '';
    }
    return ok;
  }

  async function withBusy(button, labelKey, work) {
    if (!button) return work();
    const original = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (labelKey) button.textContent = t(labelKey);
    try {
      return await work();
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.hasAttribute('data-i18n')) button.textContent = t(button.getAttribute('data-i18n'));
      else button.textContent = original;
    }
  }

  async function api(pathname, options = {}) {
    const response = await fetch(pathname, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (response.status === 401) {
      showLogin();
      const error = new Error(payload.message || 'unauthorized');
      error.code = payload.code || 'OPERATOR_UNAUTHORIZED';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(payload.message || payload.code || `HTTP ${response.status}`);
      error.code = payload.code;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function setNavOpen(open) {
    desk.classList.toggle('nav-open', open);
    menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function showLogin() {
    desk.hidden = true;
    loginScreen.hidden = false;
    loginScreen.setAttribute('aria-hidden', 'false');
    desk.setAttribute('aria-hidden', 'true');
    session = null;
    dirty = false;
    trackedForm = null;
    setNavOpen(false);
    closeDialog(false);
  }

  function showDesk() {
    loginScreen.hidden = true;
    desk.hidden = false;
    loginScreen.setAttribute('aria-hidden', 'true');
    desk.setAttribute('aria-hidden', 'false');
  }

  function parseRoute() {
    const raw = (location.hash || '#/overview').replace(/^#/, '') || '/overview';
    const [pathOnly, queryString] = raw.split('?');
    const query = new URLSearchParams(queryString || '');
    let parts = pathOnly.split('/').filter(Boolean);
    let path = `/${parts.join('/')}`;
    if (parts[0] === 'usage') path = '/gateway/usage';
    else if (parts[0] === 'channels') path = `/gateway/${parts.join('/')}`;
    if (`#${path}` !== location.hash && (parts[0] === 'usage' || parts[0] === 'channels')) {
      history.replaceState(null, '', `#${path}`);
      parts = path.split('/').filter(Boolean);
    }
    if (parts[0] === 'room') return { view: 'room' };
    if (parts[0] === 'people' && parts[1]) return { view: 'seat', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'people') return { view: 'people', channel: query.get('channel') || '' };
    if (parts[0] === 'chat' && parts[1] === 'new') return { view: 'chatForm', id: '' };
    if (parts[0] === 'chat' && parts[1]) return { view: 'chatForm', id: parts[1] };
    if (parts[0] === 'chat') return { view: 'chat' };
    if (parts[0] === 'gateway' && parts[1] === 'channels' && parts[2] === 'new') return { view: 'form', id: '' };
    if (parts[0] === 'gateway' && parts[1] === 'channels' && parts[2]) return { view: 'form', id: parts[2] };
    if (parts[0] === 'gateway' && parts[1] === 'channels') return { view: 'channels' };
    if (parts[0] === 'gateway' && parts[1] === 'usage') return { view: 'usage' };
    if (parts[0] === 'gateway') return { view: 'gateway' };
    return { view: 'overview' };
  }

  function setHead({ title, lead, crumb, source, status, action }) {
    pageTitle.textContent = title;
    mobileTitle.textContent = title;
    pageLead.textContent = lead || '';
    pageLead.hidden = !lead;
    pageCrumb.textContent = crumb || '';
    if (source) {
      pageSource.hidden = false;
      paintSource(pageSource, source);
    } else {
      pageSource.hidden = true;
      pageSource.textContent = '';
      pageSource.className = 'source-badge';
    }
    if (status) {
      pageStatus.hidden = false;
      pageStatus.textContent = status;
    } else {
      pageStatus.hidden = true;
      pageStatus.textContent = '';
    }
    headActions.replaceChildren();
    if (action) headActions.append(action);
  }

  function markNav(section) {
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.getAttribute('data-nav') === section) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function showView(name) {
    Object.entries(views).forEach(([key, node]) => {
      node.hidden = key !== name;
    });
    if (name !== 'room' && name !== 'chatForm' && name !== 'form') {
      trackedForm = null;
      dirty = false;
    }
    if (name !== 'people') stopPeoplePoll();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function paintSource(node, source) {
    node.textContent = t(source === 'operator' ? 'source.operator' : 'source.yaml');
    node.className = `source-badge${source === 'operator' ? ' operator' : ''}`;
  }

  function writable() {
    return Boolean(session?.writable);
  }

  function storageLabel(room) {
    if (room?.storage || room?.ephemeral === false) return t('overview.storageSqlite');
    return t('overview.storageMemory');
  }

  function sourceLabel(source) {
    return t(source === 'operator' ? 'overview.sourceOperator' : 'overview.sourceYaml');
  }

  function stopPeoplePoll() {
    if (peopleTimer) {
      clearInterval(peopleTimer);
      peopleTimer = 0;
    }
  }

  function startPeoplePoll() {
    stopPeoplePoll();
    peopleTimer = setInterval(() => {
      if (document.hidden) return;
      refreshPeople().then(() => {
        if (parseRoute().view === 'people') renderPeopleList();
      }).catch(() => {});
    }, 5000);
  }

  function formatDuration(from, clock = Date.now()) {
    if (!from) return t('people.never');
    const minutes = Math.floor(Math.max(0, clock - from) / 60000);
    if (minutes < 1) return t('people.durationNow');
    if (minutes < 60) return t('people.durationMin', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('people.durationHour', { hours, minutes: minutes % 60 });
    return t('people.durationDay', { days: Math.floor(hours / 24), hours: hours % 24 });
  }

  function formatClock(ts) {
    if (!ts) return t('people.never');
    try {
      return new Date(ts).toLocaleString(i18n.language() === 'en' ? 'en' : 'zh-CN', { hour12: false });
    } catch {
      return t('people.never');
    }
  }

  function acceptPeople(payload) {
    peopleState = {
      seats: Array.isArray(payload.seats) ? payload.seats : [],
      moderation: payload.moderation || { ipDenyList: [] },
      sources: payload.sources || {},
      updatedAt: payload.updatedAt || {},
      log: Array.isArray(payload.log) ? payload.log : [],
      online: payload.online || 0,
      leased: payload.leased || 0
    };
  }

  async function refreshPeople() {
    acceptPeople(await api('/admin/api/people'));
  }

  function peopleLogLine(entry) {
    const key = `people.log.${entry.action}`;
    const text = t(key, entry);
    return text === key ? entry.action : text;
  }

  function renderOverview() {
    const room = dashboard?.room || {};
    const sources = pavilion.sources || {};
    const roomTitle = pavilion.room?.title || dashboard?.pavilion?.roomTitle || '—';
    const writableChat = (pavilion.channels || []).some((channel) => channel.enabled !== false && !channel.readOnly);
    const dutyWarn = Boolean(pavilionError) || (!pavilionError && pavilion.channels.length > 0 && !writableChat);

    const duty = el('a', `sheet duty${dutyWarn ? ' warn' : ''}`);
    duty.href = '#/room';
    duty.append(
      el('p', 'kicker', t('overview.room')),
      el('strong', '', pavilionError ? t('pavilion.loadError') : roomTitle),
      el('p', '', pavilionError
        ? String(pavilionError)
        : t('overview.dutyMeta', {
          users: t('overview.online', { count: room.users ?? 0 }),
          storage: storageLabel(room),
          source: sourceLabel(sources.room)
        }))
    );
    if (!pavilionError && pavilion.channels.length > 0 && !writableChat) {
      duty.append(el('p', '', t('overview.noWritable')));
    }

    const chat = el('a', 'sheet');
    chat.href = '#/chat';
    const defaultId = pavilion.room?.defaultChannel;
    chat.append(
      el('p', 'kicker', t('overview.chat')),
      el('strong', '', pavilionError ? t('pavilion.loadError') : t('overview.channelCount', { count: pavilion.channels.length })),
      el('p', '', pavilionError
        ? t('pavilion.loadErrorHint')
        : [defaultId ? t('overview.defaultChannel', { id: defaultId }) : '', sourceLabel(sources.channels)].filter(Boolean).join(' · '))
    );

    const missing = channels.filter((channel) => !channel.keyPresent || channel.unwrapFailed).length;
    const errors = usage.rows.reduce((sum, row) => sum + (row.errors || 0), 0);
    const gateway = el('a', `sheet${missing ? ' warn' : ''}`);
    gateway.href = '#/gateway';
    gateway.append(
      el('p', 'kicker', t('gateway.title')),
      el('strong', '', t('overview.channelCount', { count: channels.length })),
      el('p', '', `${t('overview.missingKey', { count: missing })} · ${t('overview.errors', { count: errors })}`)
    );

    const people = el('a', 'sheet');
    people.href = '#/people';
    people.append(
      el('p', 'kicker', t('nav.people')),
      el('strong', '', t('overview.online', { count: room.users ?? 0 })),
      el('p', '', t('people.overviewHint'))
    );

    overviewSheets.replaceChildren(duty, people, chat, gateway);
  }

  function modelChannelRow(channel) {
    const row = el('a', 'ledger-row');
    row.href = `#/gateway/channels/${encodeURIComponent(channel.id)}`;
    const identity = el('div');
    identity.append(el('div', 'ledger-name', channel.label || channel.model || channel.id));
    const meta = el('div', 'ledger-meta');
    meta.append(el('code', '', channel.id));
    meta.append(document.createTextNode(` · ${channel.preset}${channel.model ? ` · ${channel.model}` : ''}`));
    identity.append(meta);
    const status = el('div', 'ledger-status');
    status.append(el('span', `badge${channel.enabled ? '' : ' off'}`, channel.enabled ? t('channel.enabledOn') : t('channel.enabledOff')));
    const keyOk = channel.keyPresent && !channel.unwrapFailed;
    status.append(el('span', `badge${keyOk ? '' : ' warn'}`, keyOk ? t('channel.keyOn') : t('channel.keyOff')));
    row.append(identity, status);
    return row;
  }

  function chatChannelRow(channel) {
    const row = el('a', 'ledger-row');
    row.href = `#/chat/${encodeURIComponent(channel.id)}`;
    const identity = el('div');
    identity.append(el('div', 'ledger-name', channel.name || channel.id));
    const meta = el('div', 'ledger-meta');
    meta.append(el('code', '', channel.id));
    const occ = pavilion.occupancy?.[channel.id] ?? 0;
    meta.append(document.createTextNode(` · ${t('chat.occupancy', { count: occ, cap: channel.maxUsers || pavilion.room?.maxUsers || '—' })}`));
    identity.append(meta);
    const status = el('div', 'ledger-status');
    status.append(el('span', `badge${channel.enabled ? '' : ' off'}`, channel.enabled ? t('chat.enabledOn') : t('chat.enabledOff')));
    if (channel.readOnly) status.append(el('span', 'badge', t('chat.readOnlyOn')));
    row.append(identity, status);
    return row;
  }

  function renderGatewayOverview() {
    gatewaySheets.replaceChildren();
    if (!channels.length) {
      const empty = el('div', 'empty paper');
      empty.append(el('h2', '', t('gateway.empty')), el('p', '', t('gateway.emptyHint')));
      const add = el('a', 'button', t('overview.addFirst'));
      add.href = '#/gateway/channels/new';
      empty.append(add);
      gatewayLedger.replaceChildren(empty);
      return;
    }
    const list = el('div', 'ledger');
    for (const channel of channels) list.append(modelChannelRow(channel));
    gatewayLedger.replaceChildren(list);
  }

  function paintLoadError(node) {
    if (!node) return;
    if (pavilionError) {
      node.hidden = false;
      node.textContent = `${t('pavilion.loadError')} ${pavilionError}`;
    } else {
      node.hidden = true;
      node.textContent = '';
    }
  }

  function fillRoomForm() {
    const room = pavilion.room || {};
    paintLoadError(document.getElementById('roomLoadError'));
    roomForm.title.value = room.title || '';
    roomForm.defaultLanguage.value = room.defaultLanguage || 'zh-CN';
    roomForm.maxUsers.value = room.maxUsers || 1;
    roomForm.maxUsers.max = pavilion.maxUsersCap || room.maxUsers || 1;
    roomForm.exposeMemberIps.checked = room.exposeMemberIps !== false;
    roomForm.exposeLanUrls.checked = room.exposeLanUrls !== false;
    roomMaxUsersHint.textContent = t('room.maxUsersHint', { cap: pavilion.maxUsersCap || room.maxUsers || 1 });
    roomDefaultChannel.replaceChildren();
    for (const channel of pavilion.channels || []) {
      const option = document.createElement('option');
      option.value = channel.id;
      option.textContent = `${channel.name} (${channel.id})`;
      if (channel.id === room.defaultChannel) option.selected = true;
      roomDefaultChannel.append(option);
    }
    const canWrite = writable() && !pavilionError;
    roomSaveButton.disabled = !canWrite;
    roomRevertButton.hidden = pavilion.sources?.room !== 'operator';
    roomRevertButton.disabled = !canWrite;
    trackForm(roomForm);
  }

  function renderChatList() {
    paintLoadError(document.getElementById('chatLoadError'));
    chatList.replaceChildren();
    if (pavilionError) {
      const empty = el('div', 'empty paper');
      empty.append(el('h2', '', t('pavilion.loadError')), el('p', '', t('pavilion.loadErrorHint')));
      chatList.append(empty);
      return;
    }
    if (!pavilion.channels.length) {
      const empty = el('div', 'empty paper');
      empty.append(el('h2', '', t('chat.empty')), el('p', '', t('chat.emptyHint')));
      const add = el('a', 'button', t('chat.add'));
      add.href = '#/chat/new';
      empty.append(add);
      chatList.append(empty);
      return;
    }
    const list = el('div', 'ledger');
    for (const channel of pavilion.channels) list.append(chatChannelRow(channel));
    chatList.append(list);
    if (pavilion.sources?.channels === 'operator') {
      const revert = el('button', 'ghost', t('chat.revert'));
      revert.type = 'button';
      revert.disabled = !writable();
      revert.addEventListener('click', revertChat);
      chatList.append(revert);
    }
  }

  function fillChatForm(channel) {
    const editing = Boolean(channel);
    chatForm.id.value = channel?.id || '';
    chatForm.id.readOnly = editing;
    chatForm.name.value = channel?.name || '';
    chatForm.description.value = channel?.description || '';
    chatForm.maxUsers.value = channel?.maxUsers || pavilion.room.maxUsers || 1;
    chatForm.maxUsers.max = pavilion.room.maxUsers || 1;
    chatForm.welcome.value = channel?.welcome || '';
    chatForm.enabled.checked = channel ? channel.enabled !== false : true;
    chatForm.readOnly.checked = Boolean(channel?.readOnly);
    const plays = pavilion.plays || [];
    chatPlayRow.hidden = plays.length === 0;
    chatPlay.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('chat.playNone');
    chatPlay.append(none);
    for (const play of plays) {
      const option = document.createElement('option');
      option.value = play;
      option.textContent = play;
      if (channel?.play === play) option.selected = true;
      chatPlay.append(option);
    }
    chatDanger.hidden = !editing;
    const canWrite = writable() && !pavilionError;
    chatSaveButton.disabled = !canWrite;
    chatDeleteButton.disabled = !canWrite;
    trackForm(chatForm);
  }

  function chatPayloadFromForm() {
    const payload = {
      id: chatForm.id.value.trim(),
      name: chatForm.name.value.trim(),
      description: chatForm.description.value.trim(),
      maxUsers: Number(chatForm.maxUsers.value),
      welcome: chatForm.welcome.value,
      enabled: chatForm.enabled.checked,
      readOnly: chatForm.readOnly.checked
    };
    if (chatForm.play.value) payload.play = chatForm.play.value;
    return payload;
  }

  function renderChannels() {
    channelList.replaceChildren();
    if (!channels.length) {
      const empty = el('div', 'empty paper');
      empty.append(el('h2', '', t('channels.empty')), el('p', '', t('channels.emptyHint')));
      const add = el('a', 'button', t('channels.add'));
      add.href = '#/gateway/channels/new';
      empty.append(add);
      channelList.append(empty);
      return;
    }
    const list = el('div', 'ledger');
    for (const channel of channels) list.append(modelChannelRow(channel));
    channelList.append(list);
  }

  function fillForm(channel) {
    const editing = Boolean(channel);
    form.id.value = channel?.id || '';
    form.id.readOnly = editing;
    form.preset.value = channel?.preset || 'deepseek';
    form.label.value = channel?.label || '';
    form.model.value = channel?.model || (form.preset.value === 'deepseek' ? DEEPSEEK_MODEL : '');
    form.baseUrl.value = channel?.baseUrl || (form.preset.value === 'deepseek' ? DEEPSEEK_BASE : '');
    form.apiKey.value = '';
    form.apiKey.type = 'password';
    form.enabled.checked = channel ? channel.enabled !== false : true;
    channelDanger.hidden = !editing;
    probeButton.disabled = !editing;
    probeResult.hidden = true;
    probeResult.textContent = '';
    probeResult.className = 'probe-result';
    if (!channel) keyHelp.textContent = t('channel.keyMissing');
    else if (channel.unwrapFailed) keyHelp.textContent = t('channel.keyUnwrap');
    else if (channel.keyPresent) keyHelp.textContent = t('channel.keyKeep', { hint: channel.keyHint });
    else keyHelp.textContent = t('channel.keyMissing');
    paintReveal(keyReveal, form.apiKey);
    trackForm(form);
  }

  function renderUsage() {
    usageBox.replaceChildren();
    if (!usage.rows.length) {
      const empty = el('div', 'empty');
      empty.append(el('h2', '', t('usage.empty')), el('p', '', t('usage.emptyHint')));
      usageBox.append(empty);
      return;
    }
    const requests = usage.rows.reduce((sum, row) => sum + (row.requests || 0), 0);
    const tokens = usage.rows.reduce((sum, row) => sum + (row.promptTokens || 0) + (row.completionTokens || 0), 0);
    const errors = usage.rows.reduce((sum, row) => sum + (row.errors || 0), 0);
    usageBox.append(el('p', 'usage-summary', t('usage.summary', { requests, tokens, errors })));
    const wrap = el('div', 'table-wrap');
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const head = document.createElement('tr');
    for (const key of ['usage.day', 'usage.channel', 'usage.requests', 'usage.tokens', 'usage.errors']) {
      head.append(el('th', '', t(key)));
    }
    thead.append(head);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const row of usage.rows) {
      const tr = document.createElement('tr');
      const err = el('td', row.errors ? 'num warn' : 'num', String(row.errors || 0));
      tr.append(
        el('td', '', row.day),
        el('td', '', row.channelId),
        el('td', 'num', String(row.requests)),
        el('td', 'num', String((row.promptTokens || 0) + (row.completionTokens || 0))),
        err
      );
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    usageBox.append(wrap);
  }

  function filteredSeats() {
    return peopleState.seats.filter((seat) => {
      if (peopleFilter.channel && seat.channelId !== peopleFilter.channel) return false;
      if (peopleFilter.leased && seat.status !== 'leased') return false;
      return true;
    });
  }

  function seatStatusLabel(seat) {
    if (seat.kind === 'agent') return t('people.agent');
    if (seat.muted) return t('people.muted');
    if (seat.status === 'leased') return t('people.leased');
    return t('people.connected');
  }

  function renderPeopleList() {
    const log = peopleState.log[0];
    if (log) {
      peopleLog.hidden = false;
      peopleLog.textContent = `${formatClock(log.at)} · ${peopleLogLine(log)}`;
    } else {
      peopleLog.hidden = true;
      peopleLog.textContent = '';
    }

    peopleToolbar.replaceChildren();
    const channelSelect = document.createElement('select');
    channelSelect.setAttribute('aria-label', t('people.filterAll'));
    const all = document.createElement('option');
    all.value = '';
    all.textContent = t('people.filterAll');
    channelSelect.append(all);
    const channelIds = [...new Set((pavilion.channels || []).map((channel) => channel.id)
      .concat(peopleState.seats.map((seat) => seat.channelId)))];
    for (const id of channelIds) {
      const option = document.createElement('option');
      option.value = id;
      const named = (pavilion.channels || []).find((channel) => channel.id === id);
      option.textContent = named ? `${named.name} · ${id}` : id;
      channelSelect.append(option);
    }
    channelSelect.value = peopleFilter.channel;
    channelSelect.addEventListener('change', () => {
      peopleFilter.channel = channelSelect.value;
      renderPeopleList();
    });
    const leasedLabel = el('label', 'check');
    const leasedBox = document.createElement('input');
    leasedBox.type = 'checkbox';
    leasedBox.checked = peopleFilter.leased;
    leasedBox.addEventListener('change', () => {
      peopleFilter.leased = leasedBox.checked;
      renderPeopleList();
    });
    leasedLabel.append(leasedBox, document.createTextNode(t('people.filterLeased')));
    peopleToolbar.append(channelSelect, leasedLabel);

    const seats = filteredSeats();
    peopleList.replaceChildren();
    if (!seats.length) {
      const empty = el('div', 'empty paper');
      empty.append(el('h2', '', t('people.empty')));
      peopleList.append(empty);
    } else {
      const list = el('div', 'ledger');
      for (const seat of seats) {
        const row = el('a', 'ledger-row');
        row.href = `#/people/${encodeURIComponent(seat.id)}`;
        const identity = el('div');
        identity.append(el('div', 'ledger-name', seat.username));
        const meta = el('div', 'ledger-meta');
        meta.append(document.createTextNode([
          seat.channelId,
          seat.ip || t('people.never'),
          t('people.messages', { count: seat.messageCount || 0 }),
          formatDuration(seat.joinedAt)
        ].join(' · ')));
        identity.append(meta);
        const status = el('div', 'ledger-status');
        const badgeClass = seat.kind === 'agent' || seat.muted || seat.status === 'leased' ? 'badge warn' : 'badge';
        status.append(el('span', badgeClass, seatStatusLabel(seat)));
        row.append(identity, status);
        list.append(row);
      }
      peopleList.append(list);
    }

    const source = peopleState.sources.moderation;
    if (source) {
      denySource.hidden = false;
      paintSource(denySource, source);
    } else {
      denySource.hidden = true;
    }
    const ips = peopleState.moderation.ipDenyList || [];
    denyList.replaceChildren();
    if (!ips.length) {
      denyList.append(el('p', 'hint', t('people.denyEmpty')));
    } else {
      for (const ip of ips) {
        const row = el('div', 'deny-row');
        row.append(el('code', '', ip));
        const remove = el('button', 'ghost', t('channel.delete'));
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          try {
            const next = ips.filter((item) => item !== ip);
            acceptPeople(await api('/admin/api/moderation', {
              method: 'PUT',
              body: JSON.stringify({ ipDenyList: next })
            }));
            showToast(t('people.denyRemoved'));
            renderPeopleList();
          } catch (error) {
            showToast(error.message, 'err');
          }
        });
        row.append(remove);
        denyList.append(row);
      }
    }
    denyRevertButton.hidden = source !== 'operator' || !writable();
    denyForm.querySelector('[name=ip]').disabled = !writable();
    document.getElementById('denyAddButton').disabled = !writable();
  }

  function seatField(label, value) {
    const wrap = document.createDocumentFragment();
    wrap.append(el('dt', '', label), el('dd', '', value));
    return wrap;
  }

  async function renderSeat(id) {
    const errorNode = document.getElementById('seatLoadError');
    errorNode.hidden = true;
    seatPaper.replaceChildren();
    let payload;
    try {
      payload = await api(`/admin/api/people/${encodeURIComponent(id)}`);
      acceptPeople(payload);
    } catch (error) {
      errorNode.hidden = false;
      errorNode.textContent = error.code === 'NOT_FOUND' ? t('people.gone') : error.message;
      return;
    }
    const seat = payload.seat;
    const paper = el('div', 'editor paper');
    const identity = document.createElement('fieldset');
    identity.append(el('legend', '', t('people.groupSeat')));
    const dl = el('dl', 'seat-dl');
    dl.append(
      seatField(t('people.fieldId'), seat.id),
      seatField(t('people.fieldChannel'), seat.channelId),
      seatField(t('people.fieldIp'), seat.ip || t('people.never')),
      seatField(t('people.fieldJoined'), formatClock(seat.joinedAt)),
      seatField(t('people.fieldDuration'), formatDuration(seat.joinedAt)),
      seatField(t('people.fieldCount'), String(seat.messageCount || 0)),
      seatField(t('people.fieldLast'), formatClock(seat.lastSpokenAt))
    );
    identity.append(dl);
    paper.append(identity);

    const history = document.createElement('fieldset');
    history.append(el('legend', '', t('people.groupHistory')));
    const historyBox = el('div', 'history-list');
    history.append(historyBox);
    paper.append(history);

    const danger = document.createElement('fieldset');
    danger.className = 'danger-zone';
    danger.append(el('legend', '', t('people.danger')));
    const actions = el('div', 'actions');
    if (seat.kind === 'agent') {
      actions.append(el('p', 'hint', t('people.agentLocked')));
    } else {
      const muteBtn = el('button', 'ghost', seat.muted ? t('people.unmute') : t('people.mute'));
      muteBtn.type = 'button';
      muteBtn.disabled = !writable();
      muteBtn.addEventListener('click', async () => {
        try {
          await withBusy(muteBtn, null, async () => {
            const next = await api(`/admin/api/people/${encodeURIComponent(seat.id)}/mute`, {
              method: 'POST',
              body: JSON.stringify({ active: !seat.muted })
            });
            showToast(next.seat.muted ? t('people.mutedOn') : t('people.mutedOff'));
            await renderSeat(seat.id);
          });
        } catch (error) {
          showToast(error.message, 'err');
        }
      });
      const kickBtn = el('button', 'ghost danger', t('people.kick'));
      kickBtn.type = 'button';
      kickBtn.disabled = !writable();
      kickBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: t('people.kickTitle'),
          copy: t('people.kickCopy', { name: seat.username }),
          ok: t('people.kick'),
          danger: true
        });
        if (!ok) return;
        try {
          await api(`/admin/api/people/${encodeURIComponent(seat.id)}/kick`, {
            method: 'POST',
            body: JSON.stringify({ denyIp: false })
          });
          showToast(t('people.kicked'));
          location.hash = '#/people';
        } catch (error) {
          showToast(error.message, 'err');
        }
      });
      const kickDenyBtn = el('button', 'danger fill', t('people.kickDeny'));
      kickDenyBtn.type = 'button';
      kickDenyBtn.disabled = !writable() || !seat.ip;
      kickDenyBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: t('people.kickTitle'),
          copy: t('people.kickDenyCopy', { name: seat.username, ip: seat.ip }),
          ok: t('people.kickDeny'),
          danger: true
        });
        if (!ok) return;
        try {
          await api(`/admin/api/people/${encodeURIComponent(seat.id)}/kick`, {
            method: 'POST',
            body: JSON.stringify({ denyIp: true })
          });
          showToast(t('people.kicked'));
          location.hash = '#/people';
        } catch (error) {
          showToast(error.message, 'err');
        }
      });
      actions.append(muteBtn, kickBtn, kickDenyBtn);
    }
    danger.append(actions);
    paper.append(danger);
    seatPaper.append(paper);

    try {
      const page = await api(`/admin/api/people/${encodeURIComponent(id)}/messages?limit=50`);
      seatHistory = page;
      if (!page.messages.length) {
        historyBox.append(el('p', 'hint', t('people.historyEmpty')));
      } else {
        for (const message of page.messages) {
          const row = el('div', 'history-row');
          row.append(el('div', 'history-meta', `${formatClock(message.createdAt)} · ${message.channelId}`));
          const body = el('div', 'history-text', message.kind === 'image'
            ? `${t('people.image')}${message.text ? ` · ${message.text}` : ''}`
            : (message.text || ''));
          row.append(body);
          historyBox.append(row);
        }
        if (!page.exhausted && page.messages.length) {
          const more = el('button', 'ghost', t('people.historyMore'));
          more.type = 'button';
          more.addEventListener('click', async () => {
            const last = page.messages[page.messages.length - 1];
            const next = await api(`/admin/api/people/${encodeURIComponent(id)}/messages?limit=50&beforeCreatedAt=${last.createdAt}&beforeChannelId=${encodeURIComponent(last.channelId)}&beforeId=${encodeURIComponent(last.id)}`);
            more.remove();
            for (const message of next.messages) {
              const row = el('div', 'history-row');
              row.append(el('div', 'history-meta', `${formatClock(message.createdAt)} · ${message.channelId}`));
              row.append(el('div', 'history-text', message.kind === 'image'
                ? `${t('people.image')}${message.text ? ` · ${message.text}` : ''}`
                : (message.text || '')));
              historyBox.append(row);
            }
          });
          historyBox.append(more);
        }
      }
    } catch (error) {
      historyBox.append(el('p', 'hint', error.message));
    }
  }

  function addAction(href, label) {
    const link = el('a', 'button', label);
    link.href = href;
    return link;
  }

  function renderRoute() {
    const route = parseRoute();
    paintI18n();
    saveButton.disabled = session ? !session.writable : true;
    deleteButton.disabled = session ? !session.writable : true;
    lastHash = location.hash || '#/overview';
    if (route.view === 'overview') {
      markNav('overview');
      setHead({
        title: t('overview.title'),
        lead: t('overview.lead'),
        crumb: t('nav.groupPavilo')
      });
      showView('overview');
      renderOverview();
      return;
    }
    if (route.view === 'room') {
      markNav('room');
      setHead({
        title: t('room.pageTitle'),
        lead: t('room.lead'),
        crumb: t('nav.groupPavilo'),
        source: pavilion.sources?.room
      });
      showView('room');
      fillRoomForm();
      return;
    }
    if (route.view === 'people') {
      markNav('people');
      if (route.channel) peopleFilter.channel = route.channel;
      setHead({
        title: t('people.title'),
        lead: t('people.lead'),
        crumb: t('nav.groupPavilo'),
        source: peopleState.sources.moderation,
        status: t('people.status', { online: peopleState.online, leased: peopleState.leased })
      });
      showView('people');
      refreshPeople().then(() => {
        setHead({
          title: t('people.title'),
          lead: t('people.lead'),
          crumb: t('nav.groupPavilo'),
          source: peopleState.sources.moderation,
          status: t('people.status', { online: peopleState.online, leased: peopleState.leased })
        });
        renderPeopleList();
        startPeoplePoll();
      }).catch((error) => {
        const node = document.getElementById('peopleLoadError');
        node.hidden = false;
        node.textContent = error.message;
      });
      return;
    }
    if (route.view === 'seat') {
      markNav('people');
      setHead({
        title: t('people.title'),
        lead: t('people.seatLead'),
        crumb: `${t('nav.groupPavilo')} / ${t('nav.people')}`
      });
      showView('seat');
      renderSeat(route.id).then(() => {
        const seat = peopleState.seats.find((item) => item.id === route.id) || {};
        setHead({
          title: t('people.seatTitle', { name: seat.username || t('people.title') }),
          lead: t('people.seatLead'),
          crumb: `${t('nav.groupPavilo')} / ${t('nav.people')}`
        });
      });
      return;
    }
    if (route.view === 'chat') {
      markNav('chat');
      const action = pavilionError || !pavilion.channels.length ? null : addAction('#/chat/new', t('chat.add'));
      setHead({
        title: t('chat.pageTitle'),
        lead: t('chat.lead'),
        crumb: t('nav.groupPavilo'),
        source: pavilion.sources?.channels,
        action
      });
      showView('chat');
      renderChatList();
      return;
    }
    if (route.view === 'chatForm') {
      markNav('chat');
      if (pavilionError) {
        location.hash = '#/chat';
        return;
      }
      const channel = route.id ? pavilion.channels.find((entry) => entry.id === route.id) : null;
      if (route.id && !channel) {
        location.hash = '#/chat';
        return;
      }
      setHead({
        title: channel ? t('chat.editTitle', { name: channel.name || channel.id }) : t('chat.newTitle'),
        lead: channel ? t('chat.editLead') : t('chat.newLead'),
        crumb: `${t('nav.groupPavilo')} / ${t('nav.chat')}`
      });
      showView('chatForm');
      fillChatForm(channel);
      return;
    }
    if (route.view === 'gateway') {
      markNav('gateway');
      const action = el('a', 'text-btn', t('overview.viewUsage'));
      action.href = '#/gateway/usage';
      setHead({
        title: t('gateway.title'),
        lead: t('gateway.lead'),
        crumb: t('nav.groupGateway'),
        action: channels.length ? action : null
      });
      showView('gateway');
      renderGatewayOverview();
      return;
    }
    if (route.view === 'channels') {
      markNav('gateway-channels');
      setHead({
        title: t('channels.title'),
        lead: t('channels.lead'),
        crumb: t('nav.groupGateway'),
        action: channels.length ? addAction('#/gateway/channels/new', t('channels.add')) : null
      });
      showView('channels');
      renderChannels();
      return;
    }
    if (route.view === 'usage') {
      markNav('gateway-usage');
      setHead({
        title: t('usage.title'),
        lead: t('usage.lead'),
        crumb: t('nav.groupGateway')
      });
      showView('usage');
      renderUsage();
      return;
    }
    markNav('gateway-channels');
    const channel = route.id ? channels.find((entry) => entry.id === route.id) : null;
    if (route.id && !channel) {
      location.hash = '#/gateway/channels';
      return;
    }
    setHead({
      title: channel ? t('channel.editTitle', { name: channel.label || channel.model || channel.id }) : t('channel.newTitle'),
      lead: channel ? t('channel.editLead') : t('channel.newLead'),
      crumb: `${t('nav.groupGateway')} / ${t('nav.channels')}`
    });
    showView('form');
    fillForm(channel);
  }

  async function load() {
    dashboard = await api('/admin/api/dashboard');
    session = dashboard.session;
    channels = (await api('/admin/api/channels')).channels || [];
    usage = await api('/admin/api/usage?days=7');
    try {
      acceptPavilion(await api('/admin/api/pavilion'));
    } catch (error) {
      if (error.code === 'OPERATOR_UNAUTHORIZED') throw error;
      pavilion = emptyPavilion();
      pavilionError = error.message || t('pavilion.loadError');
    }
  }

  function bindReveal(button, input) {
    button.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      paintReveal(button, input);
    });
  }

  bindReveal(tokenReveal, tokenInput);
  bindReveal(keyReveal, form.apiKey);

  denyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ip = denyForm.ip.value.trim();
    if (!ip) return;
    const list = [...(peopleState.moderation.ipDenyList || [])];
    if (!list.includes(ip)) list.push(ip);
    try {
      acceptPeople(await api('/admin/api/moderation', {
        method: 'PUT',
        body: JSON.stringify({ ipDenyList: list })
      }));
      denyForm.ip.value = '';
      showToast(t('people.denyAdded'));
      renderPeopleList();
    } catch (error) {
      showToast(error.message, 'err');
    }
  });

  denyRevertButton.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: t('room.revert'),
      copy: t('people.denyHint'),
      ok: t('people.denyRevert')
    });
    if (!ok) return;
    try {
      acceptPeople(await api('/admin/api/moderation', { method: 'DELETE' }));
      showToast(t('people.denyReverted'));
      renderPeopleList();
    } catch (error) {
      showToast(error.message, 'err');
    }
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    await withBusy(loginSubmit, 'login.submitting', async () => {
      try {
        await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ token: tokenInput.value }) });
        tokenInput.value = '';
        tokenInput.type = 'password';
        paintReveal(tokenReveal, tokenInput);
        await load();
        if (!location.hash || location.hash === '#') location.hash = '#/overview';
        showDesk();
        renderRoute();
      } catch (error) {
        loginError.textContent = error.code === 'OPERATOR_RATE_LIMITED' ? t('login.rate')
          : error.code === 'OPERATOR_UNAUTHORIZED' ? t('login.error')
            : t('login.failed');
      }
    });
  });

  document.getElementById('logoutButton').addEventListener('click', async () => {
    if (!(await guardLeave())) return;
    try { await api('/admin/api/logout', { method: 'POST', body: '{}' }); } catch { /* still leave */ }
    ignoreHash = true;
    location.hash = '';
    showLogin();
    requestAnimationFrame(() => { ignoreHash = false; });
  });

  roomForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await withBusy(roomSaveButton, 'form.saving', async () => {
      try {
        acceptPavilion(await api('/admin/api/pavilion/room', {
          method: 'PUT',
          body: JSON.stringify({
            title: roomForm.title.value.trim(),
            defaultLanguage: roomForm.defaultLanguage.value,
            defaultChannel: roomForm.defaultChannel.value,
            maxUsers: Number(roomForm.maxUsers.value),
            exposeMemberIps: roomForm.exposeMemberIps.checked,
            exposeLanUrls: roomForm.exposeLanUrls.checked
          })
        }));
        dashboard = await api('/admin/api/dashboard');
        fillRoomForm();
        setHead({
          title: t('room.pageTitle'),
          lead: t('room.lead'),
          crumb: t('nav.groupPavilo'),
          source: pavilion.sources?.room
        });
        showToast(t('room.saved'));
      } catch (error) {
        showToast(error.message, 'err');
      }
    });
  });

  roomRevertButton.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: t('room.revert'),
      copy: t('room.revertConfirm'),
      ok: t('room.revert')
    });
    if (!ok) return;
    try {
      acceptPavilion(await api('/admin/api/pavilion/room', { method: 'DELETE' }));
      dashboard = await api('/admin/api/dashboard');
      fillRoomForm();
      setHead({
        title: t('room.pageTitle'),
        lead: t('room.lead'),
        crumb: t('nav.groupPavilo'),
        source: pavilion.sources?.room
      });
      showToast(t('room.reverted'));
    } catch (error) {
      showToast(error.message, 'err');
    }
  });

  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = chatPayloadFromForm();
    const list = pavilion.channels.some((channel) => channel.id === next.id)
      ? pavilion.channels.map((channel) => (channel.id === next.id ? next : channel))
      : pavilion.channels.concat(next);
    await withBusy(chatSaveButton, 'form.saving', async () => {
      try {
        acceptPavilion(await api('/admin/api/pavilion/channels', {
          method: 'PUT',
          body: JSON.stringify({ channels: list })
        }));
        clearDirty();
        location.hash = `#/chat/${encodeURIComponent(next.id)}`;
        renderRoute();
        showToast(t('chat.saved'));
      } catch (error) {
        showToast(error.message, 'err');
      }
    });
  });

  chatDeleteButton.addEventListener('click', async () => {
    const id = chatForm.id.value.trim();
    if (!id) return;
    const ok = await confirmDialog({
      title: t('chat.delete'),
      copy: t('chat.deleteConfirm', { id }),
      ok: t('chat.delete'),
      danger: true
    });
    if (!ok) return;
    const list = pavilion.channels.filter((channel) => channel.id !== id);
    try {
      acceptPavilion(await api('/admin/api/pavilion/channels', {
        method: 'PUT',
        body: JSON.stringify({ channels: list })
      }));
      clearDirty();
      trackedForm = null;
      location.hash = '#/chat';
      renderRoute();
      showToast(t('chat.deleted'));
    } catch (error) {
      showToast(error.message, 'err');
    }
  });

  async function revertChat() {
    const ok = await confirmDialog({
      title: t('chat.revert'),
      copy: t('chat.revertConfirm'),
      ok: t('chat.revert')
    });
    if (!ok) return;
    try {
      acceptPavilion(await api('/admin/api/pavilion/channels', { method: 'DELETE' }));
      renderChatList();
      setHead({
        title: t('chat.pageTitle'),
        lead: t('chat.lead'),
        crumb: t('nav.groupPavilo'),
        source: pavilion.sources?.channels,
        action: addAction('#/chat/new', t('chat.add'))
      });
      showToast(t('chat.reverted'));
    } catch (error) {
      showToast(error.message, 'err');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = form.id.value.trim();
    const body = {
      preset: form.preset.value,
      label: form.label.value,
      model: form.model.value,
      baseUrl: form.baseUrl.value,
      enabled: form.enabled.checked
    };
    if (form.apiKey.value) body.apiKey = form.apiKey.value;
    await withBusy(saveButton, 'form.saving', async () => {
      try {
        await api(`/admin/api/channels/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
        await load();
        clearDirty();
        location.hash = `#/gateway/channels/${encodeURIComponent(id)}`;
        renderRoute();
        showToast(t('channel.saved'));
      } catch (error) {
        showToast(error.message, 'err');
      }
    });
  });

  probeButton.addEventListener('click', async () => {
    const id = form.id.value.trim();
    if (!id || form.id.readOnly === false) {
      probeResult.hidden = false;
      probeResult.className = 'probe-result fail';
      probeResult.textContent = t('channel.probeNeedSave');
      showToast(t('channel.probeNeedSave'), 'err');
      return;
    }
    await withBusy(probeButton, null, async () => {
      try {
        const payload = await api(`/admin/api/channels/${encodeURIComponent(id)}/probe`, { method: 'POST', body: '{}' });
        const result = payload.result || payload;
        const ok = Boolean(result.ok);
        probeResult.hidden = false;
        probeResult.className = `probe-result ${ok ? 'ok' : 'fail'}`;
        probeResult.textContent = ok
          ? t('channel.probeOk', { model: result.model || '', ms: result.latencyMs || 0 })
          : t('channel.probeFail', { code: result.code || 'error' });
        showToast(probeResult.textContent, ok ? undefined : 'err');
        usage = await api('/admin/api/usage?days=7');
      } catch (error) {
        const result = error.payload?.result;
        const message = t('channel.probeFail', { code: result?.code || error.code || 'error' });
        probeResult.hidden = false;
        probeResult.className = 'probe-result fail';
        probeResult.textContent = message;
        showToast(message, 'err');
      }
    });
  });

  form.preset.addEventListener('change', () => {
    if (form.preset.value === 'deepseek') {
      if (!form.baseUrl.value || form.baseUrl.value === DEEPSEEK_BASE) form.baseUrl.value = DEEPSEEK_BASE;
      if (!form.model.value) form.model.value = DEEPSEEK_MODEL;
    }
    refreshDirty();
  });

  deleteButton.addEventListener('click', async () => {
    const id = form.id.value.trim();
    if (!id) return;
    const ok = await confirmDialog({
      title: t('channel.delete'),
      copy: t('channel.deleteConfirm', { id }),
      ok: t('channel.delete'),
      danger: true
    });
    if (!ok) return;
    try {
      await api(`/admin/api/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      clearDirty();
      trackedForm = null;
      location.hash = '#/gateway/channels';
      renderRoute();
      showToast(t('channel.deleted'));
    } catch (error) {
      showToast(error.message, 'err');
    }
  });

  [roomForm, chatForm, form].forEach((node) => {
    node.addEventListener('input', refreshDirty);
    node.addEventListener('change', refreshDirty);
  });

  document.querySelectorAll('.lang').forEach((button) => {
    button.addEventListener('click', () => {
      i18n.setLanguage(button.getAttribute('data-lang'));
      if (!desk.hidden) renderRoute();
      else paintI18n();
    });
  });

  menuButton.addEventListener('click', () => setNavOpen(!desk.classList.contains('nav-open')));
  railBackdrop.addEventListener('click', () => setNavOpen(false));
  desk.querySelectorAll('.rail-nav a, .rail-brand').forEach((link) => {
    link.addEventListener('click', () => setNavOpen(false));
  });

  dialogCancel.addEventListener('click', () => closeDialog(false));
  dialogOk.addEventListener('click', () => closeDialog(true));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(false);
  });
  dialog.addEventListener('keydown', (event) => {
    if (dialog.hidden || event.key !== 'Tab') return;
    const focusable = [dialogCancel, dialogOk];
    const index = focusable.indexOf(document.activeElement);
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        dialogOk.focus();
      }
    } else if (index === focusable.length - 1 || index === -1) {
      event.preventDefault();
      dialogCancel.focus();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!dialog.hidden) {
      event.preventDefault();
      closeDialog(false);
      return;
    }
    if (desk.classList.contains('nav-open')) setNavOpen(false);
  });

  window.addEventListener('hashchange', async () => {
    if (ignoreHash || desk.hidden) return;
    if (!(await guardLeave())) {
      ignoreHash = true;
      location.hash = lastHash;
      requestAnimationFrame(() => { ignoreHash = false; });
      return;
    }
    renderRoute();
  });

  window.addEventListener('beforeunload', (event) => {
    refreshDirty();
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  paintI18n();
  api('/admin/api/session').then(async () => {
    await load();
    if (!location.hash || location.hash === '#') location.hash = '#/overview';
    showDesk();
    renderRoute();
  }).catch(() => {
    showLogin();
  });
})();
