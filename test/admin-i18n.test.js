'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { catalogs, createI18n } = require('../admin/i18n');

test('admin i18n interpolates and keeps catalogs aligned', () => {
  assert.deepEqual(Object.keys(catalogs['zh-CN']).sort(), Object.keys(catalogs.en).sort());
  const i18n = createI18n('en');
  assert.equal(i18n.t('channel.probeFail', { code: 'GATEWAY_TIMEOUT' }), 'Probe failed: GATEWAY_TIMEOUT');
  i18n.setLanguage('zh-CN');
  assert.match(i18n.t('login.title'), /管亭/);
});
