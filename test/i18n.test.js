'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  SUPPORTED, DEFAULT_LANGUAGE, STORAGE_KEY, catalogs, createI18n, normalizeLanguage, missingKeys,
} = require('../client/i18n');

test('catalogs cover the same keys in zh-CN and en', () => {
  const { missingInEn, missingInZh } = missingKeys();
  assert.deepEqual(missingInEn, []);
  assert.deepEqual(missingInZh, []);
  assert.ok(Object.keys(catalogs['zh-CN']).length > 80);
});

test('normalizeLanguage maps aliases and falls back', () => {
  assert.equal(normalizeLanguage('zh-CN'), 'zh-CN');
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('zh'), 'zh-CN');
  assert.equal(normalizeLanguage('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('fr'), 'zh-CN');
  assert.equal(normalizeLanguage(null, 'en'), 'en');
});

test('createI18n interpolates, falls back, and persists the choice', () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
  };
  const i18n = createI18n({ language: 'en', storage });
  assert.equal(i18n.language, 'en');
  assert.equal(i18n.t('composer.send'), 'Send');
  assert.equal(i18n.t('login.retrying', { attempt: 2, max: 3 }), 'Could not reach the service, retrying (2/3)…');
  assert.equal(i18n.t('does.not.exist'), 'does.not.exist');
  i18n.setLanguage('zh-CN');
  assert.equal(i18n.language, 'zh-CN');
  assert.equal(store.get(STORAGE_KEY), 'zh-CN');
  assert.equal(i18n.t('composer.send'), '发送');
});

test('stored language wins over the configured default', () => {
  const storage = {
    getItem: () => 'en',
    setItem() {},
  };
  const i18n = createI18n({ defaultLanguage: 'zh-CN', storage });
  assert.equal(i18n.language, 'en');
});

test('explicit language option wins over storage', () => {
  const storage = {
    getItem: () => 'en',
    setItem() {},
  };
  const i18n = createI18n({ language: 'zh-CN', storage });
  assert.equal(i18n.language, 'zh-CN');
});

test('subscribers fire only when the language actually changes', () => {
  const seen = [];
  const i18n = createI18n({ language: 'zh-CN', storage: null });
  const stop = i18n.subscribe((language) => seen.push(language));
  i18n.setLanguage('zh-CN');
  i18n.setLanguage('en');
  i18n.setLanguage('en-GB');
  stop();
  i18n.setLanguage('zh-CN');
  assert.deepEqual(seen, ['en']);
  assert.deepEqual([...SUPPORTED], ['zh-CN', 'en']);
  assert.equal(DEFAULT_LANGUAGE, 'zh-CN');
});

test('upgrade strings exist in both catalogs', () => {
  const zh = createI18n({ language: 'zh-CN', storage: null });
  const en = createI18n({ language: 'en', storage: null });
  assert.match(zh.t('upgrade.title'), /升级/);
  assert.match(en.t('upgrade.title'), /upgraded/i);
  assert.match(zh.t('upgrade.action'), /刷新/);
  assert.equal(en.t('upgrade.action'), 'Reload');
});
