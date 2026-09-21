'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const ErrorStates = require('../client/error-states.js');
const { createI18n } = require('../client/i18n');

test('error-states exports the known type keys', () => {
  assert.ok(ErrorStates.ERROR_TYPE_KEYS.includes('OFFLINE'));
  assert.ok(ErrorStates.ERROR_TYPE_KEYS.includes('PROTOCOL_NOT_SUPPORTED'));
  assert.ok(ErrorStates.ERROR_TYPE_KEYS.includes('KICKED'));
  assert.ok(ErrorStates.ERROR_TYPE_KEYS.includes('IP_DENIED'));
});

test('createErrorStates returns API', () => {
  const controller = ErrorStates.createErrorStates({
    elements: { connectionDot: null, connectionText: null },
    toast: () => {},
    iconMarkup: () => '<svg></svg>',
    escapeHtml: (s) => s,
  });
  assert.ok(controller.handleError);
  assert.ok(controller.clearError);
  assert.ok(controller.hasError);
  assert.ok(controller.getCurrentError);
  assert.ok(controller.setConnectionStatus);
});

test('tracks error state', () => {
  const controller = ErrorStates.createErrorStates({
    elements: { connectionDot: null, connectionText: null },
    toast: () => {},
    iconMarkup: () => '<svg></svg>',
    escapeHtml: (s) => s,
  });
  assert.equal(controller.hasError(), false);
  controller.handleError('OFFLINE');
  assert.equal(controller.hasError(), true);
  assert.equal(controller.getCurrentError(), 'OFFLINE');
  controller.clearError();
  assert.equal(controller.hasError(), false);
});

test('uses i18n copy for toasts', () => {
  const i18n = createI18n({ language: 'en', storage: null });
  let toastMessage = '';
  const controller = ErrorStates.createErrorStates({
    elements: { connectionDot: null, connectionText: null },
    toast: (msg) => { toastMessage = msg; },
    iconMarkup: () => '<svg></svg>',
    escapeHtml: (s) => s,
    t: i18n.t,
  });
  controller.handleError('CHANNEL_FULL');
  assert.equal(toastMessage, i18n.t('error.channelFull.detail'));
});

test('updates connection status for network errors', () => {
  const i18n = createI18n({ language: 'zh-CN', storage: null });
  const mockDot = { classList: { toggle: () => {} } };
  const mockText = { textContent: '' };
  const controller = ErrorStates.createErrorStates({
    elements: { connectionDot: mockDot, connectionText: mockText },
    toast: () => {},
    iconMarkup: () => '<svg></svg>',
    escapeHtml: (s) => s,
    t: i18n.t,
  });
  controller.handleError('OFFLINE', { statusText: i18n.t('status.offline'), showToast: false });
  assert.equal(mockText.textContent, i18n.t('status.offline'));
});

test('PROTOCOL_NOT_SUPPORTED overlay uses upgrade copy', () => {
  const i18n = createI18n({ language: 'zh-CN', storage: null });
  const overlay = { hidden: true, className: '', innerHTML: '', querySelector() { return null; }, focus() {} };
  const controller = ErrorStates.createErrorStates({
    elements: { connectionDot: null, connectionText: null, errorOverlay: overlay },
    toast: () => {},
    iconMarkup: () => '<svg></svg>',
    escapeHtml: (s) => s,
    t: i18n.t,
  });
  controller.showErrorOverlay('PROTOCOL_NOT_SUPPORTED');
  assert.equal(overlay.hidden, false);
  assert.match(overlay.innerHTML, /服务器已升级/);
  assert.match(overlay.innerHTML, /当前页面使用的协议已被服务器停用/);
});
