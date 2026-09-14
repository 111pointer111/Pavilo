(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloMentions = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ID = /^[A-Za-z0-9_-]{1,128}$/;
  const END = /[\s.,!?;:，。！？；：、）)\]】}》」』…]/u;
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function cleanUsers(users) {
    const seen = new Set();
    return (Array.isArray(users) ? users : []).filter((user) => {
      if (!user || !ID.test(user.id || '') || typeof user.username !== 'string' || !user.username || seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    }).sort((a, b) => a.username.localeCompare(b.username, 'zh-CN') || a.id.localeCompare(b.id));
  }
  function triggerAtCursor(text, cursor) {
    const before = String(text ?? '').slice(0, cursor);
    const match = /(?:^|\s)@([^@\r\n]{0,24})$/u.exec(before);
    return match ? { start: before.length - match[1].length - 1, end: before.length, query: match[1] } : null;
  }
  function filterUsers(users, query) {
    const needle = String(query || '').toLocaleLowerCase();
    return cleanUsers(users).filter((user) => user.username.toLocaleLowerCase().includes(needle));
  }
  function mentionRanges(text, mentions) {
    const users = cleanUsers(mentions).sort((a, b) => b.username.length - a.username.length);
    const ranges = [];
    for (let start = text.indexOf('@'); start !== -1; start = text.indexOf('@', start + 1)) {
      if (start && !/\s/u.test(text[start - 1])) continue;
      const user = users.find(({ username }) => text.startsWith(`@${username}`, start)
        && (start + username.length + 1 === text.length || END.test(text[start + username.length + 1])));
      if (!user) continue;
      const end = start + user.username.length + 1;
      ranges.push({ id: user.id, username: user.username, start, end });
      start = end - 1;
    }
    return ranges;
  }
  function renderMentionText(text, mentions, escape = escapeHtml, selfId) {
    const value = String(text ?? '');
    let cursor = 0;
    let output = '';
    for (const mention of mentionRanges(value, mentions)) {
      output += escape(value.slice(cursor, mention.start));
      output += `<button class="message-mention${mention.id === selfId ? ' mention-self' : ''}" type="button" data-user-id="${escape(mention.id)}" aria-label="提及 ${escape(mention.username)}">${escape(value.slice(mention.start, mention.end))}</button>`;
      cursor = mention.end;
    }
    return output + escape(value.slice(cursor));
  }

  // Native textarea editing remains authoritative. Only selections made in this
  // page carry identity; edits through a selected name turn it back into text.
  function reconcileMarks(before, after, marks) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let oldEnd = before.length;
    let newEnd = after.length;
    while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
    const delta = newEnd - oldEnd;
    return marks.flatMap((mark) => {
      if (mark.end <= prefix) return [mark];
      if (mark.start >= oldEnd) return [{ ...mark, start: mark.start + delta, end: mark.end + delta }];
      return [];
    }).filter((mark) => after.slice(mark.start, mark.end) === `@${mark.username}`
      && (!mark.start || /\s/u.test(after[mark.start - 1]))
      && (mark.end === after.length || END.test(after[mark.end])));
  }

  function createMentions({ elements, getUsers = () => [], getSelf = () => null,
    isReady = () => true, avatarMarkup = () => '', onOpen = () => {}, onLimit = () => {}, onCandidates = () => {} }) {
    const { composerText, mentionPopover, mentionList, mentionButton, mentionStatus } = elements;
    const document = composerText.ownerDocument;
    const window = document.defaultView;
    const cleanups = [];
    let marks = [];
    let previousText = composerText.value;
    let candidates = [];
    let activeIndex = 0;
    let trigger = null;
    let composing = false;
    let dismissed = null;
    let bound = false;
    function isOpen() { return !mentionPopover.hidden; }
    function triggerKey() { return `${composerText.selectionStart}|${composerText.value}`; }
    function close() {
      dismissed = triggerKey();
      mentionPopover.hidden = true;
      composerText.setAttribute('aria-expanded', 'false');
      composerText.removeAttribute('aria-activedescendant');
      trigger = null;
      candidates = [];
      activeIndex = 0;
    }
    function syncDraft() {
      marks = reconcileMarks(previousText, composerText.value, marks);
      previousText = composerText.value;
    }
    function position() {
      if (!isOpen()) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const rect = composerText.getBoundingClientRect();
      mentionPopover.style.width = `${Math.min(320, width - 16)}px`;
      mentionPopover.style.maxHeight = `${Math.max(0, rect.top - top - 16)}px`;
      mentionPopover.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - mentionPopover.offsetWidth - 8))}px`;
      mentionPopover.style.top = `${Math.max(top + 8, rect.top - mentionPopover.offsetHeight - 8)}px`;
    }
    function selectActive() {
      for (const [index, option] of [...mentionList.querySelectorAll('.mention-option')].entries()) {
        option.classList.toggle('active', index === activeIndex);
        option.setAttribute('aria-selected', String(index === activeIndex));
      }
      const option = candidates.length ? mentionList.children[activeIndex] : null;
      if (option) {
        composerText.setAttribute('aria-activedescendant', option.id);
        // Scroll only the list, never the document/composer behind this popover.
        if (option.offsetTop < mentionList.scrollTop) mentionList.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > mentionList.scrollTop + mentionList.clientHeight) {
          mentionList.scrollTop = option.offsetTop + option.offsetHeight - mentionList.clientHeight;
        }
      } else composerText.removeAttribute('aria-activedescendant');
    }
    function render() {
      mentionList.replaceChildren();
      mentionStatus.textContent = candidates.length ? `${candidates.length} 位频道成员` : '没有匹配的成员';
      if (!candidates.length) {
        const empty = document.createElement('div');
        empty.className = 'mention-empty';
        empty.textContent = '换个名字试试，或按 Esc 继续输入';
        mentionList.append(empty);
      }
      candidates.forEach((user, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.tabIndex = -1;
        option.id = `mention-option-${index}`;
        option.className = 'mention-option';
        option.dataset.userId = user.id;
        option.setAttribute('role', 'option');
        option.innerHTML = `${avatarMarkup(user, '', false)}<span class="mention-option-name">${escapeHtml(user.username)}</span><span class="mention-option-hint">${user.id === getSelf()?.id ? '你' : '↵'}</span>`;
        mentionList.append(option);
      });
      position();
      selectActive();
    }
    function refresh(force = false) {
      syncDraft();
      if (composing || !isReady() || document.activeElement !== composerText
        || composerText.selectionStart !== composerText.selectionEnd) { close(); return; }
      const next = triggerAtCursor(composerText.value, composerText.selectionStart);
      if (!next || marks.some((mark) => mark.start === next.start) || !force && dismissed === triggerKey()) { close(); return; }
      const selected = candidates[activeIndex]?.id;
      const changed = !trigger || trigger.start !== next.start || trigger.query !== next.query;
      trigger = next;
      candidates = filterUsers(getUsers(), trigger.query);
      activeIndex = changed ? 0 : Math.max(0, candidates.findIndex((user) => user.id === selected));
      onCandidates(candidates);
      if (!isOpen()) onOpen();
      mentionPopover.hidden = false;
      composerText.setAttribute('aria-expanded', 'true');
      render();
    }
    function choose(index = activeIndex) {
      const user = candidates[index];
      if (!user || !trigger || !isReady()) return false;
      if (!getUsers().some((current) => current.id === user.id && current.username === user.username)) { refresh(true); return false; }
      const text = composerText.value;
      const { start, end } = trigger;
      const token = `@${user.username}`;
      const replacement = token + (/^\s/u.test(text.slice(end)) ? '' : ' ');
      if (composerText.maxLength >= 0 && text.length - (end - start) + replacement.length > composerText.maxLength) {
        onLimit();
        return false;
      }
      composerText.setRangeText(replacement, start, end, 'end');
      syncDraft();
      marks.push({ id: user.id, username: user.username, start, end: start + token.length });
      close();
      composerText.focus({ preventScroll: true });
      composerText.dispatchEvent(new window.Event('input', { bubbles: true }));
      return true;
    }
    function handleKeydown(event) {
      if (!isOpen() || composing || event.isComposing || event.keyCode === 229) return false;
      if (event.key === 'Escape') { event.preventDefault(); close(); return true; }
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && candidates.length) {
        event.preventDefault();
        activeIndex = (activeIndex + candidates.length + (event.key === 'ArrowDown' ? 1 : -1)) % candidates.length;
        selectActive();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (!candidates.length) {
          close();
          if (event.key === 'Tab') return false;
        } else choose();
        event.preventDefault();
        return true;
      }
      return false;
    }
    function openPicker() {
      if (!isReady()) return;
      composerText.focus({ preventScroll: true });
      const existing = triggerAtCursor(composerText.value, composerText.selectionStart);
      if (!existing) {
        const start = composerText.selectionStart;
        const insertion = (start && !/\s/u.test(composerText.value[start - 1]) ? ' ' : '') + '@';
        if (composerText.maxLength >= 0 && composerText.value.length - (composerText.selectionEnd - start) + insertion.length > composerText.maxLength) { onLimit(); return; }
        composerText.setRangeText(insertion, start, composerText.selectionEnd, 'end');
        composerText.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
      refresh(true);
    }
    function getMentions() {
      syncDraft();
      const users = getUsers();
      const selected = marks.filter((mark) => users.some((user) => user.id === mark.id && user.username === mark.username));
      const seen = new Set();
      return mentionRanges(composerText.value.trim(), selected).filter((mark) => {
        if (seen.has(mark.id)) return false;
        seen.add(mark.id);
        return true;
      }).map(({ id, username }) => ({ id, username }));
    }
    function clear() { marks = []; previousText = composerText.value; close(); }
    function update() {
      syncDraft();
      if (mentionButton) mentionButton.disabled = !isReady();
      if (!isReady()) close();
      else if (isOpen()) refresh();
    }
    function listen(target, type, handler) {
      if (!target) return;
      target.addEventListener(type, handler);
      cleanups.push(() => target.removeEventListener(type, handler));
    }
    function bind() {
      if (bound) return api;
      bound = true;
      listen(composerText, 'input', () => refresh());
      listen(composerText, 'click', () => refresh());
      listen(composerText, 'keyup', (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) refresh(); });
      listen(composerText, 'compositionstart', () => { composing = true; close(); });
      listen(composerText, 'compositionend', () => { composing = false; dismissed = null; refresh(); });
      listen(composerText, 'blur', close);
      listen(mentionList, 'pointerdown', (event) => { if (event.target.closest('.mention-option')) event.preventDefault(); });
      listen(mentionList, 'click', (event) => {
        const option = event.target.closest('.mention-option');
        if (option) choose(candidates.findIndex((user) => user.id === option.dataset.userId));
      });
      listen(mentionList, 'pointermove', (event) => {
        const option = event.target.closest('.mention-option');
        const index = candidates.findIndex((user) => user.id === option?.dataset.userId);
        if (index >= 0 && index !== activeIndex) { activeIndex = index; selectActive(); }
      });
      listen(mentionButton, 'click', openPicker);
      listen(window, 'resize', position);
      listen(window.visualViewport, 'resize', position);
      listen(window.visualViewport, 'scroll', position);
      close();
      update();
      return api;
    }
    function unbind() { for (const cleanup of cleanups.splice(0)) cleanup(); bound = false; clear(); return api; }
    const api = { bind, unbind, close, refresh, choose, getMentions, clear, isOpen, update, handleKeydown };
    return api;
  }
  return { cleanUsers, triggerAtCursor, filterUsers, mentionRanges, reconcileMarks, renderMentionText, createMentions };
});
