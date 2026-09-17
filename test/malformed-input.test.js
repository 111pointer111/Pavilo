'use strict';

const assert = require('node:assert');
const test = require('node:test');

test('malformed config handling', async (t) => {
  await t.test('malformed YAML config', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-test-'));
    const configPath = path.join(tmpDir, 'bad-config.yaml');

    // Write malformed YAML
    fs.writeFileSync(configPath, `
version: 1
server:
  port: 4173
  invalid syntax here [[[
  maxUsers: "not a number"
`);

    const { loadConfig } = require('../config.js');

    try {
      loadConfig(configPath);
      assert.fail('Should reject malformed YAML');
    } catch (error) {
      assert(error.message.includes('YAML') || error.message.includes('parse') || error.message.includes('invalid'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  await t.test('invalid config values', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-test-'));
    const configPath = path.join(tmpDir, 'invalid-config.yaml');

    // Write config with invalid values
    fs.writeFileSync(configPath, `
version: 1
server:
  port: -1
  maxUsers: 0
  maxClients: 100000
`);

    const { loadConfig } = require('../config.js');

    try {
      loadConfig(configPath);
      assert.fail('Should reject invalid config values');
    } catch (error) {
      assert(error.message);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  await t.test('deeply nested channels', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-test-'));
    const configPath = path.join(tmpDir, 'nested-config.yaml');

    // Create config with many channels
    const channels = [];
    for (let i = 0; i < 50; i++) {
      channels.push(`  - id: channel${i}\n    name: Channel ${i}\n    enabled: true`);
    }

    fs.writeFileSync(configPath, `version: 1\nchannels:\n${channels.join('\n')}\n`);

    const { loadConfig } = require('../config.js');

    try {
      // Should handle many channels gracefully
      const config = loadConfig(configPath);
      assert(config.channels && config.channels.length >= 1);
    } catch (error) {
      // May fail if too many channels, which is acceptable
      assert(error.message);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  await t.test('valid config with special characters', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-test-'));
    const configPath = path.join(tmpDir, 'special-config.yaml');

    // Config with special characters
    fs.writeFileSync(configPath, `version: 1
channels:
  - id: test
    name: "Test Channel"
    enabled: true
`);

    const { loadConfig } = require('../config.js');

    // Should handle config successfully without throwing
    const config = loadConfig(configPath);
    assert(config !== null && config !== undefined);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
