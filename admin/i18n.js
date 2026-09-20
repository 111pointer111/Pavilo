(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloAdminI18n = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SUPPORTED = Object.freeze(['zh-CN', 'en']);
  const STORAGE_KEY = 'pavilo.language';

  const catalogs = Object.freeze({
    'zh-CN': Object.freeze({
      'html.lang': 'zh-CN',
      'page.title': '语亭值班',
      'login.flag': 'OPERATOR / 值班台',
      'login.title': '管亭，<br>不进场。',
      'login.copy': '这里只给部署者配置模型渠道和查看用量。口令写在配置文件的 operator.token，推荐 openssl rand -hex 32。',
      'login.label': 'Operator token',
      'login.submit': '进入值班',
      'login.error': '口令不正确。',
      'login.rate': '尝试过多，请稍后再试。',
      'login.failed': '无法登录。',
      'top.desk': '语亭值班',
      'top.logout': '退出',
      'lang.zh': '中文',
      'lang.en': 'English',
      'status.storage': '存储',
      'status.gateway': '网关',
      'status.on': '开',
      'status.off': '关',
      'status.writable': '可编辑',
      'status.readonly': '只读',
      'status.readonlySqlite': '保存渠道和用量需要 sqlite。',
      'status.gatewayOff': '当前无法调用模型。请确认已启用 sqlite 并配置了 operator.token。',
      'channels.title': '渠道',
      'channels.empty': '还没有网关渠道。用下面的表单加一条 DeepSeek 或自定义 OpenAI 兼容端点。',
      'channels.add': '添加自定义渠道',
      'channel.sourceYaml': '未保存',
      'channel.sourceOperator': '已保存',
      'channel.probe': '探测',
      'channel.save': '保存',
      'channel.delete': '放弃认领',
      'channel.enabled': '启用',
      'channel.preset': 'Preset',
      'channel.id': '渠道 ID',
      'channel.label': '显示名',
      'channel.model': '模型',
      'channel.baseUrl': 'Base URL',
      'channel.apiKey': 'API key',
      'channel.keyKeep': '已保存 · 末位 {hint}。留空则保持原值。',
      'channel.keyMissing': '未配置。粘贴新密钥后保存。',
      'channel.keyUnwrap': '无法解密，可能已更换 operator.token。请重新填写密钥。',
      'channel.saved': '已保存',
      'channel.deleted': '已回到 YAML',
      'channel.probeOk': '连通 · {model} · {ms} ms',
      'channel.probeFail': '探测失败：{code}',
      'usage.title': '近 7 日用量',
      'usage.empty': '还没有调用记录。启用 sqlite 后，探测和后续审核 / 玩法才会记在这里。',
      'usage.none': '用量未跟踪（需要 sqlite）。',
      'usage.day': '日期',
      'usage.channel': '渠道',
      'usage.requests': '请求',
      'usage.tokens': 'tokens',
      'usage.errors': '失败'
    }),
    en: Object.freeze({
      'html.lang': 'en',
      'page.title': 'Pavilo operator',
      'login.flag': 'OPERATOR / desk',
      'login.title': 'Keep the pavilion,<br>don’t join the room.',
      'login.copy': 'This desk is for the deployer: model channels and usage. The password is operator.token in the YAML. Generate one with openssl rand -hex 32.',
      'login.label': 'Operator token',
      'login.submit': 'Open desk',
      'login.error': 'Wrong token.',
      'login.rate': 'Too many attempts. Try again later.',
      'login.failed': 'Could not sign in.',
      'top.desk': 'Pavilo operator',
      'top.logout': 'Sign out',
      'lang.zh': '中文',
      'lang.en': 'English',
      'status.storage': 'Storage',
      'status.gateway': 'Gateway',
      'status.on': 'on',
      'status.off': 'off',
      'status.writable': 'editable',
      'status.readonly': 'read-only',
      'status.readonlySqlite': 'Saving channels and usage needs sqlite.',
      'status.gatewayOff': 'The gateway cannot call models. Enable sqlite and set operator.token.',
      'channels.title': 'Channels',
      'channels.empty': 'No gateway channels yet. Add DeepSeek or an OpenAI-compatible endpoint below.',
      'channels.add': 'Add custom channel',
      'channel.sourceYaml': 'unsaved',
      'channel.sourceOperator': 'saved',
      'channel.probe': 'Probe',
      'channel.save': 'Save',
      'channel.delete': 'Drop claim',
      'channel.enabled': 'Enabled',
      'channel.preset': 'Preset',
      'channel.id': 'Channel ID',
      'channel.label': 'Label',
      'channel.model': 'Model',
      'channel.baseUrl': 'Base URL',
      'channel.apiKey': 'API key',
      'channel.keyKeep': 'Saved · last {hint}. Leave blank to keep.',
      'channel.keyMissing': 'Not set. Paste a key, then save.',
      'channel.keyUnwrap': 'Could not decrypt. The operator token may have changed. Enter the key again.',
      'channel.saved': 'Saved',
      'channel.deleted': 'Fell back to YAML',
      'channel.probeOk': 'Reachable · {model} · {ms} ms',
      'channel.probeFail': 'Probe failed: {code}',
      'usage.title': 'Usage, last 7 days',
      'usage.empty': 'No calls yet. With sqlite, probes and later safety / play traffic are counted here.',
      'usage.none': 'Usage is not tracked (sqlite required).',
      'usage.day': 'Day',
      'usage.channel': 'Channel',
      'usage.requests': 'Requests',
      'usage.tokens': 'tokens',
      'usage.errors': 'Errors'
    })
  });

  function interpolate(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (_, name) => (vars && vars[name] != null ? String(vars[name]) : ''));
  }

  function createI18n(initial) {
    let language = SUPPORTED.includes(initial) ? initial : 'zh-CN';
    function t(key, vars) {
      const table = catalogs[language] || catalogs['zh-CN'];
      return interpolate(table[key] || catalogs.en[key] || key, vars);
    }
    function setLanguage(next) {
      if (!SUPPORTED.includes(next) || next === language) return language;
      language = next;
      try { localStorage.setItem(STORAGE_KEY, language); } catch { /* ignore */ }
      return language;
    }
    return {
      t,
      language: () => language,
      setLanguage,
      apply(root) {
        root.querySelectorAll('[data-i18n]').forEach((node) => {
          node.textContent = t(node.getAttribute('data-i18n'));
        });
        root.querySelectorAll('[data-i18n-html]').forEach((node) => {
          node.innerHTML = t(node.getAttribute('data-i18n-html'));
        });
        document.documentElement.lang = t('html.lang');
        document.title = t('page.title');
      }
    };
  }

  return { SUPPORTED, STORAGE_KEY, catalogs, createI18n };
});
