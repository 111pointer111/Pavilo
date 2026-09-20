'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { parseConfig } = require('../config');
const { createSqliteStore } = require('../src/storage/sqlite-store');
const { isNodeSqliteAvailable } = require('../src/storage/sqlite-engine');
const { publicMessage } = require('../src/core/events');
const { main } = require('../src/storage/cli');

function textMessage(seq) {
  const message = {
    id: `m${seq}_cli`,
    seq,
    clientMessageId: `client-cli-${seq}`,
    kind: 'text',
    author: { id: 'u1', username: 'Alice', avatarSeed: 1, joinedAt: 1000 },
    createdAt: 1000 + seq,
    replyTo: null,
    reactions: {},
    text: `cli ${seq}`,
    reactionUsers: new Map()
  };
  message.byteSize = Buffer.byteLength(JSON.stringify(publicMessage(message)));
  return message;
}

if (!isNodeSqliteAvailable()) {
  test('storage cli', { skip: 'node:sqlite is unavailable' }, () => {});
} else {
  test('storage cli backup, restore, integrity and stats round-trip', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-cli-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const dbPath = path.join(directory, 'pavilo.db');
    const configPath = path.join(directory, 'pavilo.yaml');
    fs.writeFileSync(configPath, `
version: 2
storage:
  driver: sqlite
  sqlite:
    path: ${dbPath}
    engine: node
`);
    const config = parseConfig(fs.readFileSync(configPath, 'utf8'), configPath);
    const store = createSqliteStore(config);
    store.appendMessage('general', textMessage(store.incrementSeq('general')));
    store.close();

    const previous = process.env.PAVILO_CONFIG;
    process.env.PAVILO_CONFIG = configPath;
    t.after(() => {
      if (previous === undefined) delete process.env.PAVILO_CONFIG;
      else process.env.PAVILO_CONFIG = previous;
    });

    const backup = path.join(directory, 'backup.db');
    main(['backup', '--out', backup]);
    assert.equal(process.exitCode || 0, 0);
    assert.ok(fs.existsSync(backup));

    main(['integrity']);
    assert.equal(process.exitCode || 0, 0);
    main(['stats']);
    assert.equal(process.exitCode || 0, 0);

    process.exitCode = 0;
    main(['restore', '--from', backup]);
    assert.equal(process.exitCode, 1, 'restore without --force must refuse to overwrite');

    process.exitCode = 0;
    main(['restore', '--from', backup, '--force']);
    assert.equal(process.exitCode || 0, 0);
    const reopened = createSqliteStore(config);
    t.after(() => reopened.close());
    assert.equal(reopened.loadWorkingSet('general')[0].text, 'cli 1');
  });
}
