(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloErrorStates = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 错误状态统一管理：为不同类型的错误提供一致的 UI 反馈
  // 设计原则：
  // 1. 可恢复的错误显示重试选项
  // 2. 永久性错误引导用户采取行动
  // 3. 临时性错误自动淡出
  // 4. 关键错误阻塞 UI，轻微错误用 toast

  const ERROR_TYPES = {
    // 网络相关
    OFFLINE: {
      level: 'warning',
      recoverable: true,
      message: '网络已离线',
      detail: '请检查网络连接，恢复后将自动重连。',
      icon: 'wifi-off',
    },
    CONNECTING: {
      level: 'info',
      recoverable: true,
      message: '正在连接',
      detail: '正在建立与服务器的连接…',
      icon: 'loader',
    },
    CONNECTION_FAILED: {
      level: 'error',
      recoverable: true,
      message: '无法连接到服务',
      detail: '已达到最大重试次数，请检查服务是否正在运行。',
      icon: 'wifi-off',
      action: '手动重试',
    },
    RECONNECTING: {
      level: 'warning',
      recoverable: true,
      message: '连接已断开',
      detail: '正在尝试重新连接…',
      icon: 'refresh-cw',
    },

    // 服务相关
    SERVICE_STOPPED: {
      level: 'error',
      recoverable: false,
      message: '服务已停止',
      detail: '服务器已关闭，所有临时数据已清空。',
      icon: 'circle-x',
    },
    SERVICE_UNAVAILABLE: {
      level: 'error',
      recoverable: true,
      message: '服务不可用',
      detail: '暂时无法访问服务，请稍后重试。',
      icon: 'server-crash',
      action: '刷新页面',
    },

    // 频道相关
    CHANNEL_SWITCHING: {
      level: 'info',
      recoverable: false,
      message: '正在切换频道',
      detail: '请稍候…',
      icon: 'loader',
    },
    CHANNEL_FULL: {
      level: 'warning',
      recoverable: false,
      message: '频道人数已满',
      detail: '这个频道当前人数已满，请稍后重试或选择其他频道。',
      icon: 'users-round',
    },
    CHANNEL_UNAVAILABLE: {
      level: 'error',
      recoverable: false,
      message: '频道不可用',
      detail: '这个频道已停用或不存在。',
      icon: 'circle-slash',
    },

    // 配置加载
    CONFIG_LOAD_FAILED: {
      level: 'error',
      recoverable: true,
      message: '无法读取频道配置',
      detail: '请检查服务是否正在运行。',
      icon: 'file-warning',
      action: '重试',
    },
  };

  function createErrorStates({ elements, toast, iconMarkup, escapeHtml }) {
    const { connectionDot, connectionText } = elements;
    const errorOverlay = elements.errorOverlay;
    let currentState = null;
    let overlayVisible = false;

    // 设置连接状态指示器
    function setConnectionStatus(online, label, variant = 'default') {
      if (!connectionDot || !connectionText) return;
      connectionDot.classList.toggle('offline', !online);
      connectionDot.classList.toggle('warning', variant === 'warning');
      connectionDot.classList.toggle('connecting', variant === 'connecting');
      connectionText.textContent = label;
    }

    // 显示全屏错误覆盖层（用于阻塞性错误）
    function showErrorOverlay(type, options = {}) {
      if (!errorOverlay) return;
      const config = ERROR_TYPES[type] || {};
      const message = options.message || config.message || '发生错误';
      const detail = options.detail || config.detail || '';
      const action = options.action || config.action;
      const onAction = options.onAction;

      overlayVisible = true;
      errorOverlay.hidden = false;
      errorOverlay.className = `error-overlay ${config.level || 'error'}`;

      let html = `
        <div class="error-overlay-content">
          <div class="error-overlay-icon">${iconMarkup(config.icon || 'circle-alert', 48)}</div>
          <h2 class="error-overlay-title">${escapeHtml(message)}</h2>
          <p class="error-overlay-detail">${escapeHtml(detail)}</p>`;

      if (action && onAction) {
        html += `<button class="error-overlay-action" type="button">${escapeHtml(action)}</button>`;
      }

      html += `</div>`;
      errorOverlay.innerHTML = html;

      if (action && onAction) {
        errorOverlay.querySelector('.error-overlay-action')?.addEventListener('click', () => {
          hideErrorOverlay();
          onAction();
        });
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
        const message = options.message || config.message || '发生错误';
        const toastOptions = {
          kind,
          title: message,
        };

        if (config.action && options.onAction) {
          toastOptions.action = config.action;
          toastOptions.onAction = options.onAction;
        }

        toast(options.detail || config.detail || message, toastOptions);
      }

      // 更新连接状态指示器
      if (['OFFLINE', 'CONNECTING', 'CONNECTION_FAILED', 'RECONNECTING'].includes(type)) {
        const online = type === 'CONNECTING';
        const variant = type === 'RECONNECTING' || type === 'OFFLINE' ? 'warning' : type === 'CONNECTING' ? 'connecting' : 'default';
        setConnectionStatus(online, options.statusText || config.message, variant);
      }
    }

    // 清除错误状态（恢复正常）
    function clearError() {
      currentState = null;
      hideErrorOverlay();
      setConnectionStatus(true, '已连接', 'default');
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

  return { createErrorStates, ERROR_TYPES };
});

// CommonJS/ES Module interop for tests
if (typeof module === 'object' && module && module.exports && typeof module.exports === 'object') {
  module.exports.ERROR_TYPES = (typeof PaviloErrorStates !== 'undefined' ? PaviloErrorStates : module.exports).ERROR_TYPES;
  module.exports.createErrorStates = (typeof PaviloErrorStates !== 'undefined' ? PaviloErrorStates : module.exports).createErrorStates;
}
