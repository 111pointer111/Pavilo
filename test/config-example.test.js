// 测试示例配置可被当前配置加载器正确解析
const { test } = require('node:test');
const assert = require('node:assert');
const { parseConfig } = require('../config');
const fs = require('node:fs');
const path = require('node:path');

test('pavilo.example.yaml can be parsed by current config loader', () => {
  const examplePath = path.join(__dirname, '../pavilo.example.yaml');
  assert.ok(fs.existsSync(examplePath), 'pavilo.example.yaml should exist');

  const yaml = fs.readFileSync(examplePath, 'utf-8');
  assert.ok(yaml.includes('version: 1'), 'Memory example should declare version: 1');
  assert.ok(yaml.includes('id: general'), 'Example config should have general channel');
  assert.ok(yaml.includes('id: project'), 'Example config should have project channel');
  assert.ok(!/^storage:/m.test(yaml), 'Memory example must not declare storage');
});

test('pavilo.sqlite.example.yaml can be parsed as sqlite storage', () => {
  const examplePath = path.join(__dirname, '../pavilo.sqlite.example.yaml');
  assert.ok(fs.existsSync(examplePath), 'pavilo.sqlite.example.yaml should exist');
  const config = parseConfig(fs.readFileSync(examplePath, 'utf8'), examplePath);
  assert.equal(config.storage.driver, 'sqlite');
  assert.equal(config.storage.sqlite.engine, 'auto');
  assert.equal(config.storage.sqlite.retentionDays, 30);
  assert.match(config.storage.sqlite.path, /pavilo\.db$/);
});

test('pavilo.sqlite.example.yaml documents operator.token instead of gateway channels', () => {
  const examplePath = path.join(__dirname, '../pavilo.sqlite.example.yaml');
  const yaml = fs.readFileSync(examplePath, 'utf-8');
  assert.ok(yaml.includes('version: 2'));
  assert.ok(yaml.includes('openssl rand -hex 32'));
  assert.ok(!/^gateway:/m.test(yaml));
  const config = parseConfig(yaml, examplePath);
  assert.equal(config.operator.token, '');
  assert.equal(config.operator.enabled, false);
});

test('only memory and sqlite example yaml files are maintained', () => {
  const root = path.join(__dirname, '..');
  const examples = fs.readdirSync(root).filter((name) => name.endsWith('.example.yaml')).sort();
  assert.deepEqual(examples, ['pavilo.example.yaml', 'pavilo.sqlite.example.yaml']);
});

test('sqlite example documents plays and identity without enabling them', () => {
  const examplePath = path.join(__dirname, '../pavilo.sqlite.example.yaml');
  const yaml = fs.readFileSync(examplePath, 'utf8');
  assert.ok(yaml.includes('# plays:'));
  assert.ok(yaml.includes('#   - echo'));
  assert.ok(yaml.includes('# identity:'));
  assert.ok(yaml.includes('play: echo'));
  assert.ok(yaml.includes('access: authenticated'));
  assert.ok(yaml.includes('examples/host-identity'));
  const config = parseConfig(yaml, examplePath);
  assert.deepEqual(config.plays, []);
  assert.deepEqual(config.identity.issuers, []);
  assert.equal(config.channels.some((channel) => channel.play === 'echo'), false);
  assert.equal(config.channels.some((channel) => channel.access === 'authenticated'), false);
});

test('default channels match README documentation', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf-8');

  // 确认 README 中提到的默认频道是 general + project
  assert.ok(readme.includes('general') && readme.includes('project'),
    'README should mention general and project as default channels');

  // 确认 README 中没有旧的 awesome-ai
  assert.ok(!readme.includes('awesome-ai'),
    'README should not mention deprecated awesome-ai channel');
});

test('example config declares readOnly field', () => {
  const examplePath = path.join(__dirname, '../pavilo.example.yaml');
  const yaml = fs.readFileSync(examplePath, 'utf-8');
  assert.ok(yaml.includes('readOnly:'), 'Example config should demonstrate readOnly field');
});

test('example config declares defaultLanguage', () => {
  const examplePath = path.join(__dirname, '../pavilo.example.yaml');
  const yaml = fs.readFileSync(examplePath, 'utf-8');
  assert.ok(yaml.includes('defaultLanguage: zh-CN'), 'Example config should declare defaultLanguage');
});
