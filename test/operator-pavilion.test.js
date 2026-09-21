'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createChatServer } = require('../server');
const { openWebSocket } = require('./helpers/raw-websocket');

const TOKEN = 'a'.repeat(64);

function sqliteDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pavilo-pavilion-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function start(t, extra = {}) {
  const directory = sqliteDir(t);
  const dbPath = path.join(directory, 'pavilo.db');
  const app = createChatServer({
    host: '127.0.0.1',
    roomTitle: 'YAML 标题',
    defaultLanguage: 'zh-CN',
    operator: { enabled: true, token: TOKEN },
    storage: { driver: 'sqlite', sqlite: { path: dbPath, engine: 'auto', retentionDays: 30 } },
    channels: [
      { id: 'general', name: '闲聊', description: '第一间', enabled: true, maxUsers: 8 },
      { id: 'project', name: '项目', description: '第二间', enabled: true, maxUsers: 8 }
    ],
    ...extra
  });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.stop());
  return { app, origin: `http://127.0.0.1:${address.port}`, dbPath, port: address.port };
}

async function login(origin) {
  const response = await fetch(`${origin}/admin/api/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN })
  });
  const payload = await response.json();
  const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
  return { response, payload, cookie, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' } };
}

test('pavilion GET follows YAML until the first admin save', async (t) => {
  const { origin, app } = await start(t);
  const { headers } = await login(origin);
  const body = await (await fetch(`${origin}/admin/api/pavilion`, { headers })).json();
  assert.equal(body.sources.room, 'yaml');
  assert.equal(body.sources.channels, 'yaml');
  assert.equal(body.room.title, 'YAML 标题');
  assert.equal(body.channels.length, 2);
  assert.equal(app.pavilionSources.room, 'yaml');
});

test('saving room claims the section and survives reopen with a different YAML title', async (t) => {
  const { origin, dbPath } = await start(t);
  const { headers } = await login(origin);
  const saved = await fetch(`${origin}/admin/api/pavilion/room`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      title: '管理页标题',
      defaultLanguage: 'en',
      defaultChannel: 'general',
      maxUsers: 20,
      exposeMemberIps: false,
      exposeLanUrls: false
    })
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.sources.room, 'operator');
  assert.equal(savedBody.sources.channels, 'yaml');
  assert.equal(savedBody.room.title, '管理页标题');

  const info = await (await fetch(`${origin}/room-info`)).json();
  assert.equal(info.roomTitle, '管理页标题');
  assert.equal(info.defaultLanguage, 'en');

  const restarted = createChatServer({
    host: '127.0.0.1',
    roomTitle: 'YAML 已经改过',
    defaultLanguage: 'zh-CN',
    operator: { enabled: true, token: TOKEN },
    storage: { driver: 'sqlite', sqlite: { path: dbPath, engine: 'auto', retentionDays: 30 } }
  });
  const address = await restarted.listen(0, '127.0.0.1');
  t.after(() => restarted.stop());
  assert.equal(restarted.pavilionSources.room, 'operator');
  assert.equal(restarted.config.roomTitle, '管理页标题');
  assert.equal(restarted.config.defaultLanguage, 'en');
  assert.match(restarted.pavilionWarnings.join('\n'), /房间设置已由管理页接管/);
  const again = await (await fetch(`http://127.0.0.1:${address.port}/room-info`)).json();
  assert.equal(again.roomTitle, '管理页标题');
});

test('claiming only room still lets YAML channels apply on reopen', async (t) => {
  const directory = sqliteDir(t);
  const dbPath = path.join(directory, 'pavilo.db');
  const first = createChatServer({
    host: '127.0.0.1',
    operator: { token: TOKEN },
    storage: { driver: 'sqlite', sqlite: { path: dbPath, engine: 'auto', retentionDays: 30 } }
  });
  const address = await first.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const { headers } = await login(origin);
  const room = await (await fetch(`${origin}/admin/api/pavilion`, { headers })).json();
  await fetch(`${origin}/admin/api/pavilion/room`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...room.room, title: '只认领房间' })
  });
  await first.stop();

  const second = createChatServer({
    host: '127.0.0.1',
    roomTitle: 'YAML 标题',
    operator: { token: TOKEN },
    storage: { driver: 'sqlite', sqlite: { path: dbPath, engine: 'auto', retentionDays: 30 } },
    channels: [
      { id: 'general', name: '闲聊', enabled: true, maxUsers: 8 },
      { id: 'ops', name: '运维', enabled: true, maxUsers: 8 }
    ]
  });
  t.after(() => second.stop());
  assert.equal(second.config.roomTitle, '只认领房间');
  assert.deepEqual(second.config.channels.map((channel) => channel.id), ['general', 'ops']);
  assert.equal(second.pavilionSources.channels, 'yaml');
});

test('invalid catalog is rejected and leaves memory unchanged', async (t) => {
  const { origin, app } = await start(t);
  const { headers } = await login(origin);
  const before = app.config.channels.map((channel) => channel.id);
  const response = await fetch(`${origin}/admin/api/pavilion/channels`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      channels: [{ id: 'quiet', name: '安静', enabled: true, readOnly: true, maxUsers: 8, welcome: '' }]
    })
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'OPERATOR_BAD_REQUEST');
  assert.match(body.message, /至少要启用一个可发言的频道/);
  assert.deepEqual(app.config.channels.map((channel) => channel.id), before);
  assert.equal(app.pavilionSources.channels, 'yaml');
});

test('occupied channel cannot be disabled or deleted', async (t) => {
  const { origin, port, app } = await start(t);
  const { headers } = await login(origin);
  const client = await openWebSocket({ port });
  t.after(() => client.close());
  client.sendJson({
    type: 'join',
    protocolVersion: 4,
    username: 'Ada',
    channelId: 'project',
    clientSessionId: 'session-ada-001'
  });
  await client.nextJson((payload) => payload.type === 'stateStart');

  const disable = await fetch(`${origin}/admin/api/pavilion/channels`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      channels: app.config.channels.map((channel) => (
        channel.id === 'project' ? { ...channel, enabled: false } : channel
      ))
    })
  });
  assert.equal(disable.status, 409);
  assert.equal((await disable.json()).code, 'CHANNEL_BUSY');

  const remove = await fetch(`${origin}/admin/api/pavilion/channels`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      channels: app.config.channels.filter((channel) => channel.id !== 'project')
    })
  });
  assert.equal(remove.status, 409);
});

test('adding a channel applies immediately and revert restores YAML', async (t) => {
  const { origin, app } = await start(t);
  const { headers } = await login(origin);
  const current = await (await fetch(`${origin}/admin/api/pavilion`, { headers })).json();
  const created = await fetch(`${origin}/admin/api/pavilion/channels`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      channels: current.channels.concat([{
        id: 'lounge',
        name: '会客',
        description: '',
        enabled: true,
        readOnly: false,
        maxUsers: 8,
        welcome: '欢迎'
      }])
    })
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.sources.channels, 'operator');
  assert.ok(createdBody.channels.some((channel) => channel.id === 'lounge'));
  const info = await (await fetch(`${origin}/room-info`)).json();
  assert.ok(info.channels.some((channel) => channel.id === 'lounge'));

  const reverted = await fetch(`${origin}/admin/api/pavilion/channels`, { method: 'DELETE', headers });
  assert.equal(reverted.status, 200);
  const revertedBody = await reverted.json();
  assert.equal(revertedBody.sources.channels, 'yaml');
  assert.deepEqual(revertedBody.channels.map((channel) => channel.id), ['general', 'project']);
  assert.equal(app.pavilionSources.channels, 'yaml');
});

test('operator people list, mute, kick, and IP deny list', async (t) => {
  const { origin, port } = await start(t);
  const { headers } = await login(origin);
  const empty = await (await fetch(`${origin}/admin/api/people`, { headers })).json();
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.seats, []);
  assert.deepEqual(empty.moderation.ipDenyList, []);
  assert.equal(empty.sources.moderation, 'yaml');

  const client = await openWebSocket({ port });
  t.after(() => client.close());
  client.sendJson({
    type: 'join',
    protocolVersion: 4,
    username: '北岸的猫',
    clientSessionId: 'session-people-0001',
    channelId: 'general'
  });
  await client.nextJson((payload) => payload.type === 'stateStart');

  const listing = await (await fetch(`${origin}/admin/api/people`, { headers })).json();
  assert.equal(listing.seats.length, 1);
  assert.equal(listing.seats[0].username, '北岸的猫');
  assert.equal(listing.seats[0].status, 'connected');
  const id = listing.seats[0].id;
  const ip = listing.seats[0].ip;

  const muted = await fetch(`${origin}/admin/api/people/${encodeURIComponent(id)}/mute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ active: true })
  });
  assert.equal(muted.status, 200);
  assert.equal((await muted.json()).seat.muted, true);
  assert.equal((await client.nextJson((payload) => payload.type === 'moderation')).action, 'muted');

  const kicked = await fetch(`${origin}/admin/api/people/${encodeURIComponent(id)}/kick`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ denyIp: true })
  });
  assert.equal(kicked.status, 200);
  const kickedBody = await kicked.json();
  assert.equal(kickedBody.seats.length, 0);
  assert.ok(kickedBody.moderation.ipDenyList.includes(ip));
  assert.equal(kickedBody.sources.moderation, 'operator');
  assert.ok(kickedBody.log.some((entry) => entry.action === 'kick-deny'));

  const reverted = await fetch(`${origin}/admin/api/moderation`, { method: 'DELETE', headers });
  assert.equal(reverted.status, 200);
  const revertedBody = await reverted.json();
  assert.equal(revertedBody.sources.moderation, 'yaml');
  assert.deepEqual(revertedBody.moderation.ipDenyList, []);
});
