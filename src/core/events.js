'use strict';

const PROTOCOL_VERSION = 4;
const REACTION_EMOJIS = new Set(['👍', '❤️', '😂', '🎉', '👀', '🔥']);
function publicChannel(channel) {
  const result = { id: channel.id, name: channel.name, description: channel.description, enabled: channel.enabled, readOnly: channel.readOnly, maxUsers: channel.maxUsers, welcome: channel.welcome };
  if (channel.play) result.play = channel.play;
  return result;
}
function publicChannelSummary(channel) {
  const result = { id: channel.id, name: channel.name, enabled: channel.enabled !== false, readOnly: Boolean(channel.readOnly) };
  if (channel.play) result.play = channel.play;
  return result;
}
function publicLimits(config) {
  return { maxTextLength: config.maxTextLength, maxImageBytes: config.maxImageBytes, maxImageDimension: config.maxImageDimension, maxImagePixels: config.maxImagePixels, maxMessages: config.maxMessages };
}
function publicUser(session, exposeMemberIps = false) {
  const user = { id: session.id, username: session.username, avatarSeed: session.avatarSeed, joinedAt: session.joinedAt };
  if (session.kind === 'agent') user.kind = 'agent';
  if (exposeMemberIps && session.ip && session.kind !== 'agent') user.ip = session.ip;
  return user;
}
function publicMessage(message) {
  const copy = { ...message };
  delete copy.byteSize;
  delete copy.reactionUsers;
  return copy;
}
function projectMessage(message, options = {}) {
  if (!message) return null;
  if (message.removedAt) {
    const projected = {
      id: message.id,
      author: message.author,
      createdAt: message.createdAt,
      removed: true
    };
    if (Number.isSafeInteger(message.seq)) projected.seq = message.seq;
    if (typeof message.clientMessageId === 'string') projected.clientMessageId = message.clientMessageId;
    return projected;
  }
  const copy = publicMessage(message);
  if (options.quotedRemoved && copy.replyTo && typeof copy.replyTo.id === 'string') {
    copy.replyTo = { id: copy.replyTo.id, removed: true };
  }
  return copy;
}
function directed(peerId, payload) { return { kind: 'send', peerId, payload }; }
function channelEvent(channelId, payload, peerIds) {
  return { kind: 'broadcast', channelId, payload, peerIds, transient: payload.type === 'typing' };
}
module.exports = { PROTOCOL_VERSION, REACTION_EMOJIS, publicChannel, publicChannelSummary, publicLimits, publicUser, publicMessage, projectMessage, directed, channelEvent };
