'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PLAY_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/;

function playRoot(root, playId) {
  return path.join(root, 'plays', playId);
}

function readManifest(directory, playId) {
  const raw = fs.readFileSync(path.join(directory, 'play.json'), 'utf8');
  let manifest;
  try { manifest = JSON.parse(raw); } catch {
    throw new Error(`plays/${playId}/play.json 不是合法 JSON`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`plays/${playId}/play.json 必须是对象`);
  }
  if (manifest.id !== playId) throw new Error(`plays/${playId}/play.json 的 id 必须等于目录名`);
  if (!fs.existsSync(path.join(directory, 'host.js'))) {
    throw new Error(`plays/${playId}/host.js 不存在`);
  }
  if (!fs.existsSync(path.join(directory, 'page', 'index.html'))) {
    throw new Error(`plays/${playId}/page/index.html 不存在`);
  }
  return manifest;
}

function loadPlayModule(root, playId) {
  if (!PLAY_ID_RE.test(playId)) throw new Error(`非法 playId “${playId}”`);
  const directory = playRoot(root, playId);
  const manifest = readManifest(directory, playId);
  const resolved = require.resolve(path.join(directory, 'host.js'));
  delete require.cache[resolved];
  const mod = require(resolved);
  if (!mod || mod.id !== playId || typeof mod.create !== 'function') {
    throw new Error(`plays/${playId}/host.js 必须导出 { id: '${playId}', create }`);
  }
  return { id: playId, directory, manifest, create: mod.create };
}

function loadEnabledPlays(root, playIds) {
  const ids = Array.isArray(playIds) ? playIds : [];
  const plays = new Map();
  for (const playId of ids) plays.set(playId, loadPlayModule(root, playId));
  return plays;
}

function publicPlayPath(playId, relative = '') {
  const suffix = relative ? String(relative).replace(/^\/+/, '') : '';
  return suffix ? `/plays/${playId}/${suffix}` : `/plays/${playId}/`;
}

module.exports = { PLAY_ID_RE, playRoot, readManifest, loadPlayModule, loadEnabledPlays, publicPlayPath };
