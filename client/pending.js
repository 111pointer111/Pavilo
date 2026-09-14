(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloPending = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPOCH_ERROR = '房间已经重启，请确认后重试。';

  function draftMatches(item, draft) {
    return Boolean(item && item.kind === 'text' && String(draft ?? '').trim() === item.text);
  }

  function defaultId() {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto?.getRandomValues === 'function') {
      try {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return `cm_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      } catch { /* Fall through when the host exposes but cannot use Web Crypto. */ }
    }
    return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }

  class PendingQueue {
    constructor({ makeId = defaultId, ackTimeout = 8_000,
      setTimeout = (...args) => globalThis.setTimeout(...args),
      clearTimeout = (timer) => globalThis.clearTimeout(timer) } = {}) {
      this.items = new Map();
      this.listeners = new Set();
      this.makeId = makeId;
      this.ackTimeout = ackTimeout;
      this.setTimeout = setTimeout;
      this.clearTimeout = clearTimeout;
    }

    get size() { return this.items.size; }
    get(id) { return this.items.get(id); }
    has(id) { return this.items.has(id); }
    // Map-compatible primitives keep the migration adapter small: the legacy
    // renderer can mirror an item without gaining ownership of its timers.
    set(id, item) { this.items.set(id, item); return this; }
    delete(id) {
      const item = this.get(id);
      if (!item) return false;
      this.cancelTimer(item);
      return this.items.delete(id);
    }
    values() { return this.items.values(); }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit(type, item, details = {}) {
      const event = { type, item, ...details };
      for (const listener of [...this.listeners]) listener(event);
      return event;
    }

    cancelTimer(item) {
      if (item.timer != null) this.clearTimeout(item.timer);
      item.timer = null;
    }

    add(input) {
      const id = input.id || this.makeId();
      if (this.items.has(id)) throw new Error('Pending message ID already exists');
      const item = { status: 'sending', attempts: 1, ...input, id, timer: null };
      this.items.set(id, item);
      this.emit('added', item);
      return item;
    }

    pendingChannelWork() {
      for (const item of this.values()) if (item.status !== 'accepted') return item;
      return null;
    }

    unsafeChannelWork(draft, imageProcessing = 0) {
      return Boolean(String(draft ?? '').trim() || this.pendingChannelWork() || imageProcessing);
    }

    hasSendingText() {
      for (const item of this.values()) if (item.kind === 'text' && item.status === 'sending') return true;
      return false;
    }

    transmit(id, { send, isReady = true, now, roomEpoch } = {}) {
      const item = this.get(id);
      if (!item) return false;
      this.cancelTimer(item);
      if (item.epoch && roomEpoch && item.epoch !== roomEpoch) {
        this.markError(id, EPOCH_ERROR);
        return false;
      }
      if (!(typeof isReady === 'function' ? isReady() : isReady)) {
        item.status = 'unconfirmed';
        this.emit('changed', item, { reason: 'not-ready' });
        return false;
      }
      item.status = 'sending';
      if (now !== undefined) item.sentAt = typeof now === 'function' ? now() : now;
      this.emit('changed', item, { reason: 'sending' });
      const command = { type: 'message', kind: item.kind, clientMessageId: item.id,
        replyTo: item.replyToId || undefined };
      if (item.kind === 'text') {
        command.text = item.text;
        if (item.mentions?.length) command.mentions = item.mentions.map((mention) => mention.id || mention);
      } else command.image = item.image;
      let sent = false;
      try { sent = Boolean(send && send(command)); } catch { /* Treat transport exceptions as failed sends. */ }
      // A synchronous adapter may already have delivered an ACK or canonical echo.
      if (this.get(id) !== item || item.status !== 'sending') return sent;
      if (!sent) {
        item.status = 'unconfirmed';
        this.emit('changed', item, { reason: 'send-failed' });
        return false;
      }
      const timer = this.setTimeout(() => {
        if (this.get(id) !== item || item.timer !== timer || item.status !== 'sending') return;
        item.timer = null;
        item.status = 'unconfirmed';
        this.emit('changed', item, { reason: 'ack-timeout' });
      }, this.ackTimeout);
      item.timer = timer;
      return true;
    }

    settleAck(payload, canonicalMessages = []) {
      const id = typeof payload === 'string' ? payload : payload?.clientMessageId;
      const item = this.get(id);
      if (!item || (payload?.roomEpoch && item.epoch && payload.roomEpoch !== item.epoch)) return null;
      this.cancelTimer(item);
      item.status = 'accepted';
      // UI owns draft/reply effects and the five-second accepted cleanup timer.
      this.emit('accepted', item, { cleanupAfter: 5_000 });
      const canonical = canonicalMessages.find((message) => message.clientMessageId === id);
      if (canonical) this.remove(id, { reason: 'canonical', canonical });
      return item;
    }

    reconcile(canonicalMessages, { roomEpoch, allowRetry = false, send, isReady = true } = {}) {
      const canonicalById = new Map(canonicalMessages.map((message) => [message.clientMessageId, message]));
      for (const item of [...this.values()]) {
        const canonical = canonicalById.get(item.id);
        if (canonical) {
          this.emit('reconciled', item, { canonical });
          this.remove(item.id, { reason: 'canonical', canonical });
        } else if (item.epoch && roomEpoch && item.epoch !== roomEpoch) {
          this.markError(item.id, EPOCH_ERROR);
        } else if (allowRetry && item.epoch === roomEpoch && item.status !== 'sending' && item.attempts < 2) {
          item.attempts += 1;
          this.transmit(item.id, { send, isReady, roomEpoch });
        }
      }
    }

    markError(id, error) {
      const item = this.get(id);
      if (!item) return null;
      this.cancelTimer(item);
      item.status = 'error';
      item.error = error;
      this.emit('changed', item, { reason: 'error' });
      return item;
    }

    disconnect() {
      for (const item of this.values()) {
        this.cancelTimer(item);
        if (item.status !== 'sending') continue;
        item.status = 'unconfirmed';
        this.emit('changed', item, { reason: 'disconnect' });
      }
    }

    retry(id, { roomEpoch, send, isReady = true, now } = {}) {
      const item = this.get(id);
      if (!item) return false;
      if (item.epoch && roomEpoch && item.epoch !== roomEpoch) {
        const newId = this.makeId();
        if (!newId || newId === id || this.items.has(newId)) throw new Error('Retry requires a new pending message ID');
        this.cancelTimer(item);
        this.items.delete(id);
        item.id = newId;
        item.epoch = roomEpoch;
        this.items.set(newId, item);
        this.emit('rekeyed', item, { oldId: id });
      }
      item.attempts += 1;
      return this.transmit(item.id, { send, isReady, now, roomEpoch });
    }

    remove(id, details = {}) {
      const item = this.get(id);
      if (!item) return null;
      this.cancelTimer(item);
      this.items.delete(id);
      this.emit('removed', item, details);
      return item;
    }

    clear() {
      for (const item of [...this.values()]) this.remove(item.id, { reason: 'clear' });
    }
  }

  function createPendingQueue(options) { return new PendingQueue(options); }

  return { PendingQueue, createPendingQueue, draftMatches };
});
