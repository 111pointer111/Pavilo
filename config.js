'use strict';

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const ROOT = __dirname;
const CONFIG_VERSION = 1;
const CHANNEL_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/;
const DECIMAL_PORT_RE = /^(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_USERS = 1000;
const MAX_CHANNELS = 100;
const MAX_MESSAGE_OVERHEAD_BYTES = 16 * 1024;
const MAX_ROSTER_USER_BYTES = 512;
const HTTP_PUBLIC_FILES = new Set(['index.html']);

const DEFAULTS = deepFreeze({
  port: 4173,
  host: '0.0.0.0',
  maxUsers: 64,
  maxMessages: 300,
  maxTextLength: 2000,
  maxImageBytes: 1_500_000,
  maxImageDimension: 4096,
  maxImagePixels: 16_000_000,
  maxJsonBytes: 2_500_000,
  maxWsFrameBytes: 4_000_000,
  maxRoomBytes: 32 * 1024 * 1024,
  maxClients: 80,
  maxClientsPerIp: 12,
  maxWritableBytes: 5 * 1024 * 1024,
  joinTimeoutMs: 12_000,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 75_000,
  typingTtlMs: 4_000,
  sessionLeaseMs: 15_000,
  dedupeTtlMs: 10 * 60_000,
  maxDedupeEntries: 512,
  messageRateLimit: 8,
  reactionRateLimit: 20,
  typingRateLimit: 12,
  rateLimitWindowMs: 5_000,
  allowNoOrigin: true,
  allowedOrigins: [],
  roomTitle: '语亭 · 临时频道',
  defaultChannelId: 'general',
  exposeMemberIps: true,
  exposeLanUrls: true,
  channels: [{
    id: 'general',
    name: '闲聊',
    description: '轻松聊聊，只留当下。',
    enabled: true,
    maxUsers: 64
  },{
    id: 'awesome-ai',
    name: '智能硬件项目聚集地',
    description: '我们是最棒的👍',
    enabled: true,
    maxUsers: 64
  }]
});

const ROOT_KEYS = new Set(['version', 'server', 'room', 'channels', 'limits', 'timeouts', 'rateLimits']);
const SERVER_KEYS = new Set(['host', 'port', 'maxUsers', 'maxConnections', 'maxConnectionsPerIp', 'allowNoOrigin', 'allowedOrigins']);
const ROOM_KEYS = new Set(['title', 'defaultChannel', 'exposeMemberIps', 'exposeLanUrls']);
const CHANNEL_KEYS = new Set(['id', 'name', 'description', 'enabled', 'maxUsers']);
const LIMIT_KEYS = new Set(['maxMessagesPerChannel', 'maxTextLength', 'maxImageBytes', 'maxImageDimension', 'maxImagePixels', 'maxJsonBytes', 'maxWebSocketFrameBytes', 'maxChannelBytes', 'maxWritableBytes', 'maxDedupeEntries']);
const TIMEOUT_KEYS = new Set(['joinMs', 'heartbeatIntervalMs', 'heartbeatTimeoutMs', 'typingTtlMs', 'sessionLeaseMs', 'dedupeTtlMs']);
const RATE_KEYS = new Set(['windowMs', 'messages', 'reactions', 'typing']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cloneDefaults() {
  return structuredClone(DEFAULTS);
}

function fail(field, message) {
  throw new Error(`${field}: ${message}`);
}

function record(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, '必须是对象');
  return value;
}

function knownKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field}.${key}`, '未知配置项');
  }
}

function integer(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(field, `必须是 ${minimum}–${maximum} 之间的整数`);
  }
  return value;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') fail(field, '必须是 true 或 false');
  return value;
}

function text(value, field, minimum, maximum) {
  if (typeof value !== 'string') fail(field, '必须是字符串');
  const result = value.trim();
  if (result.length < minimum || result.length > maximum) fail(field, `长度必须是 ${minimum}–${maximum} 个字符`);
  return result;
}

function optionalInteger(target, key, source, sourceKey, field, minimum, maximum) {
  if (source[sourceKey] !== undefined) target[key] = integer(source[sourceKey], field, minimum, maximum);
}

function parseOrigins(value, field) {
  if (!Array.isArray(value)) fail(field, '必须是 URL 数组');
  const origins = value.map((entry, index) => {
    const origin = text(entry, `${field}[${index}]`, 1, 2048);
    let parsed;
    try { parsed = new URL(origin); } catch { fail(`${field}[${index}]`, '必须是完整的 http:// 或 https:// Origin'); }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
      fail(`${field}[${index}]`, '必须是不含路径的 http:// 或 https:// Origin');
    }
    return origin;
  });
  if (new Set(origins).size !== origins.length) fail(field, '不能包含重复 Origin');
  return origins;
}

function normalizeChannels(value, maxUsers) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHANNELS) fail('channels', `必须包含 1–${MAX_CHANNELS} 个频道`);
  const ids = new Set();
  const channels = value.map((entry, index) => {
    const field = `channels[${index}]`;
    const channel = record(entry, field);
    knownKeys(channel, CHANNEL_KEYS, field);
    const id = text(channel.id, `${field}.id`, 1, 32);
    if (!CHANNEL_ID_RE.test(id)) fail(`${field}.id`, '只能使用小写字母、数字、下划线和连字符，且必须以字母或数字开头');
    if (ids.has(id)) fail(`${field}.id`, `频道 ID “${id}” 重复`);
    ids.add(id);
    return {
      id,
      name: text(channel.name, `${field}.name`, 1, 40),
      description: channel.description === undefined ? '' : text(channel.description, `${field}.description`, 0, 160),
      enabled: channel.enabled === undefined ? true : boolean(channel.enabled, `${field}.enabled`),
      maxUsers: channel.maxUsers === undefined ? maxUsers : integer(channel.maxUsers, `${field}.maxUsers`, 1, maxUsers)
    };
  });
  if (!channels.some((channel) => channel.enabled)) fail('channels', '至少要启用一个频道');
  return channels;
}

function validateCrossConstraints(config) {
  const maxTextBytes = config.maxTextLength * 4;
  const encodedImageBytes = Math.ceil(config.maxImageBytes / 3) * 4;
  // A reply embeds the original text preview, so a message envelope may contain
  // both its own largest body and another maximum-length text value.
  const largestMessageBytes = Math.max(maxTextBytes, encodedImageBytes) + maxTextBytes + MAX_MESSAGE_OVERHEAD_BYTES;
  const rosterBytes = config.maxUsers * MAX_ROSTER_USER_BYTES + MAX_MESSAGE_OVERHEAD_BYTES;
  if (config.maxClients < config.maxUsers) fail('server.maxConnections', '不能小于 server.maxUsers');
  if (config.maxClientsPerIp > config.maxClients) fail('server.maxConnectionsPerIp', '不能大于 server.maxConnections');
  if (config.maxJsonBytes < largestMessageBytes) fail('limits.maxJsonBytes', '装不下最大图片的 base64 或最长文字消息及其 JSON 开销');
  if (config.maxJsonBytes < rosterBytes) fail('limits.maxJsonBytes', '装不下 server.maxUsers 对应的成员列表 JSON');
  if (config.maxWsFrameBytes < config.maxJsonBytes) fail('limits.maxWebSocketFrameBytes', '不能小于 limits.maxJsonBytes');
  if (config.maxWritableBytes < config.maxJsonBytes + 14) fail('limits.maxWritableBytes', '必须能容纳一个最大 JSON WebSocket 帧及帧头');
  if (config.maxRoomBytes < largestMessageBytes) fail('limits.maxChannelBytes', '装不下一条最大图片或文字消息');
  if (config.heartbeatTimeoutMs <= config.heartbeatIntervalMs) fail('timeouts.heartbeatTimeoutMs', '必须大于 timeouts.heartbeatIntervalMs');
}

function normalizeConfig(document = {}, { requireVersion = false } = {}) {
  const root = record(document, 'config');
  knownKeys(root, ROOT_KEYS, 'config');
  if (requireVersion && root.version === undefined) fail('version', `配置文件必须声明 version: ${CONFIG_VERSION}`);
  if (root.version !== undefined && root.version !== CONFIG_VERSION) fail('version', `当前只支持版本 ${CONFIG_VERSION}`);

  const server = record(root.server, 'server');
  const room = record(root.room, 'room');
  const limits = record(root.limits, 'limits');
  const timeouts = record(root.timeouts, 'timeouts');
  const rateLimits = record(root.rateLimits, 'rateLimits');
  knownKeys(server, SERVER_KEYS, 'server');
  knownKeys(room, ROOM_KEYS, 'room');
  knownKeys(limits, LIMIT_KEYS, 'limits');
  knownKeys(timeouts, TIMEOUT_KEYS, 'timeouts');
  knownKeys(rateLimits, RATE_KEYS, 'rateLimits');

  const config = cloneDefaults();
  if (server.host !== undefined) config.host = text(server.host, 'server.host', 1, 255);
  optionalInteger(config, 'port', server, 'port', 'server.port', 1, 65_535);
  optionalInteger(config, 'maxUsers', server, 'maxUsers', 'server.maxUsers', 1, MAX_USERS);
  optionalInteger(config, 'maxClients', server, 'maxConnections', 'server.maxConnections', 1, 2000);
  optionalInteger(config, 'maxClientsPerIp', server, 'maxConnectionsPerIp', 'server.maxConnectionsPerIp', 1, 2000);
  if (server.maxConnections !== undefined && server.maxConnectionsPerIp === undefined) {
    config.maxClientsPerIp = Math.min(config.maxClientsPerIp, config.maxClients);
  }
  if (server.allowNoOrigin !== undefined) config.allowNoOrigin = boolean(server.allowNoOrigin, 'server.allowNoOrigin');
  if (server.allowedOrigins !== undefined) config.allowedOrigins = parseOrigins(server.allowedOrigins, 'server.allowedOrigins');

  if (room.title !== undefined) config.roomTitle = text(room.title, 'room.title', 1, 80);
  if (room.defaultChannel !== undefined) config.defaultChannelId = text(room.defaultChannel, 'room.defaultChannel', 1, 32);
  if (room.exposeMemberIps !== undefined) config.exposeMemberIps = boolean(room.exposeMemberIps, 'room.exposeMemberIps');
  if (room.exposeLanUrls !== undefined) config.exposeLanUrls = boolean(room.exposeLanUrls, 'room.exposeLanUrls');

  optionalInteger(config, 'maxMessages', limits, 'maxMessagesPerChannel', 'limits.maxMessagesPerChannel', 1, 10_000);
  optionalInteger(config, 'maxTextLength', limits, 'maxTextLength', 'limits.maxTextLength', 1, 100_000);
  optionalInteger(config, 'maxImageBytes', limits, 'maxImageBytes', 'limits.maxImageBytes', 1, 32 * 1024 * 1024);
  optionalInteger(config, 'maxImageDimension', limits, 'maxImageDimension', 'limits.maxImageDimension', 1, 16_384);
  optionalInteger(config, 'maxImagePixels', limits, 'maxImagePixels', 'limits.maxImagePixels', 1, 100_000_000);
  optionalInteger(config, 'maxJsonBytes', limits, 'maxJsonBytes', 'limits.maxJsonBytes', 1024, 64 * 1024 * 1024);
  optionalInteger(config, 'maxWsFrameBytes', limits, 'maxWebSocketFrameBytes', 'limits.maxWebSocketFrameBytes', 1024, 64 * 1024 * 1024);
  optionalInteger(config, 'maxRoomBytes', limits, 'maxChannelBytes', 'limits.maxChannelBytes', 1024, 512 * 1024 * 1024);
  optionalInteger(config, 'maxWritableBytes', limits, 'maxWritableBytes', 'limits.maxWritableBytes', 1024, 128 * 1024 * 1024);
  optionalInteger(config, 'maxDedupeEntries', limits, 'maxDedupeEntries', 'limits.maxDedupeEntries', 1, 100_000);

  optionalInteger(config, 'joinTimeoutMs', timeouts, 'joinMs', 'timeouts.joinMs', 100, 3_600_000);
  optionalInteger(config, 'heartbeatIntervalMs', timeouts, 'heartbeatIntervalMs', 'timeouts.heartbeatIntervalMs', 100, 3_600_000);
  optionalInteger(config, 'heartbeatTimeoutMs', timeouts, 'heartbeatTimeoutMs', 'timeouts.heartbeatTimeoutMs', 100, 3_600_000);
  optionalInteger(config, 'typingTtlMs', timeouts, 'typingTtlMs', 'timeouts.typingTtlMs', 100, 3_600_000);
  optionalInteger(config, 'sessionLeaseMs', timeouts, 'sessionLeaseMs', 'timeouts.sessionLeaseMs', 0, 3_600_000);
  optionalInteger(config, 'dedupeTtlMs', timeouts, 'dedupeTtlMs', 'timeouts.dedupeTtlMs', 1000, 86_400_000);

  optionalInteger(config, 'rateLimitWindowMs', rateLimits, 'windowMs', 'rateLimits.windowMs', 100, 3_600_000);
  optionalInteger(config, 'messageRateLimit', rateLimits, 'messages', 'rateLimits.messages', 1, 10_000);
  optionalInteger(config, 'reactionRateLimit', rateLimits, 'reactions', 'rateLimits.reactions', 1, 10_000);
  optionalInteger(config, 'typingRateLimit', rateLimits, 'typing', 'rateLimits.typing', 1, 10_000);

  if (root.channels === undefined) {
    config.channels = config.channels.map((channel) => ({ ...channel, maxUsers: Math.min(channel.maxUsers, config.maxUsers) }));
  } else {
    config.channels = normalizeChannels(root.channels, config.maxUsers);
  }
  const defaultChannel = config.channels.find((channel) => channel.id === config.defaultChannelId);
  if (!defaultChannel) fail('room.defaultChannel', `找不到频道 “${config.defaultChannelId}”`);
  if (!defaultChannel.enabled) fail('room.defaultChannel', '默认频道必须启用');
  validateCrossConstraints(config);
  return config;
}

function parseConfig(source, filename = 'pavilo.yaml') {
  if (typeof source !== 'string' && !Buffer.isBuffer(source)) fail(filename, '配置内容必须是字符串或 Buffer');
  if (Buffer.byteLength(source) > MAX_CONFIG_BYTES) throw new Error(`${filename}: 配置文件不能超过 ${MAX_CONFIG_BYTES} 字节`);
  let document;
  try {
    document = YAML.parseDocument(source.toString(), { schema: 'core', strict: true, stringKeys: true, uniqueKeys: true });
    if (document.errors.length) throw document.errors[0];
    if (document.warnings.length) throw document.warnings[0];
    let hasAlias = false;
    YAML.visit(document, { Alias() { hasAlias = true; } });
    if (hasAlias) throw new Error('不允许使用 YAML 锚点别名');
    document = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`${filename}: YAML 解析失败：${error.message}`);
  }
  try {
    return normalizeConfig(document, { requireVersion: true });
  } catch (error) {
    throw new Error(`${filename}: ${error.message}`);
  }
}

function isHttpPublicPath(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const firstPart = relative.split(path.sep)[0];
  return firstPart === 'vendor' || HTTP_PUBLIC_FILES.has(relative);
}

function assertPrivateConfigPath(resolvedPath) {
  const realRoot = fs.realpathSync(ROOT);
  const realPath = fs.realpathSync(resolvedPath);
  if (isHttpPublicPath(resolvedPath, ROOT) || isHttpPublicPath(realPath, realRoot)) {
    throw new Error('配置文件不能位于 Pavilo 的 HTTP 公开路径（index.html 或 vendor/）');
  }
}

function readLimitedFile(resolvedPath) {
  const descriptor = fs.openSync(resolvedPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(MAX_CONFIG_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_CONFIG_BYTES) throw new Error(`配置文件不能超过 ${MAX_CONFIG_BYTES} 字节`);
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function loadConfig({ env = process.env, configPath } = {}) {
  const explicitlyConfigured = configPath !== undefined || Boolean(env.PAVILO_CONFIG);
  const resolvedPath = path.resolve(configPath || env.PAVILO_CONFIG || path.join(ROOT, 'pavilo.yaml'));
  let source;
  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) throw new Error('不是普通文件');
    if (stat.size > MAX_CONFIG_BYTES) throw new Error(`配置文件不能超过 ${MAX_CONFIG_BYTES} 字节`);
    assertPrivateConfigPath(resolvedPath);
    source = readLimitedFile(resolvedPath);
  } catch (error) {
    if (error.code !== 'ENOENT' || explicitlyConfigured) throw new Error(`无法读取配置文件 ${resolvedPath}：${error.message}`);
  }
  const config = source === undefined ? cloneDefaults() : parseConfig(source, resolvedPath);
  if (env.PORT !== undefined && env.PORT !== '') {
    if (typeof env.PORT !== 'string' || !DECIMAL_PORT_RE.test(env.PORT)) fail('PORT', '必须是 1–65535 的严格十进制整数');
    config.port = Number(env.PORT);
  }
  return { config, configPath: source === undefined ? null : resolvedPath };
}

function checkConfig() {
  try {
    const loaded = loadConfig();
    const source = loaded.configPath || '内置默认配置';
    process.stdout.write(`配置有效：${source}\n`);
  } catch (error) {
    process.stderr.write(`配置无效：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { CONFIG_VERSION, DEFAULTS, loadConfig, normalizeConfig, parseConfig };

if (require.main === module) checkConfig();
