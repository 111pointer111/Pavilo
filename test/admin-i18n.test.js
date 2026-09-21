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
  assert.equal(i18n.t('nav.people'), '人员');
  assert.equal(i18n.t('nav.groupGateway'), 'AI 网关');
  assert.equal(i18n.t('room.pageTitle'), '房间');
  assert.equal(i18n.t('chat.pageTitle'), '聊天频道');
  assert.equal(i18n.t('pavilion.loadError'), '无法载入当前配置。');
  assert.equal(i18n.t('form.unsavedTitle'), '放弃未保存的修改？');
  assert.match(i18n.t('overview.lead'), /这座亭/);
  assert.equal(i18n.t('overview.running'), '运行中');
  assert.match(i18n.t('overview.sqliteMeta', { size: '1 MB', count: 3, retention: '留 30 天' }), /1 MB/);
  assert.equal(catalogs.en['chat.lead'].includes('model channels'), true);
});

test('gateway copy does not describe YAML as a model-channel source', () => {
  const blob = `${catalogs['zh-CN']['channels.lead']}\n${catalogs.en['channels.lead']}\n${catalogs['zh-CN']['gateway.lead']}\n${catalogs.en['gateway.lead']}`;
  assert.doesNotMatch(blob, /认领|Fell back|Drop claim/i);
});
