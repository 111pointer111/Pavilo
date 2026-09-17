const assert = require('node:assert/strict');
const { test } = require('node:test');

const ErrorStates = require('../client/error-states.js');

test('error-states', async (t) => {
  await t.test('exports ERROR_TYPES constant', () => {
    assert.ok(ErrorStates.ERROR_TYPES);
    assert.equal(typeof ErrorStates.ERROR_TYPES, 'object');
    assert.ok(ErrorStates.ERROR_TYPES.OFFLINE);
    assert.ok(ErrorStates.ERROR_TYPES.SERVICE_STOPPED);
    assert.ok(ErrorStates.ERROR_TYPES.CHANNEL_FULL);
  });

  await t.test('ERROR_TYPES contains required fields', () => {
    const { OFFLINE, CONNECTION_FAILED, SERVICE_STOPPED } = ErrorStates.ERROR_TYPES;

    // OFFLINE
    assert.equal(OFFLINE.level, 'warning');
    assert.equal(OFFLINE.recoverable, true);
    assert.ok(OFFLINE.message);
    assert.ok(OFFLINE.icon);

    // CONNECTION_FAILED
    assert.equal(CONNECTION_FAILED.level, 'error');
    assert.equal(CONNECTION_FAILED.recoverable, true);
    assert.ok(CONNECTION_FAILED.action);

    // SERVICE_STOPPED
    assert.equal(SERVICE_STOPPED.level, 'error');
    assert.equal(SERVICE_STOPPED.recoverable, false);
  });

  await t.test('createErrorStates returns API', async () => {
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

  await t.test('tracks error state', async () => {
    const controller = ErrorStates.createErrorStates({
      elements: { connectionDot: null, connectionText: null },
      toast: () => {},
      iconMarkup: () => '<svg></svg>',
      escapeHtml: (s) => s,
    });

    assert.equal(controller.hasError(), false);
    assert.equal(controller.getCurrentError(), null);

    controller.handleError('OFFLINE');
    assert.equal(controller.hasError(), true);
    assert.equal(controller.getCurrentError(), 'OFFLINE');

    controller.clearError();
    assert.equal(controller.hasError(), false);
    assert.equal(controller.getCurrentError(), null);
  });

  await t.test('calls toast for non-blocking errors', async () => {
    let toastCalled = false;
    let toastMessage = '';

    const controller = ErrorStates.createErrorStates({
      elements: { connectionDot: null, connectionText: null },
      toast: (msg) => {
        toastCalled = true;
        toastMessage = msg;
      },
      iconMarkup: () => '<svg></svg>',
      escapeHtml: (s) => s,
    });

    controller.handleError('CHANNEL_FULL');
    assert.equal(toastCalled, true);
    assert.ok(toastMessage.length > 0);
  });

  await t.test('updates connection status for network errors', async () => {
    const mockDot = { classList: { toggle: () => {} } };
    const mockText = { textContent: '' };

    const controller = ErrorStates.createErrorStates({
      elements: {
        connectionDot: mockDot,
        connectionText: mockText,
      },
      toast: () => {},
      iconMarkup: () => '<svg></svg>',
      escapeHtml: (s) => s,
    });

    controller.handleError('OFFLINE', { statusText: '网络已离线' });
    assert.ok(mockText.textContent.length > 0);
  });

  await t.test('clearError resets state', async () => {
    const controller = ErrorStates.createErrorStates({
      elements: { connectionDot: null, connectionText: null },
      toast: () => {},
      iconMarkup: () => '<svg></svg>',
      escapeHtml: (s) => s,
    });

    controller.handleError('CONNECTION_FAILED');
    assert.equal(controller.getCurrentError(), 'CONNECTION_FAILED');

    controller.clearError();
    assert.equal(controller.hasError(), false);
    assert.equal(controller.getCurrentError(), null);
  });
});
