'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { CONFIG_VERSION, DEFAULTS, loadConfig, normalizeConfig, parseConfig } = require('../config');

const ROOT = path.resolve(__dirname, '..');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeConfig(t, source, filename = 'pavilo.yaml') {
  const file = path.join(temporaryDirectory(t), filename);
  fs.writeFileSync(file, source);
  return file;
}

function throwsMatch(action, pattern) {
  assert.throws(action, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

test('built-in defaults are immutable and missing default file falls back to a clone', () => {
  assert.equal(CONFIG_VERSION, 1);
  assert.equal(DEFAULTS.exposeMemberIps, true);
  assert.equal(DEFAULTS.defaultChannelId, 'general');
  assert.equal(DEFAULTS.channels[0].maxUsers, DEFAULTS.maxUsers);
  assert.ok(Object.isFrozen(DEFAULTS));
  assert.ok(Object.isFrozen(DEFAULTS.channels));
  assert.ok(Object.isFrozen(DEFAULTS.channels[0]));

  const loaded = loadConfig({ env: {} });
  assert.equal(loaded.configPath, null);
  assert.deepEqual(loaded.config, DEFAULTS);
  assert.notEqual(loaded.config, DEFAULTS);
  assert.notEqual(loaded.config.channels, DEFAULTS.channels);
});

test('partial config overrides values and tightens omitted default channel capacity', () => {
  const config = parseConfig(`
version: 1
server:
  host: 127.0.0.1
  port: 8080
  maxUsers: 10
  maxConnections: 20
room:
  title: 小亭
  exposeMemberIps: false
rateLimits:
  messages: 4
`);

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8080);
  assert.equal(config.maxUsers, 10);
  assert.equal(config.maxClients, 20);
  assert.equal(config.roomTitle, '小亭');
  assert.equal(config.exposeMemberIps, false);
  assert.equal(config.messageRateLimit, 4);
  assert.equal(config.maxImageBytes, DEFAULTS.maxImageBytes);
  assert.deepEqual(config.channels, [{
    id: 'general',
    name: '闲聊',
    description: '轻松聊聊，只留当下。',
    enabled: true,
    maxUsers: 10
  }]);
});

test('explicit channels replace general and support a non-general default', () => {
  const config = parseConfig(`
version: 1
server:
  maxUsers: 24
room:
  defaultChannel: projects
channels:
  - id: projects
    name: 项目
  - id: archive
    name: 存档
    enabled: false
    maxUsers: 3
`);

  assert.equal(config.defaultChannelId, 'projects');
  assert.deepEqual(config.channels.map(({ id, enabled, maxUsers }) => ({ id, enabled, maxUsers })), [
    { id: 'projects', enabled: true, maxUsers: 24 },
    { id: 'archive', enabled: false, maxUsers: 3 }
  ]);
  assert.equal(config.channels.some((channel) => channel.id === 'general'), false);
});

test('normalization defaults programmatic input, while files require a version and reject unknown keys and strict types', () => {
  assert.deepEqual(normalizeConfig({}), DEFAULTS);
  throwsMatch(() => parseConfig('{}\n'), /version.*必须声明/);
  throwsMatch(() => parseConfig('version: 2\n'), /当前只支持版本 1/);
  throwsMatch(() => parseConfig('version: 1\nserver:\n  maxUserz: 4\n'), /server\.maxUserz.*未知配置项/);
  throwsMatch(() => parseConfig('version: 1\nserver:\n  maxUsers: "4"\n'), /server\.maxUsers.*整数/);
  throwsMatch(() => parseConfig('version: 1\nroom:\n  exposeMemberIps: yes\n'), /room\.exposeMemberIps.*true 或 false/);
  throwsMatch(() => parseConfig('version: 1\nchannels:\n  - id: General\n    name: 闲聊\n'), /channels\[0\]\.id/);
});

test('YAML parser rejects invalid roots, duplicate keys, aliases, unknown tags, and multiple documents', () => {
  for (const root of ['false\n', '0\n', '[]\n', 'null\n']) {
    throwsMatch(() => parseConfig(root), /config: 必须是对象/);
  }
  throwsMatch(() => parseConfig('version: 1\nserver:\n  port: 4173\n  port: 8080\n'), /YAML 解析失败.*Map keys must be unique/s);
  throwsMatch(() => parseConfig('version: 1\nserver: &shared\n  port: 4173\nroom: *shared\n'), /YAML 解析失败.*别名/s);
  throwsMatch(() => parseConfig('version: 1\nroom:\n  title: !secret hello\n'), /YAML 解析失败.*Unresolved tag/s);
  throwsMatch(() => parseConfig('version: 1\n---\nversion: 1\n'), /YAML 解析失败.*multiple documents/i);
});

test('channel, default, and connection relationships are validated', () => {
  throwsMatch(() => parseConfig(`
version: 1
server:
  maxUsers: 5
channels:
  - id: general
    name: 闲聊
    maxUsers: 6
`), /channels\[0\]\.maxUsers/);
  throwsMatch(() => parseConfig(`
version: 1
room:
  defaultChannel: missing
`), /room\.defaultChannel.*找不到频道/);
  throwsMatch(() => parseConfig(`
version: 1
channels:
  - id: general
    name: 闲聊
    enabled: false
`), /至少要启用一个频道/);
  throwsMatch(() => parseConfig(`
version: 1
server:
  maxUsers: 20
  maxConnections: 10
`), /server\.maxConnections.*不能小于/);
  throwsMatch(() => parseConfig(`
version: 1
server:
  maxUsers: 10
  maxConnections: 20
  maxConnectionsPerIp: 21
`), /server\.maxConnectionsPerIp.*不能大于/);
});

test('JSON, frame, channel, roster, and writable capacity relationships are validated', () => {
  throwsMatch(() => parseConfig(`
version: 1
limits:
  maxImageBytes: 1000000
  maxJsonBytes: 1200000
`), /limits\.maxJsonBytes.*base64/);
  throwsMatch(() => parseConfig(`
version: 1
server:
  maxUsers: 1000
  maxConnections: 1000
limits:
  maxImageBytes: 1
  maxTextLength: 1
  maxJsonBytes: 500000
`), /limits\.maxJsonBytes.*成员列表/);
  throwsMatch(() => parseConfig(`
version: 1
limits:
  maxJsonBytes: 600000
  maxWebSocketFrameBytes: 599999
`), /limits\.maxWebSocketFrameBytes/);
  throwsMatch(() => parseConfig(`
version: 1
limits:
  maxJsonBytes: 600000
  maxWebSocketFrameBytes: 600000
  maxWritableBytes: 600000
`), /limits\.maxWritableBytes/);
  throwsMatch(() => parseConfig(`
version: 1
limits:
  maxChannelBytes: 100000
`), /limits\.maxChannelBytes/);
});

test('timeouts and origins are validated', () => {
  throwsMatch(() => parseConfig(`
version: 1
timeouts:
  heartbeatIntervalMs: 5000
  heartbeatTimeoutMs: 5000
`), /heartbeatTimeoutMs.*必须大于/);
  throwsMatch(() => parseConfig(`
version: 1
server:
  allowedOrigins:
    - https://example.test/path
`), /allowedOrigins\[0\].*不含路径/);
  throwsMatch(() => parseConfig(`
version: 1
server:
  allowedOrigins:
    - https://example.test
    - https://example.test
`), /不能包含重复 Origin/);
  throwsMatch(() => parseConfig(`
version: 1
timeouts:
  resumeLeaseMs: 1000
`), /resumeLeaseMs.*未知配置项/);
});

test('PORT strictly overrides YAML port and invalid forms are rejected', (t) => {
  const file = writeConfig(t, 'version: 1\nserver:\n  port: 5000\n');
  const loaded = loadConfig({ env: { PORT: '8080' }, configPath: file });
  assert.equal(loaded.config.port, 8080);

  for (const port of ['0', '65536', '08080', '8080.0', '0x1f90', '+8080', ' 8080', '8080 ', '1e3', 'abc']) {
    throwsMatch(() => loadConfig({ env: { PORT: port }, configPath: file }), /PORT.*严格十进制/);
  }
  assert.equal(loadConfig({ env: { PORT: '' }, configPath: file }).config.port, 5000);
});

test('loads explicit PAVILO_CONFIG and explicit missing files fail', (t) => {
  const file = writeConfig(t, 'version: 1\nroom:\n  title: 环境配置\n');
  const loaded = loadConfig({ env: { PAVILO_CONFIG: file } });
  assert.equal(loaded.configPath, path.resolve(file));
  assert.equal(loaded.config.roomTitle, '环境配置');

  const missing = path.join(path.dirname(file), 'missing.yaml');
  throwsMatch(() => loadConfig({ env: { PAVILO_CONFIG: missing } }), /无法读取配置文件.*ENOENT/);
  throwsMatch(() => loadConfig({ env: {}, configPath: missing }), /无法读取配置文件.*ENOENT/);
});

test('checks file size before opening or reading the file', (t) => {
  const file = writeConfig(t, Buffer.alloc(256 * 1024 + 1, 0x20), 'large.yaml');
  const originalOpen = fs.openSync;
  let attempted = false;
  fs.openSync = function patchedOpen(candidate, ...args) {
    if (path.resolve(candidate) === path.resolve(file)) attempted = true;
    return originalOpen.call(this, candidate, ...args);
  };
  try {
    throwsMatch(() => loadConfig({ env: {}, configPath: file }), /不能超过 262144 字节/);
    assert.equal(attempted, false);
  } finally {
    fs.openSync = originalOpen;
  }
});

test('rejects HTTP-public config paths and symlinks resolving to them', (t) => {
  const vendorConfig = path.join(ROOT, 'vendor', `config-test-${process.pid}.yaml`);
  fs.writeFileSync(vendorConfig, 'version: 1\n');
  t.after(() => fs.rmSync(vendorConfig, { force: true }));
  throwsMatch(() => loadConfig({ env: {}, configPath: vendorConfig }), /HTTP 公开路径/);
  throwsMatch(() => loadConfig({ env: {}, configPath: path.join(ROOT, 'index.html') }), /HTTP 公开路径/);

  const directory = temporaryDirectory(t);
  const symlink = path.join(directory, 'linked.yaml');
  fs.symlinkSync(vendorConfig, symlink);
  throwsMatch(() => loadConfig({ env: {}, configPath: symlink }), /HTTP 公开路径/);
});

test('rejects a config source larger than the parser limit', () => {
  throwsMatch(() => parseConfig(Buffer.alloc(256 * 1024 + 1)), /不能超过 262144 字节/);
});

test('the distributed example parses and explicitly documents every config section', () => {
  const examplePath = path.join(ROOT, 'pavilo.example.yaml');
  const source = fs.readFileSync(examplePath, 'utf8');
  const config = parseConfig(source, examplePath);
  assert.equal(config.port, 4173);
  assert.equal(config.exposeMemberIps, true);
  assert.equal(config.defaultChannelId, 'general');
  assert.deepEqual(config.channels.map((channel) => channel.id), ['general', 'projects', 'announcements']);
  assert.equal(config.channels.at(-1).enabled, false);
  for (const section of ['server:', 'room:', 'channels:', 'limits:', 'timeouts:', 'rateLimits:']) {
    assert.match(source, new RegExp(`^${section}`, 'm'));
  }
  assert.doesNotMatch(source, /resumeLeaseMs/);
});
