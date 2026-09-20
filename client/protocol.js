(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloProtocol = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROTOCOL_VERSION = 4;
  const COMMANDS = Object.freeze({ JOIN: 'join', MESSAGE: 'message', REACTION: 'reaction',
    TYPING: 'typing', SWITCH_CHANNEL: 'switchChannel', HISTORY_PAGE: 'historyPage', PLAY_ACTION: 'playAction', LEAVE: 'leave' });
  const EVENTS = Object.freeze({ STATE_START: 'stateStart', HISTORY: 'history', HISTORY_END: 'historyEnd',
    HISTORY_PAGE_END: 'historyPageEnd',
    STATE: 'state', PRESENCE: 'presence', MESSAGE: 'message', REACTION: 'reaction', PRUNE: 'prune',
    TYPING: 'typing', CHANNEL_OCCUPANCY: 'channelOccupancy', PLAY_STATE: 'playState', ACK: 'ack', ERROR: 'error' });
  const ACK_FIELDS = Object.freeze(['clientMessageId', 'messageId', 'seq', 'createdAt']);
  const ERROR_FIELDS = Object.freeze(['code', 'message', 'clientMessageId']);
  const SYNC_EVENTS = Object.freeze(['stateStart', 'history', 'historyEnd']);
  const DEFERRED_EVENTS = Object.freeze(['presence', 'message', 'reaction', 'typing', 'channelOccupancy', 'playState', 'ack', 'error']);
  const REACTION_EMOJIS = Object.freeze(['👍', '❤️', '😂', '🎉', '👀', '🔥']);

  function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
  function isClientMessageId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value); }
  function isChannelId(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value); }
  function isRoomEpoch(value) { return isId(value); }
  function isSequence(value) { return Number.isSafeInteger(value) && value >= 0; }
  function optional(value, validator) { return value === undefined || validator(value); }
  function isUser(user) {
    return isRecord(user) && isId(user.id) && typeof user.username === 'string'
      && optional(user.avatarSeed, (value) => Number.isSafeInteger(value) || typeof value === 'string')
      && optional(user.joinedAt, (value) => Number.isFinite(value));
  }
  function isReactions(reactions) {
    return isRecord(reactions) && Object.entries(reactions).every(([emoji, summary]) =>
      REACTION_EMOJIS.includes(emoji) && isRecord(summary) && isSequence(summary.count)
      && Array.isArray(summary.userIds) && summary.userIds.every(isId));
  }
  function isMentions(value) {
    return Array.isArray(value) && new Set(value.map((mention) => mention?.id)).size === value.length
      && value.every((mention) => isRecord(mention) && isId(mention.id)
        && typeof mention.username === 'string' && mention.username.length > 0 && mention.username.length <= 24);
  }

  function isMessage(message) {
    if (!isRecord(message) || !isId(message.id) || !isUser(message.author)
      || !optional(message.seq, isSequence) || !Number.isFinite(message.createdAt)
      || !optional(message.clientMessageId, isClientMessageId)
      || !optional(message.mentions, isMentions)
      || !optional(message.reactions, isReactions)) return false;
    if (message.replyTo !== undefined && message.replyTo !== null
      && (!isRecord(message.replyTo) || !isId(message.replyTo.id)
        || typeof message.replyTo.username !== 'string' || !['text', 'image'].includes(message.replyTo.kind)
        || typeof message.replyTo.text !== 'string')) return false;
    if (message.kind === 'text') return typeof message.text === 'string' && message.image == null;
    return message.kind === 'image' && isRecord(message.image) && typeof message.image.src === 'string'
      && Number.isFinite(message.image.width) && message.image.width > 0
      && Number.isFinite(message.image.height) && message.image.height > 0
      && optional(message.text, (value) => typeof value === 'string');
  }
  function isUsers(value) { return Array.isArray(value) && value.every(isUser); }
  function isMessages(value) { return Array.isArray(value) && value.every(isMessage); }
  function isRemovedIds(value) { return Array.isArray(value) && value.every(isId); }
  function isOccupancy(value) {
    return isRecord(value) && Object.entries(value).every(([channelId, online]) => isChannelId(channelId) && isSequence(online));
  }

  // Optional epoch/channel fields preserve v1 and the epoch-less presence/ACK wire contract.
  // Return null for malformed/unknown frames; never throw on transport input.
  function parseServerEvent(raw) {
    let event = raw;
    if (typeof raw === 'string') {
      try { event = JSON.parse(raw); } catch { return null; }
    }
    if (!isRecord(event) || !Object.values(EVENTS).includes(event.type)
      || !optional(event.roomEpoch, isRoomEpoch) || !optional(event.channelId, isChannelId)) return null;
    let valid = false;
    switch (event.type) {
      case EVENTS.STATE_START:
        valid = isUser(event.self) && isUsers(event.users) && isSequence(event.latestSeq)
          && optional(event.protocolVersion, (value) => Number.isSafeInteger(value) && value > 0)
          && optional(event.roomStartedAt, Number.isFinite)
          && optional(event.capabilities, (value) => Array.isArray(value) && value.every((item) => typeof item === 'string'))
          && optional(event.resumeToken, (value) => value === null || isClientMessageId(value))
          && optional(event.occupancy, isOccupancy)
          && optional(event.play, (value) => isRecord(value) && typeof value.id === 'string' && typeof value.page === 'string');
        break;
      case EVENTS.HISTORY: valid = isMessages(event.messages); break;
      case EVENTS.HISTORY_END: valid = isSequence(event.latestSeq); break;
      case EVENTS.HISTORY_PAGE_END:
        valid = isSequence(event.beforeSeq) && typeof event.exhausted === 'boolean';
        break;
      case EVENTS.STATE:
        valid = isUser(event.self) && isUsers(event.users) && isMessages(event.messages)
          && optional(event.roomStartedAt, Number.isFinite);
        break;
      case EVENTS.PRESENCE:
        valid = isUsers(event.users) && (event.action === 'leave'
          ? isId(event.userId) && typeof event.username === 'string'
          : ['join', 'reconnect'].includes(event.action) && isUser(event.user));
        break;
      case EVENTS.MESSAGE:
        valid = isMessage(event.message) && optional(event.removedIds, isRemovedIds); break;
      case EVENTS.REACTION:
        valid = isId(event.messageId) && isReactions(event.reactions) && optional(event.removedIds, isRemovedIds); break;
      case EVENTS.PRUNE: valid = isRemovedIds(event.removedIds); break;
      case EVENTS.TYPING:
        valid = isId(event.userId) && typeof event.username === 'string' && typeof event.active === 'boolean'; break;
      case EVENTS.CHANNEL_OCCUPANCY: valid = isOccupancy(event.occupancy); break;
      case EVENTS.PLAY_STATE:
        valid = typeof event.playId === 'string' && isChannelId(event.channelId) && isId(event.gameId)
          && isSequence(event.seq) && (event.visibility === 'private' || event.visibility === 'channel')
          && isRecord(event.state) && optional(event.clientActionId, isClientMessageId);
        break;
      case EVENTS.ACK:
        valid = isClientMessageId(event.clientMessageId) && isId(event.messageId)
          && isSequence(event.seq) && Number.isFinite(event.createdAt); break;
      case EVENTS.ERROR:
        // INVALID_MESSAGE_ID deliberately echoes invalid IDs, so correlation here is a string, not a valid submission ID.
        valid = typeof event.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(event.code)
          && typeof event.message === 'string' && optional(event.clientMessageId, (value) => typeof value === 'string');
        break;
    }
    return valid ? event : null;
  }

  return { PROTOCOL_VERSION, COMMANDS, EVENTS, ACK_FIELDS, ERROR_FIELDS, SYNC_EVENTS, DEFERRED_EVENTS,
    REACTION_EMOJIS, isId, isClientMessageId, isChannelId, isRoomEpoch, isUser, isMessage, isMentions, parseServerEvent };
});
