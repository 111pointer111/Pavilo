'use strict';

const { cleanUsername, validateClientId } = require('./session');
const { cleanText } = require('./messages');
const { PROTOCOL_VERSION, REACTION_EMOJIS, publicMessage } = require('./events');
const { ipDenied } = require('../ip');
const { effectiveFeatures } = require('./capabilities');
const { authenticate, channelAllowed, identityStillValid } = require('../identity');
const serialize = (payload) => Buffer.from(JSON.stringify(payload));
function createCommandHandler(config, rooms, sessionStore, messageStore, peerEffects, { now, randomId, randomAvatarSeed, cancel, store, playSlot }) {
  const { resolveJoin, rosterUsers, nameIsFree, activeMembers, findById, findByActor } = sessionStore;
  const { parseImage, normalizeMentions, payloadFingerprint, findReply, messageByteSize, messageAck, reactionSummary } = messageStore;
  const { publicUser, sendError, sendJson, broadcast, broadcastOccupancy, sendInitialState, activateTyping, deactivateTyping, closeClient, handOffSession } = peerEffects;
  function rateAllows(client, bucket = 'message', maximum = 8, windowMs = 5000) {
    const timestamp = now();
    const stamps = client.rates[bucket] || [];
    client.rates[bucket] = stamps.filter((stamp) => timestamp - stamp < windowMs);
    if (client.rates[bucket].length >= maximum) return false;
    client.rates[bucket].push(timestamp);
    return true;
  }

  function featureOf(session) {
    return effectiveFeatures(rooms.get(session.channelId)?.config);
  }

  function refuseIfExpired(client) {
    if (identityStillValid(client.session, now())) return false;
    sendError(client, 'IDENTITY_EXPIRED', '身份凭证已过期。');
    closeClient(client, 4010, 'identity_expired');
    return true;
  }

  function handleJoin(client, command) {
    if (client.joined) return;
    if (!Number.isInteger(command.protocolVersion) || command.protocolVersion !== PROTOCOL_VERSION) {
      sendError(client, 'PROTOCOL_NOT_SUPPORTED', 'Server requires protocol version 4');
      closeClient(client, 1002, 'protocol not supported');
      return;
    }
    const identity = authenticate(config, command.identityToken, { now: now() });
    if (identity.error) {
      sendError(client, identity.error, identity.message);
      return;
    }
    const username = identity.userKey ? identity.name : cleanUsername(command.username);
    if (!username) {
      sendError(client, 'INVALID_NAME', '请输入 1–24 个字符的用户名。');
      return;
    }
    if (ipDenied(config.ipDenyList, client.ip)) {
      sendError(client, 'IP_DENIED', '这个网络不能进亭。');
      closeClient(client, 4009, 'ip_denied');
      return;
    }
    const requestedChannel = typeof command.channelId === 'string' && command.channelId
      ? command.channelId
      : config.defaultChannelId;
    const access = channelAllowed(config, requestedChannel, identity);
    if (access.error === 'CHANNEL_UNAVAILABLE') {
      sendError(client, 'CHANNEL_UNAVAILABLE', '这个频道不存在或已停用。');
      return;
    }
    if (access.error === 'IDENTITY_REQUIRED') {
      sendError(client, 'IDENTITY_REQUIRED', '这个亭需要宿主应用接入。');
      return;
    }
    if (access.error) {
      sendError(client, 'CHANNEL_FORBIDDEN', '没有这个频道的访问权限。');
      return;
    }
    client.protocolVersion = PROTOCOL_VERSION;
    const resolution = resolveJoin({ username, channelId: command.channelId, resumeToken: command.resumeToken, clientSessionId: command.clientSessionId });
    if (resolution.error === 'SESSION_CONFLICT') {
      sendError(client, 'SESSION_CONFLICT', '本页会话与频道不匹配。');
      return;
    }
    if (resolution.error === 'CHANNEL_UNAVAILABLE') {
      sendError(client, 'CHANNEL_UNAVAILABLE', '这个频道不存在或已停用。');
      return;
    }
    if (resolution.error === 'SERVER_FULL') {
      sendError(client, 'SERVER_FULL', '聊天室已达到管理员设置的用户上限。');
      return;
    }
    if (resolution.error === 'CHANNEL_FULL') {
      sendError(client, 'CHANNEL_FULL', '这个频道已达到管理员设置的人数上限。');
      return;
    }
    if (resolution.error) {
      sendError(client, 'NAME_TAKEN', '这个用户名已经在频道里了。换一个试试。');
      return;
    }
    if (resolution.session) {
      const previousKey = resolution.session.userKey || null;
      const nextKey = identity.userKey || null;
      if (previousKey !== nextKey) {
        sendError(client, 'SESSION_CONFLICT', '本页会话与频道不匹配。');
        return;
      }
    }

    const rawSeed = Number(command.avatarSeed);
    const requestedSeed = Number.isFinite(rawSeed) ? (Math.abs(Math.trunc(rawSeed)) >>> 0) : null;
    const session = resolution.session || {
      id: randomId('u'),
      username,
      nameKey: resolution.nameKey,
      channelId: resolution.channelId,
      ip: client.ip,
      avatarSeed: requestedSeed ?? randomAvatarSeed(),
      joinedAt: now(),
      token: resolution.token,
      messageCount: 0,
      lastSpokenAt: null,
      muted: false,
      userKey: identity.userKey || null,
      grantedChannels: identity.guest ? null : identity.channels,
      identityExpiresAt: identity.expiresAt || null
    };
    if (session.messageCount == null) session.messageCount = 0;
    if (session.lastSpokenAt === undefined) session.lastSpokenAt = null;
    if (session.muted == null) session.muted = false;
    session.username = username;
    session.channelId = resolution.channelId;
    session.userKey = identity.userKey || null;
    session.grantedChannels = identity.guest ? null : identity.channels;
    session.identityExpiresAt = identity.expiresAt || null;
    handOffSession(session);
    session.client = client;
    session.ip = client.ip;
    client.session = session;
    client.joined = true;
    if (client.joinTimer) cancel(client.joinTimer);
    sessionStore.attach(session, client);

    sendInitialState(client, session, resolution.token);
    broadcast(resolution.channelId, { type: 'presence', action: resolution.session ? 'reconnect' : 'join', user: publicUser(session), users: rosterUsers(resolution.channelId) }, client);
    if (!resolution.session) broadcastOccupancy(client);
  }

  function handleMessage(client, command) {
    const channel = rooms.get(client.session.channelId);
    const features = featureOf(client.session);
    if (client.session.muted) {
      sendError(client, 'MUTED', '现在不能发言。',
        typeof command.clientMessageId === 'string' ? command.clientMessageId : undefined);
      return;
    }
    if (channel.config.readOnly) {
      sendError(client, 'CHANNEL_READ_ONLY', '这个频道是只读频道，不能发送消息。',
        typeof command.clientMessageId === 'string' ? command.clientMessageId : undefined);
      return;
    }
    const clientMessageId = command.clientMessageId;
    if (!validateClientId(clientMessageId)) {
      sendError(client, 'INVALID_MESSAGE_ID', '消息标识无效，请重试。', typeof clientMessageId === 'string' ? clientMessageId : undefined);
      return;
    }
    const effectiveClientMessageId = clientMessageId;
    const kind = command.kind;
    if (kind !== 'text' && kind !== 'image') {
      sendError(client, 'INVALID_KIND', '不支持这种消息类型。', clientMessageId);
      return;
    }
    if (kind === 'image' && !features.images) {
      sendError(client, 'FEATURE_DISABLED', '这个频道关闭了图片。', clientMessageId);
      return;
    }
    if (command.replyTo && !features.replies) {
      sendError(client, 'FEATURE_DISABLED', '这个频道关闭了回复。', clientMessageId);
      return;
    }
    if (command.mentions && !features.mentions) {
      sendError(client, 'FEATURE_DISABLED', '这个频道关闭了提及。', clientMessageId);
      return;
    }
    const text = cleanText(command.text, config.maxTextLength);
    const image = kind === 'image' ? parseImage(command.image) : null;
    if (kind === 'text' && !text) {
      sendError(client, 'EMPTY_MESSAGE', '写点内容再发送。', clientMessageId);
      return;
    }
    if (kind === 'image' && !image) {
      sendError(client, 'INVALID_IMAGE', '图片格式、尺寸或大小不符合要求。', clientMessageId);
      return;
    }
    const caption = kind === 'image' ? text : '';

    const fingerprint = payloadFingerprint(command, kind, text, image);
    const channelId = channel.config.id;
    const scope = `${channelId}:${client.session.token}`;
    const previous = store.findIdempotent(scope, effectiveClientMessageId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) sendError(client, 'MESSAGE_ID_CONFLICT', '消息标识已用于其他内容，请重新发送。', effectiveClientMessageId);
      else sendJson(client, previous.ack);
      return;
    }
    if (!rateAllows(client, 'message', config.messageRateLimit, config.rateLimitWindowMs)) {
      sendError(client, 'RATE_LIMITED', '发送太快了，请稍等几秒。', effectiveClientMessageId);
      return;
    }

    const mentionSource = kind === 'text' ? text : caption;
    const mentions = mentionSource
      ? normalizeMentions(command.mentions, rosterUsers(client.session.channelId), mentionSource)
      : [];
    const sequence = store.incrementSeq(channelId);
    const message = {
      id: randomId(`m${sequence}`),
      seq: sequence,
      clientMessageId: effectiveClientMessageId,
      kind,
      author: publicUser(client.session),
      createdAt: now(),
      replyTo: findReply(store.getMessage(channelId, command.replyTo)),
      reactions: {},
      ...(mentions.length ? { mentions } : {})
    };
    if (kind === 'text') message.text = text;
    else {
      message.image = image;
      if (caption) message.text = caption;
    }
    message.reactionUsers = new Map();
    message.byteSize = messageByteSize(message);
    if (message.byteSize > config.maxRoomBytes) {
      sendError(client, 'ROOM_BUDGET_EXCEEDED', '这张图片超过了频道当前可用容量。', clientMessageId);
      return;
    }
    const historyEnvelope = serialize({ type: 'history', roomEpoch: channel.epoch, messages: [publicMessage(message)] });
    if (historyEnvelope.length > config.maxJsonBytes) {
      sendError(client, 'MESSAGE_TOO_LARGE', '这条内容超过单条历史容量，请压缩后再发送。', clientMessageId);
      return;
    }
    const ack = messageAck(message);
    let removedIds;
    try {
      ({ removedIds } = store.appendMessage(channelId, message, {
        idempotency: { scope, clientMessageId: effectiveClientMessageId, fingerprint, ack }
      }));
    } catch {
      sendError(client, 'STORAGE_UNAVAILABLE', '消息未能保存，请重试。', effectiveClientMessageId);
      return;
    }
    store.pruneDedupe();
    client.session.messageCount = (client.session.messageCount || 0) + 1;
    client.session.lastSpokenAt = message.createdAt;
    sendJson(client, ack);
    broadcast(channelId, { type: 'message', roomEpoch: channel.epoch, message: publicMessage(message), removedIds });
  }

  // Agents hold a channel seat but no peer, so a play host speaking on an
  // agent's behalf cannot reuse handleMessage: there is nobody to ack or to
  // report errors to. Everything else (cleaning, rate limit, byte budgets,
  // eviction, broadcast shape) stays identical to a human message.
  function postAsSession(session, rawText) {
    if (!session || session.kind !== 'agent') return { ok: false, code: 'PLAY_POST_REJECTED' };
    const channel = rooms.get(session.channelId);
    if (!channel?.config.enabled) return { ok: false, code: 'CHANNEL_UNAVAILABLE' };
    if (channel.config.readOnly) return { ok: false, code: 'CHANNEL_READ_ONLY' };
    const text = cleanText(rawText, config.maxTextLength);
    if (!text) return { ok: false, code: 'EMPTY_MESSAGE' };
    if (!rateAllows(session, 'message', config.messageRateLimit, config.rateLimitWindowMs)) {
      return { ok: false, code: 'RATE_LIMITED' };
    }
    const channelId = channel.config.id;
    const roster = rosterUsers(channelId);
    const features = effectiveFeatures(channel.config);
    const mentions = features.mentions
      ? normalizeMentions(roster.map((user) => user.id), roster, text)
      : [];
    const sequence = store.incrementSeq(channelId);
    const message = {
      id: randomId(`m${sequence}`),
      seq: sequence,
      clientMessageId: randomId('agentmsg'),
      kind: 'text',
      text,
      author: publicUser(session),
      createdAt: now(),
      replyTo: null,
      reactions: {},
      ...(mentions.length ? { mentions } : {})
    };
    message.reactionUsers = new Map();
    message.byteSize = messageByteSize(message);
    const historyEnvelope = serialize({ type: 'history', roomEpoch: channel.epoch, messages: [publicMessage(message)] });
    if (message.byteSize > config.maxRoomBytes || historyEnvelope.length > config.maxJsonBytes) {
      return { ok: false, code: 'MESSAGE_TOO_LARGE' };
    }
    let removedIds;
    try {
      ({ removedIds } = store.appendMessage(channelId, message));
    } catch {
      return { ok: false, code: 'STORAGE_UNAVAILABLE' };
    }
    broadcast(channelId, { type: 'message', roomEpoch: channel.epoch, message: publicMessage(message), removedIds });
    return { ok: true, messageId: message.id, seq: message.seq };
  }

  function handleReaction(client, command) {
    if (client.session.muted) return;
    if (!featureOf(client.session).reactions) {
      sendError(client, 'FEATURE_DISABLED', '这个频道关闭了回应。');
      return;
    }
    const channel = rooms.get(client.session.channelId);
    const channelId = channel.config.id;
    if (!rateAllows(client, 'reaction', config.reactionRateLimit, config.rateLimitWindowMs)) {
      sendError(client, 'REACTION_RATE_LIMITED', '回应太快了，请稍等。');
      return;
    }
    if (typeof command.messageId !== 'string' || !REACTION_EMOJIS.has(command.emoji) || typeof command.active !== 'boolean') {
      sendError(client, 'INVALID_REACTION', '不支持这个回应。');
      return;
    }
    let result;
    try {
      result = store.updateReactions(channelId, command.messageId, (message) => {
        let userIds = message.reactionUsers.get(command.emoji);
        if (!userIds) {
          userIds = new Set();
          message.reactionUsers.set(command.emoji, userIds);
        }
        if (command.active) userIds.add(client.session.id);
        else userIds.delete(client.session.id);
        if (!userIds.size) message.reactionUsers.delete(command.emoji);
        message.reactions = reactionSummary(message);
        message.byteSize = messageByteSize(message);
      });
    } catch {
      sendError(client, 'STORAGE_UNAVAILABLE', '回应未能保存，请重试。');
      return;
    }
    if (!result) {
      sendError(client, 'MESSAGE_GONE', '这条消息已经离开临时历史。');
      return;
    }
    if (result.removedIds.includes(command.messageId)) {
      broadcast(channelId, { type: 'prune', roomEpoch: channel.epoch, removedIds: result.removedIds });
      return;
    }
    broadcast(channelId, { type: 'reaction', roomEpoch: channel.epoch, messageId: command.messageId, reactions: result.message.reactions, removedIds: result.removedIds });
  }

  function handleHistoryPage(client, command) {
    if (!featureOf(client.session).history) {
      sendError(client, 'FEATURE_DISABLED', '这个频道关闭了历史。');
      return;
    }
    const channel = rooms.get(client.session.channelId);
    if (!Number.isSafeInteger(command.beforeSeq) || command.beforeSeq < 1) {
      sendError(client, 'BAD_REQUEST', '历史分页参数无效。');
      return;
    }
    const limit = command.limit === undefined ? 50 : command.limit;
    if (!Number.isSafeInteger(limit) || limit < 1) {
      sendError(client, 'BAD_REQUEST', '历史分页参数无效。');
      return;
    }
    if (!rateAllows(client, 'history', 8, 5000)) {
      sendError(client, 'RATE_LIMITED', '请求太快了，请稍后再试。');
      return;
    }
    const page = store.loadHistoryPage(channel.config.id, { beforeSeq: command.beforeSeq, limit });
    if (page.messages.length) {
      for (const chunk of rooms.historyChunks(channel, page.messages)) {
        sendJson(client, { type: 'history', roomEpoch: channel.epoch, messages: chunk });
      }
    }
    sendJson(client, {
      type: 'historyPageEnd',
      roomEpoch: channel.epoch,
      beforeSeq: command.beforeSeq,
      exhausted: page.exhausted
    });
  }

  function emitPlaySnapshots(snapshots, fallbackPeer) {
    for (const snap of snapshots || []) {
      const payload = { ...snap };
      const actorId = payload.actorId;
      delete payload.actorId;
      if (Buffer.byteLength(JSON.stringify(payload)) > config.maxJsonBytes) continue;
      if (payload.visibility === 'channel') broadcast(payload.channelId, payload);
      else {
        const session = actorId ? findByActor(actorId) : null;
        const peer = session?.client || fallbackPeer;
        if (peer) sendJson(peer, payload);
      }
    }
  }

  function handlePlayAction(client, command) {
    const clientActionId = command.clientActionId;
    const actionExtra = { clientActionId };
    if (!validateClientId(clientActionId)) {
      sendError(client, 'INVALID_MESSAGE_ID', '动作标识无效，请重试。', typeof clientActionId === 'string' ? clientActionId : undefined, actionExtra);
      return;
    }
    if (!rateAllows(client, 'playAction', config.messageRateLimit, config.rateLimitWindowMs)) {
      sendError(client, 'RATE_LIMITED', '操作太快了，请稍等几秒。', clientActionId, actionExtra);
      return;
    }
    const plays = playSlot?.runtime;
    if (!plays) {
      sendError(client, 'PLAY_NOT_BOUND', '这个频道没有绑定玩法。', clientActionId, actionExtra);
      return;
    }
    const channel = rooms.get(client.session.channelId);
    const result = plays.handleAction({
      session: client.session,
      name: command.name,
      payload: command.payload,
      clientActionId,
      roomEpoch: channel?.epoch
    });
    if (!result?.ok) {
      sendError(client, result?.code || 'PLAY_ACTION_REJECTED', result?.message || '这个动作不被允许。', clientActionId, actionExtra);
      return;
    }
    emitPlaySnapshots(result.snapshots, client);
    if (result.post?.text) {
      handleMessage(client, {
        type: 'message',
        kind: 'text',
        text: result.post.text,
        clientMessageId: randomId('pm')
      });
    }
  }

  function handleSwitchChannel(client, command) {
    const session = client.session;
    const target = rooms.get(command.channelId);
    if (!target?.config.enabled) return sendError(client, 'CHANNEL_UNAVAILABLE', '这个频道不存在或已停用。');
    const access = channelAllowed(config, command.channelId, {
      userKey: session.userKey || null,
      channels: session.grantedChannels
    });
    if (access.error === 'IDENTITY_REQUIRED') return sendError(client, 'IDENTITY_REQUIRED', '这个亭需要宿主应用接入。');
    if (access.error === 'CHANNEL_FORBIDDEN') return sendError(client, 'CHANNEL_FORBIDDEN', '没有这个频道的访问权限。');
    if (access.error === 'CHANNEL_UNAVAILABLE') return sendError(client, 'CHANNEL_UNAVAILABLE', '这个频道不存在或已停用。');
    if (session.channelId === command.channelId) return sendInitialState(client, session, session.token);
    if (!rateAllows(client, 'switch', 8, 5000)) return sendError(client, 'RATE_LIMITED', '切换太快了，请稍后再试。');
    if (!nameIsFree(session.nameKey, command.channelId, session.token)) return sendError(client, 'NAME_TAKEN', '目标频道已有同名成员。');
    if (activeMembers(command.channelId).size >= target.config.maxUsers) return sendError(client, 'CHANNEL_FULL', '这个频道已达到管理员设置的人数上限。');
    const previousChannelId = session.channelId;
    deactivateTyping(client);
    playSlot?.runtime?.onLeave(session);
    session.channelId = command.channelId;
    broadcast(previousChannelId, { type: 'presence', action: 'leave', userId: session.id, username: session.username, users: rosterUsers(previousChannelId) });
    sendInitialState(client, session, session.token);
    broadcast(session.channelId, { type: 'presence', action: 'join', user: publicUser(session), users: rosterUsers(session.channelId) }, client);
    broadcastOccupancy(client);
  }

  function handleCommand(client, command) {
    if (client.closing) return;
    if (!command || typeof command !== 'object' || typeof command.type !== 'string') {
      sendError(client, 'BAD_REQUEST', '无法识别这条请求。');
      return;
    }
    if (command.type === 'join') return handleJoin(client, command);
    if (!client.joined || !client.session) {
      sendError(client, 'NOT_JOINED', '请先进入频道。');
      return;
    }
    if (command.type !== 'leave' && refuseIfExpired(client)) return;
    if (client.syncing && command.type !== 'leave') {
      // The correlation ID is what lets the sender turn this into a retryable
      // failure instead of leaving the message stuck as "unconfirmed".
      sendError(client, 'SYNC_IN_PROGRESS', '历史同步中，请稍候。',
        typeof command.clientMessageId === 'string' ? command.clientMessageId
          : typeof command.clientActionId === 'string' ? command.clientActionId : undefined,
        command.clientActionId ? { clientActionId: command.clientActionId } : {});
      return;
    }
    if (command.type === 'typing') {
      if (client.session.muted) return;
      if (!featureOf(client.session).typing) return;
      if (rooms.get(client.session.channelId).config.readOnly) return;
      if (!rateAllows(client, 'typing', config.typingRateLimit, config.rateLimitWindowMs)) return;
      if (command.active) activateTyping(client);
      else deactivateTyping(client);
      return;
    }
    if (command.type === 'switchChannel') return handleSwitchChannel(client, command);
    if (command.type === 'historyPage') return handleHistoryPage(client, command);
    if (command.type === 'playAction') return handlePlayAction(client, command);
    if (command.type === 'message') return handleMessage(client, command);
    if (command.type === 'reaction') return handleReaction(client, command);
    if (command.type === 'leave') {
      client.intentionalLeave = true;
      closeClient(client, 1000, 'left');
      return;
    }
    sendError(client, 'UNKNOWN_COMMAND', '频道不支持这项操作。');
  }


  handleCommand.postAsSession = postAsSession;
  return handleCommand;
}
module.exports = { createCommandHandler };
