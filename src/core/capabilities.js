'use strict';

const FEATURE_KEYS = Object.freeze(['images', 'replies', 'reactions', 'mentions', 'typing', 'history']);

function defaultFeatures() {
  return {
    images: true,
    replies: true,
    reactions: true,
    mentions: true,
    typing: true,
    history: true
  };
}

function effectiveFeatures(channel) {
  const features = defaultFeatures();
  const raw = channel && channel.features;
  if (!raw || typeof raw !== 'object') return features;
  for (const key of FEATURE_KEYS) {
    if (raw[key] === false) features[key] = false;
  }
  return features;
}

function protocolCapabilities(channel) {
  const features = effectiveFeatures(channel);
  const capabilities = ['ack', 'historyChunks', 'roomEpoch', 'reconnect'];
  if (features.reactions) capabilities.push('reactions');
  if (features.typing) capabilities.push('typingLease');
  if (features.mentions) capabilities.push('mentions');
  capabilities.push('channelOccupancy');
  if (features.history) capabilities.push('historyPage');
  if (channel?.play) capabilities.push('play');
  return capabilities;
}

function channelAccess(channel) {
  return channel?.access === 'authenticated' ? 'authenticated' : 'open';
}

function actorKey(session) {
  return session?.userKey || session?.id || '';
}

module.exports = {
  FEATURE_KEYS,
  defaultFeatures,
  effectiveFeatures,
  protocolCapabilities,
  channelAccess,
  actorKey
};
