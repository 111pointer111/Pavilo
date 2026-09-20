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
  const loginError = document.getElementById('loginError');
  const pageTitle = document.getElementById('pageTitle');
  const pageLead = document.getElementById('pageLead');
  const pageCrumb = document.getElementById('pageCrumb');
  const overviewCards = document.getElementById('overviewCards');
  const overviewNext = document.getElementById('overviewNext');
  const gatewayCards = document.getElementById('gatewayCards');
  const gatewayNext = document.getElementById('gatewayNext');
  const channelList = document.getElementById('channelList');
  const usageBox = document.getElementById('usageBox');
  const form = document.getElementById('channelForm');
  const keyHelp = document.getElementById('keyHelp');
  const saveButton = document.getElementById('saveButton');
  const probeButton = document.getElementById('probeButton');
  const deleteButton = document.getElementById('deleteButton');
  const roomForm = document.getElementById('roomForm');
  const roomSource = document.getElementById('roomSource');
  const roomDefaultChannel = document.getElementById('roomDefaultChannel');
  const roomMaxUsersHint = document.getElementById('roomMaxUsersHint');
  const roomSaveButton = document.getElementById('roomSaveButton');
  const roomRevertButton = document.getElementById('roomRevertButton');
  const chatList = document.getElementById('chatList');
  const chatSource = document.getElementById('chatSource');
  const chatForm = document.getElementById('chatForm');
  const chatPlayRow = document.getElementById('chatPlayRow');
  const chatPlay = document.getElementById('chatPlay');
  const chatSaveButton = document.getElementById('chatSaveButton');
  const chatDeleteButton = document.getElementById('chatDeleteButton');
  const chatRevertButton = document.getElementById('chatRevertButton');
  const toast = document.getElementById('toast');
  const views = {
    overview: document.getElementById('viewOverview'),
    room: document.getElementById('viewRoom'),
    chat: document.getElementById('viewChat'),
    chatForm: document.getElementById('viewChatForm'),
    gateway: document.getElementById('viewGateway'),
    channels: document.getElementById('viewChannels'),
    form: document.getElementById('viewChannelForm'),
    usage: document.getElementById('viewUsage')
  };
  const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
  const DEEPSEEK_MODEL = 'deepseek-chat';

  let session = null;
  let dashboard = null;
  let channels = [];
  let pavilion = {
    sources: { room: 'yaml', channels: 'yaml' },
    room: {},
    channels: [],
    plays: [],
    occupancy: {},
    maxUsersCap: 80
  };
  let usage = { tracking: true, rows: [] };
  let toastTimer = 0;

  function t(key, vars) { return i18n.t(key, vars); }

  function paintI18n() {
    i18n.apply(document);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
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
    if (!response.ok && payload.ok === false) {
      const error = new Error(payload.message || payload.code || 'error');
      error.code = payload.code;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function showLogin() {
    desk.hidden = true;
    loginScreen.hidden = false;
    session = null;
  }

  function showDesk() {
    loginScreen.hidden = true;
    desk.hidden = false;
  }

  function parseRoute() {
    const raw = (location.hash || '#/overview').replace(/^#/, '') || '/overview';
    let parts = raw.split('/').filter(Boolean);
    let path = `/${parts.join('/')}`;
    if (parts[0] === 'usage') path = '/gateway/usage';
    else if (parts[0] === 'channels') path = `/gateway/${parts.join('/')}`;
    if (`#${path}` !== location.hash && (parts[0] === 'usage' || parts[0] === 'channels')) {
      history.replaceState(null, '', `#${path}`);
      parts = path.split('/').filter(Boolean);
    }
    if (parts[0] === 'room') return { view: 'room' };
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

  function setHead(title, lead, crumb) {
    pageTitle.textContent = title;
    pageLead.textContent = lead;
    pageCrumb.textContent = crumb;
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

  function renderOverview() {
    const room = dashboard?.room || {};
    const sources = pavilion.sources || {};
    overviewCards.replaceChildren();
    const cards = [
      [t('overview.room'), pavilion.room?.title || String(room.users ?? 0), `${t('overview.users')} ${room.users ?? 0} · ${t(sources.room === 'operator' ? 'overview.sourceOperator' : 'overview.sourceYaml')}`],
      [t('overview.chat'), t('overview.channelCount', { count: pavilion.channels.length }), `${t('overview.chatHint')} · ${t(sources.channels === 'operator' ? 'overview.sourceOperator' : 'overview.sourceYaml')}`],
      [t('gateway.title'), t('overview.channelCount', { count: channels.length }), t('gateway.lead')]
    ];
    for (const [kicker, value, detail] of cards) {
      const card = el('article', 'card');
      card.append(el('p', 'kicker', kicker), el('strong', '', value), el('p', '', detail));
      overviewCards.append(card);
    }
    overviewNext.replaceChildren();
    const roomLink = el('a', 'button', t('overview.openRoom'));
    roomLink.href = '#/room';
    const chatLink = el('a', 'button ghost', t('overview.openChat'));
    chatLink.href = '#/chat';
    const gateway = el('a', 'button ghost', t('overview.openGateway'));
    gateway.href = '#/gateway';
    overviewNext.append(roomLink, chatLink, gateway);
  }

  function renderGatewayOverview() {
    const enabled = channels.filter((channel) => channel.enabled).length;
    const missing = channels.filter((channel) => !channel.keyPresent || channel.unwrapFailed).length;
    const requests = usage.rows.reduce((sum, row) => sum + (row.requests || 0), 0);
    const errors = usage.rows.reduce((sum, row) => sum + (row.errors || 0), 0);
    gatewayCards.replaceChildren();
    const cards = [
      [t('overview.channels'), t('overview.channelCount', { count: channels.length }), `${t('overview.enabled', { count: enabled })} · ${t('overview.missingKey', { count: missing })}`],
      [t('overview.usage'), String(requests), `${t('overview.requests', { count: requests })} · ${t('overview.errors', { count: errors })}`]
    ];
    for (const [kicker, value, detail] of cards) {
      const card = el('article', 'card');
      card.append(el('p', 'kicker', kicker), el('strong', '', value), el('p', '', detail));
      gatewayCards.append(card);
    }
    gatewayNext.replaceChildren();
    const primary = el('a', 'button', channels.length ? t('overview.viewChannels') : t('overview.addFirst'));
    primary.href = channels.length ? '#/gateway/channels' : '#/gateway/channels/new';
    const secondary = el('a', 'button ghost', t('overview.viewUsage'));
    secondary.href = '#/gateway/usage';
    gatewayNext.append(primary, secondary);
  }

  function fillRoomForm() {
    const room = pavilion.room || {};
    paintSource(roomSource, pavilion.sources?.room);
    roomForm.title.value = room.title || '';
    roomForm.defaultLanguage.value = room.defaultLanguage || 'zh-CN';
    roomForm.maxUsers.value = room.maxUsers || 1;
    roomForm.maxUsers.max = pavilion.maxUsersCap || room.maxUsers || 1;
    roomForm.exposeMemberIps.checked = room.exposeMemberIps !== false;
    roomForm.exposeLanUrls.checked = room.exposeLanUrls !== false;
    roomMaxUsersHint.textContent = t('room.maxUsersHint', { cap: pavilion.maxUsersCap || room.maxUsers || 1 });
    roomDefaultChannel.replaceChildren();
    for (const channel of pavilion.channels) {
      const option = document.createElement('option');
      option.value = channel.id;
      option.textContent = `${channel.name} (${channel.id})`;
      if (channel.id === room.defaultChannel) option.selected = true;
      roomDefaultChannel.append(option);
    }
    const canWrite = writable();
    roomSaveButton.disabled = !canWrite;
    roomRevertButton.hidden = pavilion.sources?.room !== 'operator';
    roomRevertButton.disabled = !canWrite;
  }

  function renderChatList() {
    paintSource(chatSource, pavilion.sources?.channels);
    chatRevertButton.hidden = pavilion.sources?.channels !== 'operator';
    chatRevertButton.disabled = !writable();
    chatList.replaceChildren();
    if (!pavilion.channels.length) {
      const empty = el('div', 'empty paper');
      empty.append(el('h2', '', t('chat.empty')), el('p', '', t('chat.emptyHint')));
      const add = el('a', 'button', t('chat.add'));
      add.href = '#/chat/new';
      empty.append(add);
      chatList.append(empty);
      return;
    }
    const list = el('div', 'rows');
    for (const channel of pavilion.channels) {
      const row = el('a', 'row');
      row.href = `#/chat/${encodeURIComponent(channel.id)}`;
      const identity = el('div');
      identity.append(el('code', '', channel.id), el('div', 'name', channel.name));
      const badge = el('span', `badge${channel.enabled ? '' : ' off'}`, channel.enabled ? t('chat.enabledOn') : t('chat.enabledOff'));
      row.append(identity, el('div', 'name', channel.description || ''), badge);
      if (channel.readOnly) row.append(el('span', 'badge', t('chat.readOnlyOn')));
      list.append(row);
    }
    chatList.append(list);
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
    chatDeleteButton.hidden = !editing;
    const canWrite = writable();
    chatSaveButton.disabled = !canWrite;
    chatDeleteButton.disabled = !canWrite;
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
    const list = el('div', 'rows');
    for (const channel of channels) {
      const row = el('a', 'row');
      row.href = `#/gateway/channels/${encodeURIComponent(channel.id)}`;
      const identity = el('div');
      identity.append(el('code', '', channel.id), el('div', 'name', channel.label || channel.preset));
      const badge = el('span', `badge${channel.enabled ? '' : ' off'}`, channel.enabled ? t('channel.enabledOn') : t('channel.enabledOff'));
      const key = el('span', `badge${channel.keyPresent && !channel.unwrapFailed ? '' : ' warn'}`, channel.keyPresent && !channel.unwrapFailed ? t('channel.keyOn') : t('channel.keyOff'));
      row.append(identity, el('div', 'name', channel.preset), badge, key);
      list.append(row);
    }
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
    form.enabled.checked = channel ? channel.enabled !== false : true;
    deleteButton.hidden = !editing;
    probeButton.disabled = !editing;
    if (!channel) keyHelp.textContent = t('channel.keyMissing');
    else if (channel.unwrapFailed) keyHelp.textContent = t('channel.keyUnwrap');
    else if (channel.keyPresent) keyHelp.textContent = t('channel.keyKeep', { hint: channel.keyHint });
    else keyHelp.textContent = t('channel.keyMissing');
  }

  function renderUsage() {
    usageBox.replaceChildren();
    if (!usage.rows.length) {
      const empty = el('div', 'empty');
      empty.append(el('h2', '', t('usage.empty')), el('p', '', t('usage.emptyHint')));
      usageBox.append(empty);
      return;
    }
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const key of ['usage.day', 'usage.channel', 'usage.requests', 'usage.tokens', 'usage.errors']) {
      head.append(el('th', '', t(key)));
    }
    table.append(head);
    for (const row of usage.rows) {
      const tr = document.createElement('tr');
      tr.append(
        el('td', '', row.day),
        el('td', '', row.channelId),
        el('td', 'num', String(row.requests)),
        el('td', 'num', String((row.promptTokens || 0) + (row.completionTokens || 0))),
        el('td', 'num', String(row.errors || 0))
      );
      table.append(tr);
    }
    usageBox.append(table);
  }

  function renderRoute() {
    const route = parseRoute();
    paintI18n();
    saveButton.disabled = session ? !session.writable : true;
    deleteButton.disabled = session ? !session.writable : true;
    if (route.view === 'overview') {
      markNav('overview');
      setHead(t('overview.title'), t('overview.lead'), t('nav.groupPavilo'));
      showView('overview');
      renderOverview();
      return;
    }
    if (route.view === 'room') {
      markNav('room');
      setHead(t('room.pageTitle'), t('room.lead'), t('nav.groupPavilo'));
      showView('room');
      fillRoomForm();
      return;
    }
    if (route.view === 'chat') {
      markNav('chat');
      setHead(t('chat.pageTitle'), t('chat.lead'), t('nav.groupPavilo'));
      showView('chat');
      renderChatList();
      return;
    }
    if (route.view === 'chatForm') {
      markNav('chat');
      const channel = route.id ? pavilion.channels.find((entry) => entry.id === route.id) : null;
      if (route.id && !channel) {
        location.hash = '#/chat';
        return;
      }
      setHead(
        channel ? t('chat.editTitle', { id: channel.id }) : t('chat.newTitle'),
        channel ? t('chat.editLead') : t('chat.newLead'),
        t('nav.groupPavilo')
      );
      showView('chatForm');
      fillChatForm(channel);
      return;
    }
    if (route.view === 'gateway') {
      markNav('gateway');
      setHead(t('gateway.title'), t('gateway.lead'), t('nav.groupGateway'));
      showView('gateway');
      renderGatewayOverview();
      return;
    }
    if (route.view === 'channels') {
      markNav('gateway-channels');
      setHead(t('channels.title'), t('channels.lead'), t('nav.groupGateway'));
      showView('channels');
      renderChannels();
      return;
    }
    if (route.view === 'usage') {
      markNav('gateway-usage');
      setHead(t('usage.title'), t('usage.lead'), t('nav.groupGateway'));
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
    setHead(
      channel ? t('channel.editTitle', { id: channel.id }) : t('channel.newTitle'),
      channel ? t('channel.editLead') : t('channel.newLead'),
      t('nav.groupGateway')
    );
    showView('form');
    fillForm(channel);
  }

  async function load() {
    dashboard = await api('/admin/api/dashboard');
    session = dashboard.session;
    channels = (await api('/admin/api/channels')).channels || [];
    usage = await api('/admin/api/usage?days=7');
    pavilion = await api('/admin/api/pavilion');
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    try {
      await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ token: tokenInput.value }) });
      tokenInput.value = '';
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

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try { await api('/admin/api/logout', { method: 'POST', body: '{}' }); } catch { /* still leave */ }
    location.hash = '';
    showLogin();
  });

  roomForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      pavilion = await api('/admin/api/pavilion/room', {
        method: 'PUT',
        body: JSON.stringify({
          title: roomForm.title.value.trim(),
          defaultLanguage: roomForm.defaultLanguage.value,
          defaultChannel: roomForm.defaultChannel.value,
          maxUsers: Number(roomForm.maxUsers.value),
          exposeMemberIps: roomForm.exposeMemberIps.checked,
          exposeLanUrls: roomForm.exposeLanUrls.checked
        })
      });
      dashboard = await api('/admin/api/dashboard');
      fillRoomForm();
      showToast(t('room.saved'));
    } catch (error) {
      showToast(error.message);
    }
  });

  roomRevertButton.addEventListener('click', async () => {
    if (!window.confirm(t('room.revertConfirm'))) return;
    try {
      pavilion = await api('/admin/api/pavilion/room', { method: 'DELETE' });
      dashboard = await api('/admin/api/dashboard');
      fillRoomForm();
      showToast(t('room.reverted'));
    } catch (error) {
      showToast(error.message);
    }
  });

  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = chatPayloadFromForm();
    const list = pavilion.channels.some((channel) => channel.id === next.id)
      ? pavilion.channels.map((channel) => (channel.id === next.id ? next : channel))
      : pavilion.channels.concat(next);
    try {
      pavilion = await api('/admin/api/pavilion/channels', {
        method: 'PUT',
        body: JSON.stringify({ channels: list })
      });
      location.hash = `#/chat/${encodeURIComponent(next.id)}`;
      renderRoute();
      showToast(t('chat.saved'));
    } catch (error) {
      showToast(error.message);
    }
  });

  chatDeleteButton.addEventListener('click', async () => {
    const id = chatForm.id.value.trim();
    if (!id) return;
    if (!window.confirm(t('chat.deleteConfirm', { id }))) return;
    const list = pavilion.channels.filter((channel) => channel.id !== id);
    try {
      pavilion = await api('/admin/api/pavilion/channels', {
        method: 'PUT',
        body: JSON.stringify({ channels: list })
      });
      location.hash = '#/chat';
      renderRoute();
      showToast(t('chat.deleted'));
    } catch (error) {
      showToast(error.message);
    }
  });

  chatRevertButton.addEventListener('click', async () => {
    if (!window.confirm(t('chat.revertConfirm'))) return;
    try {
      pavilion = await api('/admin/api/pavilion/channels', { method: 'DELETE' });
      renderChatList();
      showToast(t('chat.reverted'));
    } catch (error) {
      showToast(error.message);
    }
  });

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
    try {
      await api(`/admin/api/channels/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
      await load();
      location.hash = `#/gateway/channels/${encodeURIComponent(id)}`;
      renderRoute();
      showToast(t('channel.saved'));
    } catch (error) {
      showToast(error.message);
    }
  });

  probeButton.addEventListener('click', async () => {
    const id = form.id.value.trim();
    if (!id || form.id.readOnly === false) {
      showToast(t('channel.probeNeedSave'));
      return;
    }
    try {
      const payload = await api(`/admin/api/channels/${encodeURIComponent(id)}/probe`, { method: 'POST', body: '{}' });
      const result = payload.result || payload;
      showToast(result.ok
        ? t('channel.probeOk', { model: result.model || '', ms: result.latencyMs || 0 })
        : t('channel.probeFail', { code: result.code || 'error' }));
      usage = await api('/admin/api/usage?days=7');
    } catch (error) {
      const result = error.payload?.result;
      showToast(t('channel.probeFail', { code: result?.code || error.code || 'error' }));
    }
  });

  form.preset.addEventListener('change', () => {
    if (form.preset.value === 'deepseek') {
      if (!form.baseUrl.value || form.baseUrl.value === DEEPSEEK_BASE) form.baseUrl.value = DEEPSEEK_BASE;
      if (!form.model.value) form.model.value = DEEPSEEK_MODEL;
    }
  });

  deleteButton.addEventListener('click', async () => {
    const id = form.id.value.trim();
    if (!id) return;
    if (!window.confirm(t('channel.deleteConfirm', { id }))) return;
    try {
      await api(`/admin/api/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      location.hash = '#/gateway/channels';
      renderRoute();
      showToast(t('channel.deleted'));
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelectorAll('.lang').forEach((button) => {
    button.addEventListener('click', () => {
      i18n.setLanguage(button.getAttribute('data-lang'));
      if (!desk.hidden) renderRoute();
      else paintI18n();
    });
  });

  window.addEventListener('hashchange', () => {
    if (!desk.hidden) renderRoute();
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
