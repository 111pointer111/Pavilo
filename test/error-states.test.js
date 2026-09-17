import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('error-states', () => {
  let ErrorStates;

  async function setup() {
    const module = await import('../client/error-states.js');
    ErrorStates = module;
  }

  it('exports ERROR_TYPES constant', async () => {
    await setup();
    assert.ok(ErrorStates.ERROR_TYPES);
    assert.equal(typeof ErrorStates.ERROR_TYPES, 'object');
    assert.ok(ErrorStates.ERROR_TYPES.OFFLINE);
    assert.ok(ErrorStates.ERROR_TYPES.SERVICE_STOPPED);
    assert.ok(ErrorStates.ERROR_TYPES.CHANNEL_FULL);
  });

  it('ERROR_TYPES contains required fields', async () => {
    await setup();
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

  it('createErrorStates returns API', async () => {
    await setup();
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

  it('tracks error state', async () => {
    await setup();
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

  it('calls toast for non-blocking errors', async () => {
    await setup();
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

  it('updates connection status for network errors', async () => {
    await setup();
    let statusUpdated = false;
    let statusLabel = '';

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

  it('clearError resets state', async () => {
    await setup();
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
