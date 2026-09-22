'use strict';

const crypto = require('node:crypto');

function rowToReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    channelId: row.channel_id,
    messageId: row.message_id,
    reporterId: row.reporter_id,
    reporterUserKey: row.reporter_user_key || null,
    reporterUsername: row.reporter_username,
    reason: row.reason || '',
    status: row.status,
    createdAt: row.created_at
  };
}

function createGovernanceStore(engine, runtime = {}) {
  const now = runtime.now || Date.now;
  const randomId = runtime.randomId || ((prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`);
  const selectDuplicate = engine.prepare(`SELECT * FROM reports
    WHERE channel_id = ? AND message_id = ? AND reporter_id = ? AND status = 'open'`);
  const insertReport = engine.prepare(`INSERT INTO reports (
    id, channel_id, message_id, reporter_id, reporter_user_key, reporter_username, reason, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`);
  const selectOpen = engine.prepare(`SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT ?`);
  const selectById = engine.prepare('SELECT * FROM reports WHERE id = ?');
  const updateStatus = engine.prepare(`UPDATE reports SET status = ? WHERE id = ? AND status = 'open'`);
  const markMessage = engine.prepare(`UPDATE reports SET status = 'removed'
    WHERE channel_id = ? AND message_id = ? AND status = 'open'`);
  const insertAction = engine.prepare('INSERT INTO operator_actions (at, action, detail) VALUES (?, ?, ?)');
  const pruneActions = engine.prepare(`DELETE FROM operator_actions WHERE id NOT IN (
    SELECT id FROM operator_actions ORDER BY id DESC LIMIT 200
  )`);
  const selectActions = engine.prepare('SELECT at, action, detail FROM operator_actions ORDER BY id DESC LIMIT ?');

  function addReport(input) {
    const existing = selectDuplicate.get(input.channelId, input.messageId, input.reporterId);
    if (existing) return rowToReport(existing);
    const id = randomId('r');
    const createdAt = now();
    insertReport.run(
      id,
      input.channelId,
      input.messageId,
      input.reporterId,
      input.reporterUserKey || null,
      input.reporterUsername,
      input.reason || '',
      createdAt
    );
    return rowToReport(selectById.get(id));
  }

  function listOpen(limit = 50) {
    const cap = Math.min(Math.max(1, Number(limit) || 50), 50);
    return selectOpen.all(cap).map(rowToReport);
  }

  function getReport(id) {
    return rowToReport(selectById.get(id));
  }

  function setStatus(id, status) {
    if (!updateStatus.run(status, id).changes) return null;
    return getReport(id);
  }

  function markMessageRemoved(channelId, messageId) {
    markMessage.run(channelId, messageId);
  }

  function appendAction(action, detail = {}) {
    insertAction.run(now(), action, JSON.stringify(detail));
    pruneActions.run();
  }

  function listActions(limit = 50) {
    const cap = Math.min(Math.max(1, Number(limit) || 50), 50);
    return selectActions.all(cap).map((row) => {
      let detail = {};
      try { detail = JSON.parse(row.detail) || {}; } catch { detail = {}; }
      return { at: row.at, action: row.action, ...detail };
    });
  }

  return { addReport, listOpen, getReport, setStatus, markMessageRemoved, appendAction, listActions };
}

module.exports = { createGovernanceStore };
