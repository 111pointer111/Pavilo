(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloPerformance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 性能优化工具：减少大量数据下的不必要 DOM 操作
  // 设计原则：
  // 1. 批量更新而非逐个修改
  // 2. 虚拟化长列表
  // 3. 节流频繁更新
  // 4. 使用 DocumentFragment 减少 reflow

  // 批量 DOM 更新：收集多个更新操作，一次性应用
  function createBatchUpdater(window = globalThis) {
    const queue = [];
    let pending = false;

    function flush() {
      pending = false;
      const operations = queue.splice(0);
      for (const operation of operations) {
        try {
          operation();
        } catch (error) {
          // 单个操作失败不应阻塞其他操作
          console.error('Batch update failed:', error);
        }
      }
    }

    function schedule(operation) {
      if (typeof operation !== 'function') return;
      queue.push(operation);
      if (!pending) {
        pending = true;
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(flush);
        } else {
          window.setTimeout(flush, 16);
        }
      }
    }

    function clear() {
      queue.length = 0;
      pending = false;
    }

    return { schedule, flush, clear, get pending() { return pending; }, get size() { return queue.length; } };
  }

  // 节流函数：限制函数调用频率
  function throttle(func, delay, window = globalThis) {
    let lastCall = 0;
    let timer = null;

    return function throttled(...args) {
      const now = Date.now();
      const remaining = delay - (now - lastCall);

      if (remaining <= 0) {
        if (timer) {
          window.clearTimeout(timer);
          timer = null;
        }
        lastCall = now;
        return func.apply(this, args);
      }

      if (!timer) {
        timer = window.setTimeout(() => {
          lastCall = Date.now();
          timer = null;
          func.apply(this, args);
        }, remaining);
      }
    };
  }

  // 防抖函数：延迟执行，多次调用只执行最后一次
  function debounce(func, delay, window = globalThis) {
    let timer = null;

    return function debounced(...args) {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        func.apply(this, args);
      }, delay);
    };
  }

  // 批量 DOM 插入：使用 DocumentFragment 减少 reflow
  function batchInsert(container, nodes) {
    if (!container || !Array.isArray(nodes) || nodes.length === 0) return;
    const fragment = container.ownerDocument.createDocumentFragment();
    for (const node of nodes) {
      if (node) fragment.appendChild(node);
    }
    container.appendChild(fragment);
  }

  // 批量 DOM 替换：一次性替换所有子节点
  function batchReplace(container, nodes) {
    if (!container || !Array.isArray(nodes)) return;
    const fragment = container.ownerDocument.createDocumentFragment();
    for (const node of nodes) {
      if (node) fragment.appendChild(node);
    }
    container.replaceChildren(fragment);
  }

  // 虚拟滚动辅助：计算可见范围
  function calculateVisibleRange(scrollContainer, itemHeight, overscan = 5) {
    if (!scrollContainer) return { start: 0, end: 0 };
    const scrollTop = scrollContainer.scrollTop;
    const containerHeight = scrollContainer.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan;
    return { start, end };
  }

  // 测量 DOM 操作性能
  function measurePerformance(label, operation, window = globalThis) {
    const performance = window.performance;
    if (!performance || typeof operation !== 'function') {
      return operation?.();
    }

    const start = performance.now();
    try {
      return operation();
    } finally {
      const duration = performance.now() - start;
      if (duration > 16) {
        // 超过一帧的操作值得记录
        console.warn(`[Performance] ${label} took ${duration.toFixed(2)}ms`);
      }
    }
  }

  // 智能更新：只更新变化的属性
  function smartUpdate(element, attributes) {
    if (!element || !attributes) return;
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'textContent') {
        if (element.textContent !== value) element.textContent = value;
      } else if (key === 'innerHTML') {
        if (element.innerHTML !== value) element.innerHTML = value;
      } else if (key === 'className') {
        if (element.className !== value) element.className = value;
      } else if (key === 'hidden') {
        if (element.hidden !== value) element.hidden = value;
      } else if (key === 'disabled') {
        if (element.disabled !== value) element.disabled = value;
      } else if (key.startsWith('data-')) {
        const dataKey = key.slice(5);
        if (element.dataset[dataKey] !== value) element.dataset[dataKey] = value;
      } else if (element[key] !== value) {
        element[key] = value;
      }
    }
  }

  // 检测列表是否需要重建（基于简单的哈希）
  function shouldRebuildList(oldItems, newItems, keyFn = (item) => item.id) {
    if (!oldItems || !newItems) return true;
    if (oldItems.length !== newItems.length) return true;
    for (let i = 0; i < oldItems.length; i++) {
      if (keyFn(oldItems[i]) !== keyFn(newItems[i])) return true;
    }
    return false;
  }

  return {
    createBatchUpdater,
    throttle,
    debounce,
    batchInsert,
    batchReplace,
    calculateVisibleRange,
    measurePerformance,
    smartUpdate,
    shouldRebuildList,
  };
});

// CommonJS/ES Module interop for tests
if (typeof module === 'object' && module && module.exports && typeof module.exports === 'object') {
  const api = typeof PaviloPerformance !== 'undefined' ? PaviloPerformance : module.exports;
  module.exports.createBatchUpdater = api.createBatchUpdater;
  module.exports.throttle = api.throttle;
  module.exports.debounce = api.debounce;
  module.exports.batchInsert = api.batchInsert;
  module.exports.batchReplace = api.batchReplace;
  module.exports.calculateVisibleRange = api.calculateVisibleRange;
  module.exports.measurePerformance = api.measurePerformance;
  module.exports.smartUpdate = api.smartUpdate;
  module.exports.shouldRebuildList = api.shouldRebuildList;
}
