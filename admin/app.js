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
  const statusBar = document.getElementById('statusBar');
  const channelList = document.getElementById('channelList');
  const usageBox = document.getElementById('usageBox');
  const form = document.getElementById('channelForm');
  const keyHelp = document.getElementById('keyHelp');
  const formNote = document.getElementById('formNote');
  const saveButton = document.getElementById('saveButton');
  const probeButton = document.getElementById('probeButton');
  const deleteButton = document.getElementById('deleteButton');

  let session = null;
  let channels = [];
  let selectedId = '';

  function t(key, vars) { return i18n.t(key, vars); }

  function paintI18n() {
    i18n.apply(document);
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

  function renderStatus() {
    if (!session) return;
    const bits = [
      `${t('status.storage')} ${session.storageDriver}`,
      `${t('status.gateway')} ${session.gatewayEnabled ? t('status.on') : t('status.off')}`,
      session.writable ? t('status.writable') : t('status.readonly')
    ];
    const extra = [];
    if (!session.writable) extra.push(t('status.readonlySqlite'));
    if (!session.gatewayEnabled) extra.push(t('status.gatewayOff'));
    statusBar.textContent = `${bits.join(' · ')}${extra.length ? ` — ${extra.join(' ')}` : ''}`;
    saveButton.disabled = !session.writable;
    deleteButton.disabled = !session.writable;
  }

  function fillForm(channel) {
    form.id.value = channel?.id || '';
    form.preset.value = channel?.preset || 'deepseek';
    form.label.value = channel?.label || '';
    form.model.value = channel?.model || '';
    form.baseUrl.value = channel?.baseUrl || '';
    form.apiKey.value = '';
    form.enabled.checked = channel ? channel.enabled !== false : true;
    if (!channel) keyHelp.textContent = t('channel.keyMissing');
    else if (channel.unwrapFailed) keyHelp.textContent = t('channel.keyUnwrap');
    else if (channel.keyPresent) keyHelp.textContent = t('channel.keyKeep', { hint: channel.keyHint });
    else keyHelp.textContent = t('channel.keyMissing');
  }

  function renderChannels() {
    channelList.replaceChildren();
    if (!channels.length) {
      const empty = document.createElement('p');
      empty.className = 'meta';
      empty.textContent = t('channels.empty');
      channelList.append(empty);
      return;
    }
    for (const channel of channels) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `channel${channel.id === selectedId ? ' active' : ''}`;
      const title = document.createElement('div');
      const code = document.createElement('code');
      code.textContent = channel.id;
      const label = document.createElement('div');
      label.textContent = channel.label || channel.preset;
      title.append(code, label);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = channel.source === 'operator' ? t('channel.sourceOperator') : t('channel.sourceYaml');
      button.append(title, meta);
      button.addEventListener('click', () => {
        selectedId = channel.id;
        fillForm(channel);
        renderChannels();
      });
      channelList.append(button);
    }
  }

  function renderUsage(payload) {
    usageBox.replaceChildren();
    if (!payload.tracking) {
      const note = document.createElement('p');
      note.className = 'meta';
      note.textContent = t('usage.none');
      usageBox.append(note);
      return;
    }
    if (!payload.rows.length) {
      const note = document.createElement('p');
      note.className = 'meta';
      note.textContent = t('usage.empty');
      usageBox.append(note);
      return;
    }
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const key of ['usage.day', 'usage.channel', 'usage.requests', 'usage.tokens', 'usage.errors']) {
      const th = document.createElement('th');
      th.textContent = t(key);
      head.append(th);
    }
    table.append(head);
    for (const row of payload.rows) {
      const tr = document.createElement('tr');
      const cells = [
        row.day,
        row.channelId,
        String(row.requests),
        String((row.promptTokens || 0) + (row.completionTokens || 0)),
        String(row.errors || 0)
      ];
      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      table.append(tr);
    }
    usageBox.append(table);
  }

  async function refresh() {
    const dashboard = await api('/admin/api/dashboard');
    session = dashboard.session;
    const listing = await api('/admin/api/channels');
    channels = listing.channels || [];
    if (selectedId && !channels.some((channel) => channel.id === selectedId)) selectedId = channels[0]?.id || '';
    if (!selectedId && channels[0]) selectedId = channels[0].id;
    const current = channels.find((channel) => channel.id === selectedId);
    fillForm(current);
    renderStatus();
    renderChannels();
    renderUsage(await api('/admin/api/usage?days=7'));
    paintI18n();
    renderStatus();
    renderChannels();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    try {
      await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ token: tokenInput.value }) });
      tokenInput.value = '';
      showDesk();
      await refresh();
    } catch (error) {
      loginError.textContent = error.code === 'OPERATOR_RATE_LIMITED' ? t('login.rate')
        : error.code === 'OPERATOR_UNAUTHORIZED' ? t('login.error')
          : t('login.failed');
    }
  });

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try { await api('/admin/api/logout', { method: 'POST', body: '{}' }); } catch { /* still leave */ }
    showLogin();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formNote.textContent = '';
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
      selectedId = id;
      formNote.textContent = t('channel.saved');
      await refresh();
    } catch (error) {
      formNote.textContent = error.message;
    }
  });

  probeButton.addEventListener('click', async () => {
    formNote.textContent = '';
    const id = form.id.value.trim();
    if (!id) return;
    try {
      const payload = await api(`/admin/api/channels/${encodeURIComponent(id)}/probe`, { method: 'POST', body: '{}' });
      const result = payload.result || payload;
      formNote.textContent = result.ok
        ? t('channel.probeOk', { model: result.model || '', ms: result.latencyMs || 0 })
        : t('channel.probeFail', { code: result.code || 'error' });
    } catch (error) {
      const result = error.payload?.result;
      formNote.textContent = t('channel.probeFail', { code: result?.code || error.code || 'error' });
    }
  });

  deleteButton.addEventListener('click', async () => {
    const id = form.id.value.trim();
    if (!id) return;
    formNote.textContent = '';
    try {
      await api(`/admin/api/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
      selectedId = '';
      formNote.textContent = t('channel.deleted');
      await refresh();
    } catch (error) {
      formNote.textContent = error.message;
    }
  });

  document.querySelectorAll('.lang').forEach((button) => {
    button.addEventListener('click', () => {
      i18n.setLanguage(button.getAttribute('data-lang'));
      paintI18n();
      renderStatus();
      renderChannels();
    });
  });

  paintI18n();
  api('/admin/api/session').then(() => {
    showDesk();
    return refresh();
  }).catch(() => {
    showLogin();
  });
})();
