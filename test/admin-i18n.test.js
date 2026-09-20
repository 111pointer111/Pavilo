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
  assert.equal(i18n.t('channel.delete'), '删除');
  assert.equal(i18n.t('channel.deleted'), '已删除');
  assert.equal(i18n.t('nav.overview'), '总览');
  assert.equal(i18n.t('nav.groupGateway'), 'AI 网关');
  assert.equal(i18n.t('later.flag'), '稍后开放');
});

test('admin copy no longer describes YAML as a channel source', () => {
  const blob = `${JSON.stringify(catalogs['zh-CN'])}\n${JSON.stringify(catalogs.en)}`;
  assert.doesNotMatch(blob, /认领|Fell back|Drop claim/i);
});
