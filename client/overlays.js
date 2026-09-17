(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloOverlays = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VIEWER_MIN_SCALE = .25;
  const STATUS_ICONS = {
    'loader-circle': '<path d="M12 2a10 10 0 1 0 10 10"/>',
    'circle-alert': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  };

  function createOverlays({ elements, getState, avatarMarkup, escapeHtml,
    formatTime, formatDay, formatDuration, t = (key) => key }) {
    const { peopleList, mobilePeopleList, peopleCount, messageCount,
      profile, profileEmpty, profileAvatar, profileName, profileYou, profileIp,
      profileDuration, profileJoined, mobileProfile, mobileSheet,
      mobileSheetBackdrop, membersButton, mobileSheetClose, imageViewer,
      viewerImage, viewerStage, viewerStatus, viewerZoomLabel, viewerZoomIn,
      viewerZoomOut, viewerAuthor, viewerAvatar, viewerWhen, viewerDimension,
      viewerPrev, viewerNext, viewerIndex, viewerDownload, viewerRotate,
      viewerReset, viewerClose } = elements;
    const document = peopleList.ownerDocument;
    const window = document.defaultView || globalThis;
    const cleanups = [];
    let selectedUserId = null;
    let mobileSheetOpener = null;
    let viewerOpener = null;
    let viewerItems = [];
    let viewerIndexNow = -1;
    let viewerMeta = null;
    let viewerDrag = null;
    let lastState = null;
    let profileTimer = null;
    let destroyed = false;
    let viewerMode = 'gallery';

    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function userById(id, state = getState()) {
      return (state.users || []).find((user) => user.id === id);
    }

    let lastPeople = null;
    let lastPeopleSelfId = '';
    let lastPeopleSelectedId = '';

    function renderPeople(state = getState()) {
      const users = state.users || [];
      const selfId = state.self?.id || '';
      const selectedId = selectedUserId || '';
      // 每个成员都带一个内联 SVG 头像，整表重写在大 roster 下代价明显。
      // key 必须覆盖渲染用到的全部字段：id、用户名和头像种子。
      const rebuild = PaviloPerformance.shouldRebuildList(lastPeople, users,
        (user) => `${user.id}:${user.username}:${user.avatarSeed ?? ''}`)
        || lastPeopleSelfId !== selfId || lastPeopleSelectedId !== selectedId;
      if (rebuild) {
        const markup = users.length ? users.map((user) => `<div class="person${user.id === selectedUserId ? ' selected' : ''}" data-person-id="${escapeHtml(user.id)}" tabindex="0" role="button" aria-label="${escapeHtml(t('people.aria', { name: user.username }))}">
        ${avatarMarkup(user, '', false)}
        <div><span class="person-name">${escapeHtml(user.username)}${user.id === state.self?.id ? escapeHtml(t('people.you')) : ''}</span><span class="person-status">${escapeHtml(t('people.status'))}</span></div>
      </div>`).join('') : `<p class="people-empty">${escapeHtml(t('people.empty'))}</p>`;
        peopleList.innerHTML = markup;
        mobilePeopleList.innerHTML = markup;
        lastPeople = users;
        lastPeopleSelfId = selfId;
        lastPeopleSelectedId = selectedId;
      }
      const countLabel = t('people.count', { count: users.length });
      if (peopleCount.textContent !== countLabel) peopleCount.textContent = countLabel;
      const messageLabel = t('chat.messagesCount', { count: (state.messages || []).length });
      if (messageCount.textContent !== messageLabel) messageCount.textContent = messageLabel;
      const selected = selectedUserId && userById(selectedUserId, state);
      if (selected) renderProfile(selected, state);
    }

    function renderProfile(user, state = getState()) {
      if (!user) {
        profile.hidden = true;
        profileEmpty.hidden = false;
        mobileProfile.classList.remove('open');
        mobileProfile.innerHTML = '';
        return;
      }
      selectedUserId = user.id;
      const you = user.id === state.self?.id ? t('profile.you') : t('profile.other');
      const ip = user.ip || t('profile.ipHidden');
      const duration = formatDuration(user.joinedAt);
      const joined = formatTime(user.joinedAt);
      profileEmpty.hidden = true;
      profile.hidden = false;
      profileAvatar.innerHTML = avatarMarkup(user, '', false);
      profileName.textContent = user.username;
      profileYou.textContent = you;
      profileIp.textContent = ip;
      profileDuration.textContent = duration;
      profileJoined.textContent = joined;
      mobileProfile.classList.add('open');
      mobileProfile.innerHTML = `<div class="profile">
        <div class="profile-top">${avatarMarkup(user, '', false)}<div><h3 class="profile-name">${escapeHtml(user.username)}</h3><p class="profile-you">${escapeHtml(you)}</p></div></div>
        <dl class="profile-fields">
          <div class="profile-field"><dt>${escapeHtml(t('profile.ip'))}</dt><dd>${escapeHtml(ip)}</dd></div>
          <div class="profile-field"><dt>${escapeHtml(t('profile.duration'))}</dt><dd>${escapeHtml(duration)}</dd></div>
          <div class="profile-field"><dt>${escapeHtml(t('profile.joined'))}</dt><dd>${escapeHtml(joined)}</dd></div>
        </dl>
      </div>`;
      for (const list of [peopleList, mobilePeopleList]) {
        list.querySelectorAll('.person').forEach((item) => item.classList.toggle('selected', item.dataset.personId === user.id));
      }
    }

    function updateProfileDuration() {
      if (!selectedUserId) return;
      const user = userById(selectedUserId);
      if (!user) return;
      const duration = formatDuration(user.joinedAt);
      profileDuration.textContent = duration;
      const mobileDuration = mobileProfile.querySelector('.profile-field:nth-child(2) dd');
      if (mobileDuration) mobileDuration.textContent = duration;
    }

    function openProfile(userId, opener) {
      const user = userById(userId);
      if (!user) return;
      renderProfile(user);
      if (window.matchMedia('(max-width: 760px)').matches) setMobileSheet(true, opener);
    }

    function setMobileSheet(open, opener = null, restoreFocus = true) {
      if (window.matchMedia('(min-width: 761px)').matches && open) return;
      if (open) mobileSheetOpener = opener || document.activeElement;
      mobileSheet.hidden = !open;
      mobileSheet.setAttribute('aria-hidden', String(!open));
      mobileSheetBackdrop.hidden = !open;
      mobileSheetBackdrop.setAttribute('aria-hidden', String(!open));
      membersButton.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('sheet-open', open);
      if (open) {
        renderPeople();
        mobileSheetClose.focus();
      } else {
        const target = mobileSheetOpener?.isConnected ? mobileSheetOpener : membersButton;
        mobileSheetOpener = null;
        if (restoreFocus) target.focus();
      }
    }

    function trapFocus(event, root, selector, excludeHidden = false) {
      if (root.hidden || event.key !== 'Tab') return;
      const focusable = [...root.querySelectorAll(selector)].filter((item) => !item.disabled && (!excludeHidden || !item.hidden));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function viewerSetScale(next) {
      if (!viewerMeta) return;
      const scale = Math.min(8, Math.max(VIEWER_MIN_SCALE, next));
      const style = window.getComputedStyle(viewerStage);
      const availableWidth = viewerStage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const availableHeight = viewerStage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const base = Math.min(availableWidth / viewerMeta.width, availableHeight / viewerMeta.height, 1) || 1;
      viewerMeta.scale = scale;
      viewerImage.style.width = `${Math.round(viewerMeta.width * base * scale)}px`;
      viewerImage.style.transform = `rotate(${viewerMeta.rotation}deg)`;
      viewerImage.classList.toggle('zoomed', scale !== 1);
      viewerZoomLabel.textContent = `${Math.round(scale * 100)}%`;
      viewerZoomIn.disabled = scale >= 8;
      viewerZoomOut.disabled = scale <= VIEWER_MIN_SCALE;
      viewerStage.scrollLeft = (viewerStage.scrollWidth - viewerStage.clientWidth) / 2;
      viewerStage.scrollTop = (viewerStage.scrollHeight - viewerStage.clientHeight) / 2;
    }

    function statusIcon(name) {
      return STATUS_ICONS[name] ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATUS_ICONS[name]}</svg>` : '';
    }

    function viewerShowStatus(icon, text, spinning = false) {
      viewerStatus.classList.toggle('spinning', spinning);
      viewerStatus.innerHTML = text ? `${statusIcon(icon)}<span>${escapeHtml(text)}</span>` : '';
    }

    function viewerUpdateChrome() {
      const item = viewerItems[viewerIndexNow];
      if (!item) return;
      const local = viewerMode === 'local';
      viewerImage.alt = local ? t('attach.preview') : t('image.alt', { name: item.author.username });
      viewerAuthor.textContent = item.author.username;
      viewerAvatar.innerHTML = avatarMarkup(item.author, '', false);
      viewerWhen.textContent = local ? t('viewer.localWhen') : `${formatDay(item.message.createdAt)} ${formatTime(item.message.createdAt)}`;
      viewerDimension.textContent = `${item.message.image.width} × ${item.message.image.height}`;
      const multiple = !local && viewerItems.length > 1;
      viewerPrev.hidden = !multiple;
      viewerNext.hidden = !multiple;
      viewerIndex.textContent = multiple ? t('viewer.index', { current: viewerIndexNow + 1, total: viewerItems.length }) : '';
      viewerDownload.hidden = local;
      viewerDownload.href = local ? '#' : item.message.image.src;
      viewerDownload.download = local ? '' : `pavilo-${item.message.id}.png`;
    }

    function viewerLoad(index) {
      if (!viewerItems.length) return;
      viewerIndexNow = (index + viewerItems.length) % viewerItems.length;
      const item = viewerItems[viewerIndexNow];
      viewerMeta = { width: Number(item.message.image.width) || 1, height: Number(item.message.image.height) || 1, scale: 1, rotation: 0 };
      viewerImage.dataset.loaded = 'false';
      viewerImage.removeAttribute('src');
      viewerShowStatus('loader-circle', t('viewer.loading'), true);
      viewerUpdateChrome();
      viewerSetScale(1);
      viewerImage.src = item.message.image.src;
    }

    function viewerStep(delta) {
      if (viewerItems.length > 1) viewerLoad(viewerIndexNow + delta);
    }

    function openViewer(items, index, opener, mode) {
      if (!items.length || index < 0) return;
      viewerMode = mode;
      viewerItems = items;
      viewerOpener = opener || document.activeElement;
      imageViewer.hidden = false;
      imageViewer.setAttribute('aria-hidden', 'false');
      document.body.classList.add('viewer-open');
      viewerLoad(index);
      viewerClose.focus({ preventScroll: true });
    }

    function openImageViewer(messageId, opener) {
      const state = getState();
      const items = (state.messages || [])
        .filter((message) => message.kind === 'image' && message.image?.src)
        .map((message) => ({ message, author: message.author || state.self || { username: t('people.unknown'), avatarSeed: 0 } }));
      openViewer(items, items.findIndex((item) => item.message.id === messageId), opener, 'gallery');
    }

    function openLocalImage(image, opener) {
      if (!image?.src) return;
      const state = getState();
      const author = state.self || { username: t('people.self'), avatarSeed: 0 };
      openViewer([{
        message: {
          id: 'local-preview',
          createdAt: Date.now(),
          image: { src: image.src, width: Number(image.width) || 1, height: Number(image.height) || 1 },
        },
        author,
      }], 0, opener, 'local');
    }

    function endViewerDrag() {
      viewerDrag = null;
      viewerStage.classList.remove('dragging');
    }

    function closeImageViewer(restoreFocus = true) {
      if (imageViewer.hidden) return;
      imageViewer.hidden = true;
      imageViewer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('viewer-open');
      viewerImage.removeAttribute('src');
      viewerImage.dataset.loaded = 'false';
      viewerMeta = null;
      viewerItems = [];
      viewerIndexNow = -1;
      viewerMode = 'gallery';
      if (viewerDownload) viewerDownload.hidden = false;
      endViewerDrag();
      viewerShowStatus('', '');
      const target = viewerOpener?.isConnected ? viewerOpener : null;
      viewerOpener = null;
      if (restoreFocus) target?.focus({ preventScroll: true });
    }

    function viewerResetView() {
      if (!viewerMeta) return;
      viewerMeta.rotation = 0;
      viewerSetScale(1);
    }

    function viewerRotateView() {
      if (!viewerMeta) return;
      viewerMeta.rotation = (viewerMeta.rotation + 90) % 360;
      viewerSetScale(viewerMeta.scale);
    }

    function resetChannel() {
      closeImageViewer(false);
      setMobileSheet(false, null, false);
      selectedUserId = null;
      renderProfile(null);
      for (const list of [peopleList, mobilePeopleList]) {
        list.querySelectorAll('.person.selected').forEach((item) => item.classList.remove('selected'));
      }
    }

    function onState(next, event = {}, previous = lastState) {
      if (destroyed) return;
      const reset = previous && next.channelId !== previous.channelId
        || previous?.room?.epoch && next.room?.epoch !== previous.room.epoch
        || ['connection/leave', 'serviceStopped', 'service/stopped'].includes(event.type);
      if (reset) resetChannel();
      const peopleChanged = !previous || next.users !== previous.users || next.self !== previous.self;
      if (selectedUserId && !userById(selectedUserId, next)) {
        selectedUserId = null;
        renderProfile(null, next);
      }
      if (peopleChanged || reset) renderPeople(next);
      else {
        const messageLabel = t('chat.messagesCount', { count: (next.messages || []).length });
        if (messageCount.textContent !== messageLabel) messageCount.textContent = messageLabel;
      }
      if (profileTimer === null && next.connection?.joined) profileTimer = window.setInterval(updateProfileDuration, 1000);
      lastState = next;
    }

    for (const list of [peopleList, mobilePeopleList]) {
      listen(list, 'click', (event) => {
        const person = event.target.closest('[data-person-id]');
        if (person) renderProfile(userById(person.dataset.personId));
      });
      listen(list, 'keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const person = event.target.closest('[data-person-id]');
        if (person) { event.preventDefault(); renderProfile(userById(person.dataset.personId)); }
      });
    }
    listen(membersButton, 'click', (event) => setMobileSheet(true, event.currentTarget));
    listen(mobileSheetClose, 'click', () => setMobileSheet(false));
    listen(mobileSheetBackdrop, 'click', () => setMobileSheet(false));
    listen(document, 'keydown', (event) => {
      trapFocus(event, mobileSheet, 'button, [href], [tabindex]:not([tabindex="-1"])');
      trapFocus(event, imageViewer, 'button, [href]', true);
      if (event.key === 'Escape' && !mobileSheet.hidden) setMobileSheet(false);
    });
    listen(viewerImage, 'load', () => {
      viewerImage.dataset.loaded = 'true';
      viewerShowStatus('', '');
      viewerSetScale(viewerMeta?.scale ?? 1);
    });
    listen(viewerImage, 'error', () => {
      if (!viewerImage.getAttribute('src')) return;
      viewerShowStatus('circle-alert', '');
      viewerStatus.innerHTML = `${statusIcon('circle-alert')}<p class="viewer-error">${escapeHtml(t('viewer.error'))}</p>`;
      viewerSetScale(viewerMeta?.scale ?? 1);
    });
    listen(viewerZoomIn, 'click', () => viewerSetScale((viewerMeta?.scale ?? 1) * 1.25));
    listen(viewerZoomOut, 'click', () => viewerSetScale((viewerMeta?.scale ?? 1) / 1.25));
    listen(viewerRotate, 'click', viewerRotateView);
    listen(viewerReset, 'click', viewerResetView);
    listen(viewerClose, 'click', () => closeImageViewer());
    listen(viewerPrev, 'click', () => viewerStep(-1));
    listen(viewerNext, 'click', () => viewerStep(1));
    listen(viewerStage, 'pointerdown', (event) => {
      if (!viewerMeta || viewerMeta.scale === 1 || event.button !== 0) return;
      if (event.target.closest('.viewer-nav')) return;
      viewerDrag = { x: event.clientX, y: event.clientY, left: viewerStage.scrollLeft, top: viewerStage.scrollTop };
      viewerStage.classList.add('dragging');
      viewerStage.setPointerCapture(event.pointerId);
    });
    listen(viewerStage, 'pointermove', (event) => {
      if (!viewerDrag) return;
      viewerStage.scrollLeft = viewerDrag.left - (event.clientX - viewerDrag.x);
      viewerStage.scrollTop = viewerDrag.top - (event.clientY - viewerDrag.y);
    });
    listen(viewerStage, 'pointerup', endViewerDrag);
    listen(viewerStage, 'pointercancel', endViewerDrag);
    listen(viewerStage, 'wheel', (event) => {
      if (!viewerMeta) return;
      event.preventDefault();
      viewerSetScale((viewerMeta.scale ?? 1) * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });
    listen(viewerStage, 'dblclick', () => viewerSetScale((viewerMeta?.scale ?? 1) === 1 ? 2 : 1));
    listen(window, 'resize', () => {
      if (window.innerWidth > 760 && !mobileSheet.hidden) setMobileSheet(false, null, false);
      if (!imageViewer.hidden) viewerSetScale(viewerMeta?.scale ?? 1);
    });
    listen(window, 'keydown', (event) => {
      if (imageViewer.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); closeImageViewer(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); viewerStep(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); viewerStep(1); return; }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); viewerSetScale((viewerMeta?.scale ?? 1) * 1.25); return; }
      if (event.key === '-' || event.key === '_') { event.preventDefault(); viewerSetScale((viewerMeta?.scale ?? 1) / 1.25); return; }
      if (event.key === '0') { event.preventDefault(); viewerResetView(); return; }
      if (event.key === 'r' || event.key === 'R') { event.preventDefault(); viewerRotateView(); }
    }, true);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      if (profileTimer !== null) window.clearInterval(profileTimer);
      profileTimer = null;
      resetChannel();
    }

    return { onState, renderPeople, renderProfile, openProfile, setMobileSheet,
      openImageViewer, openLocalImage, closeImageViewer, resetChannel, destroy };
  }

  return { createOverlays };
});
