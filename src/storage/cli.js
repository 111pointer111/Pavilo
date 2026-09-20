'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../../config');
const { createConversationStore } = require('./index');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function has(args, name) {
  return args.includes(name);
}

function openSqliteStore() {
  const loaded = loadConfig();
  const config = loaded.config;
  if ((config.storage?.driver || 'memory') !== 'sqlite') {
    throw new Error('当前配置不是 sqlite。请使用 pavilo.sqlite.example.yaml 或在 version: 2 中设置 storage.driver: sqlite');
  }
  const store = createConversationStore(config);
  return { store, config, configPath: loaded.configPath };
}

function print(value) {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    print(`Usage: node src/storage/cli.js <command>

Commands:
  backup --out <file>     Consistent SQLite snapshot (VACUUM INTO)
  restore --from <file>   Replace the configured db; refuses overwrite unless --force
  integrity               PRAGMA integrity_check
  stats                   File size and per-channel counts

Stop Pavilo before restore.
`);
    return;
  }
  try {
    if (command === 'backup') {
      const dest = flag(args, '--out');
      if (!dest) throw new Error('backup 需要 --out <file>');
      const { store } = openSqliteStore();
      try {
        fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
        store.backup(path.resolve(dest));
        print(`backup written: ${path.resolve(dest)}`);
      } finally {
        store.close();
      }
      return;
    }
    if (command === 'restore') {
      const source = flag(args, '--from');
      if (!source) throw new Error('restore 需要 --from <file>');
      const from = path.resolve(source);
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) throw new Error(`找不到备份文件 ${from}`);
      const loaded = loadConfig();
      const dest = loaded.config.storage?.sqlite?.path;
      if (!dest) throw new Error('当前配置不是 sqlite');
      if (fs.existsSync(dest) && !has(args, '--force')) {
        throw new Error(`${dest} 已存在。停服后加 --force 才能覆盖`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(from, dest);
      const store = createConversationStore(loaded.config);
      try {
        const report = store.integrity();
        if (!report.ok) throw new Error(`恢复后完整性检查失败：${report.result}`);
        print(`restored ${from} -> ${dest}`);
      } finally {
        store.close();
      }
      return;
    }
    if (command === 'integrity') {
      const { store } = openSqliteStore();
      try { print(store.integrity()); } finally { store.close(); }
      return;
    }
    if (command === 'stats') {
      const { store } = openSqliteStore();
      try { print(store.inventory()); } finally { store.close(); }
      return;
    }
    throw new Error(`未知命令 ${command}`);
  } catch (error) {
    fail(error.message);
  }
}

module.exports = { main };

if (require.main === module) main();
