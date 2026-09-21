(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloErrorStates = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 错误状态统一管理：为不同类型的错误提供一致的 UI 反馈
  // 文案全部走 i18n key，createErrorStates 内部维护一份类型表。
  const ERROR_TYPE_KEYS = Object.freeze(['OFFLINE', 'CONNECTING', 'CONNECTION_FAILED', 'RECONNECTING', 'SERVICE_STOPPED', 'SERVICE_UNAVAILABLE', 'CHANNEL_SWITCHING', 'CHANNEL_FULL', 'CHANNEL_UNAVAILABLE', 'CONFIG_LOAD_FAILED', 'PROTOCOL_NOT_SUPPORTED', 'KICKED', 'IP_DENIED']);

  function createErrorStates({ elements, toast, iconMarkup, escapeHtml, t = (key) => key }) {
    const { connectionDot, connectionText } = elements;
    const errorOverlay = elements.errorOverlay;
    let currentState = null;
    let overlayVisible = false;

    const ERROR_TYPES = {
      OFFLINE: {
        level: 'warning', recoverable: true, icon: 'wifi-off',
        messageKey: 'error.offline.message', detailKey: 'error.offline.detail',
      },
      CONNECTING: {
        level: 'info', recoverable: true, icon: 'loader',
        messageKey: 'error.connecting.message', detailKey: 'error.connecting.detail',
      },
      CONNECTION_FAILED: {
        level: 'error', recoverable: true, icon: 'wifi-off',
        messageKey: 'error.connectionFailed.message', detailKey: 'error.connectionFailed.detail',
        actionKey: 'error.connectionFailed.action',
      },
      RECONNECTING: {
        level: 'warning', recoverable: true, icon: 'refresh-cw',
        messageKey: 'error.reconnecting.message', detailKey: 'error.reconnecting.detail',
      },
      SERVICE_STOPPED: {
        level: 'error', recoverable: false, icon: 'circle-x',
        messageKey: 'error.serviceStopped.message', detailKey: 'error.serviceStopped.detail',
      },
      SERVICE_UNAVAILABLE: {
        level: 'error', recoverable: true, icon: 'server-crash',
        messageKey: 'error.serviceUnavailable.message', detailKey: 'error.serviceUnavailable.detail',
        actionKey: 'error.serviceUnavailable.action',
      },
      CHANNEL_SWITCHING: {
        level: 'info', recoverable: false, icon: 'loader',
        messageKey: 'error.channelSwitching.message', detailKey: 'error.channelSwitching.detail',
      },
      CHANNEL_FULL: {
        level: 'warning', recoverable: false, icon: 'users-round',
        messageKey: 'error.channelFull.message', detailKey: 'error.channelFull.detail',
      },
      CHANNEL_UNAVAILABLE: {
        level: 'error', recoverable: false, icon: 'circle-slash',
        messageKey: 'error.channelUnavailable.message', detailKey: 'error.channelUnavailable.detail',
      },
      CONFIG_LOAD_FAILED: {
        level: 'error', recoverable: true, icon: 'file-warning',
        messageKey: 'error.configFailed.message', detailKey: 'error.configFailed.detail',
        actionKey: 'error.configFailed.action',
      },
      PROTOCOL_NOT_SUPPORTED: {
        level: 'error', recoverable: false, icon: 'refresh-cw',
        messageKey: 'upgrade.title', detailKey: 'upgrade.detail',
        actionKey: 'upgrade.action',
      },
      KICKED: {
        level: 'error', recoverable: false, icon: 'circle-x',
        messageKey: 'error.kicked.message', detailKey: 'error.kicked.detail',
        actionKey: 'error.kicked.action',
      },
      IP_DENIED: {
        level: 'error', recoverable: false, icon: 'circle-slash',
        messageKey: 'error.denied.message', detailKey: 'error.denied.detail',
        actionKey: 'error.denied.action',
      },
      IDENTITY_EXPIRED: {
        level: 'error', recoverable: false, icon: 'circle-slash',
        messageKey: 'error.identity.message', detailKey: 'error.identity.detail',
        actionKey: 'error.identity.action',
      },
    };

    // 设置连接状态指示器
    function setConnectionStatus(online, label, variant = 'default') {
      if (!connectionDot || !connectionText) return;
      connectionDot.classList.toggle('offline', !online);
      connectionDot.classList.toggle('warning', variant === 'warning');
      connectionDot.classList.toggle('connecting', variant === 'connecting');
      connectionText.textContent = label;
    }

    function resolveCopy(config, options) {
      return {
        message: options.message || (config.messageKey ? t(config.messageKey) : ''),
        detail: options.detail || (config.detailKey ? t(config.detailKey) : ''),
        action: options.action || (config.actionKey ? t(config.actionKey) : ''),
      };
    }

    // 显示全屏错误覆盖层（用于阻塞性错误）
    function showErrorOverlay(type, options = {}) {
      if (!errorOverlay) return;
      const config = ERROR_TYPES[type] || {};
      const copy = resolveCopy(config, options);
      const onAction = options.onAction;

      overlayVisible = true;
      errorOverlay.hidden = false;
      errorOverlay.className = `error-overlay ${config.level || 'error'}`;

      let html = `
        <div class="error-overlay-content">
          <div class="error-overlay-icon">${iconMarkup(config.icon || 'circle-alert', 48)}</div>
          <h2 class="error-overlay-title" id="errorOverlayTitle">${escapeHtml(copy.message)}</h2>
          <p class="error-overlay-detail">${escapeHtml(copy.detail)}</p>`;

      if (copy.action && onAction) {
        html += `<button class="error-overlay-action" type="button">${escapeHtml(copy.action)}</button>`;
      }

      html += `</div>`;
      errorOverlay.innerHTML = html;

      if (copy.action && onAction) {
        const button = errorOverlay.querySelector('.error-overlay-action');
        button?.addEventListener('click', () => {
          hideErrorOverlay();
          onAction();
        });
        button?.focus();
      } else {
        errorOverlay.tabIndex = -1;
        errorOverlay.focus();
      }
    }

    // 隐藏错误覆盖层
    function hideErrorOverlay() {
      if (!errorOverlay || !overlayVisible) return;
      overlayVisible = false;
      errorOverlay.hidden = true;
      errorOverlay.innerHTML = '';
    }

    // 根据错误类型显示适当的反馈
    function handleError(type, options = {}) {
      const config = ERROR_TYPES[type] || {};
      currentState = type;

      // 阻塞性错误使用覆盖层
      if (config.level === 'error' && !config.recoverable && options.blocking) {
        showErrorOverlay(type, options);
        return;
      }

      // 其他错误使用 toast
      if (toast && options.showToast !== false) {
        const kind = config.level === 'error' ? 'error' : config.level === 'warning' ? 'error' : 'info';
        const copy = resolveCopy(config, options);
        const toastOptions = { kind, title: copy.message };
        if (copy.action && options.onAction) {
          toastOptions.action = copy.action;
          toastOptions.onAction = options.onAction;
        }
        toast(copy.detail || copy.message, toastOptions);
      }

      if (['OFFLINE', 'CONNECTING', 'CONNECTION_FAILED', 'RECONNECTING'].includes(type)) {
        const online = type === 'CONNECTING';
        const variant = type === 'RECONNECTING' || type === 'OFFLINE' ? 'warning' : type === 'CONNECTING' ? 'connecting' : 'default';
        const copy = resolveCopy(config, options);
        setConnectionStatus(online, options.statusText || copy.message, variant);
      }
    }

    // 清除错误状态（恢复正常）
    function clearError() {
      currentState = null;
      hideErrorOverlay();
      setConnectionStatus(true, t('status.connected'), 'default');
    }

    // 检查是否处于错误状态
    function hasError() {
      return currentState !== null;
    }

    // 获取当前错误类型
    function getCurrentError() {
      return currentState;
    }

    return {
      handleError,
      clearError,
      hasError,
      getCurrentError,
      setConnectionStatus,
      showErrorOverlay,
      hideErrorOverlay,
      ERROR_TYPES,
    };
  }

  return { createErrorStates, ERROR_TYPE_KEYS };
});
