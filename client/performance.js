(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloPerformance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 客户端 DOM 更新的最小工具集。
  //
  // 这里只放**已经被界面真正使用**的helper：`smartUpdate` 由 app.js 更新频道占用时调用，
  // `shouldRebuildList` 由 overlays.js 决定是否重写成员列表。没有第二个调用点的工具不要提前加进来。

  // 只写入真正变化的属性。读取-比较的成本远低于重写 innerHTML 或重复设置类名
  // （后者会让浏览器重新解析 HTML 并失效样式）。
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

  // 用标识函数比较两个列表，判断是否需要重建。
  // 任一侧缺失视为需要重建，因此首次渲染总是会构建。
  function shouldRebuildList(oldItems, newItems, keyFn = (item) => item.id) {
    if (!oldItems || !newItems) return true;
    if (oldItems.length !== newItems.length) return true;
    for (let index = 0; index < oldItems.length; index++) {
      if (keyFn(oldItems[index]) !== keyFn(newItems[index])) return true;
    }
    return false;
  }

  return { smartUpdate, shouldRebuildList };
});