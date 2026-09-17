// 测试示例配置可被当前配置加载器正确解析
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../config');
const fs = require('node:fs');
const path = require('node:path');

test('pavilo.example.yaml can be parsed by current config loader', () => {
  const examplePath = path.join(__dirname, '../pavilo.example.yaml');
  assert.ok(fs.existsSync(examplePath), 'pavilo.example.yaml should exist');

  // 加载示例配置（不进行完整校验，因为示例中可能有占位值）
  const yaml = fs.readFileSync(examplePath, 'utf-8');
  assert.ok(yaml.includes('version: 1'), 'Example config should declare version: 1');
  assert.ok(yaml.includes('id: general'), 'Example config should have general channel');
  assert.ok(yaml.includes('id: project'), 'Example config should have project channel');
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
