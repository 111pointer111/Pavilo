'use strict';

const { normalizeIp, isIpAddress, MAX_IP_DENY_LIST } = require('../ip');

function peopleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createPeopleController({ core, pavilion, now = Date.now }) {
  const log = [];

  function note(action, detail = {}) {
    if (core.recordAction) core.recordAction(action, detail);
    log.unshift({ at: now(), action, ...detail });
    if (log.length > 20) log.length = 20;
  }

  function listing() {
    const snapshot = pavilion.snapshot();
    const seats = core.listSeats();
    const persisted = core.listActions();
    return {
      ok: true,
      seats,
      moderation: snapshot.moderation,
      sources: snapshot.sources,
      updatedAt: snapshot.updatedAt,
      reports: core.listReports(),
      log: Array.isArray(persisted) ? persisted : log,
      online: seats.filter((seat) => seat.status === 'connected').length,
      leased: seats.filter((seat) => seat.status === 'leased').length
    };
  }

  function requireSeat(id) {
    const seat = core.getSeat(id);
    if (!seat) throw peopleError('NOT_FOUND', '这一席已经不在了。');
    return seat;
  }

  function mute(id, active) {
    const seat = requireSeat(id);
    if (seat.kind === 'agent') throw peopleError('AGENT_SEAT', '玩法席不能禁言。');
    const result = core.mute(id, active);
    if (!result.ok) throw peopleError(result.error, result.error === 'AGENT_SEAT' ? '玩法席不能禁言。' : '这一席已经不在了。');
    note(active ? 'mute' : 'unmute', { id: seat.id, name: seat.username });
    return { ok: true, seat: result.seat, ...listing() };
  }

  function kick(id, { denyIp } = {}) {
    const seat = requireSeat(id);
    if (seat.kind === 'agent') throw peopleError('AGENT_SEAT', '玩法席不能请离。');
    if (denyIp && seat.ip) {
      const ip = normalizeIp(seat.ip);
      const list = [...(pavilion.snapshot().moderation.ipDenyList || [])];
      if (!list.includes(ip)) {
        if (list.length >= MAX_IP_DENY_LIST) throw peopleError('OPERATOR_BAD_REQUEST', `最多 ${MAX_IP_DENY_LIST} 条 IP`);
        list.push(ip);
      }
      pavilion.saveModeration({ ipDenyList: list });
      note('kick-deny', { id: seat.id, name: seat.username, ip });
    } else {
      const result = core.kick(id);
      if (!result.ok) throw peopleError(result.error, '这一席已经不在了。');
      note('kick', { id: seat.id, name: seat.username, ip: seat.ip || '' });
    }
    return listing();
  }

  function messages(id, query) {
    requireSeat(id);
    const page = core.listSeatMessages(id, query);
    if (!page.ok) throw peopleError(page.error, '这一席已经不在了。');
    return { ok: true, ...page };
  }

  function saveModeration(input) {
    const before = pavilion.snapshot().moderation || {};
    pavilion.saveModeration(input);
    const after = pavilion.snapshot().moderation || {};
    if (input && input.ipDenyList !== undefined
      && JSON.stringify(before.ipDenyList || []) !== JSON.stringify(after.ipDenyList || [])) {
      note('deny-save', { count: (after.ipDenyList || []).length });
    }
    if (input && input.userDenyList !== undefined
      && JSON.stringify(before.userDenyList || []) !== JSON.stringify(after.userDenyList || [])) {
      note('user-deny-save', { count: (after.userDenyList || []).length });
    }
    return listing();
  }

  function removeMessage(channelId, messageId) {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') {
      throw peopleError('OPERATOR_BAD_REQUEST', '缺少频道或消息。');
    }
    const result = core.removeMessage(channelId, messageId);
    if (!result.ok) {
      throw peopleError(result.error === 'NOT_FOUND' ? 'NOT_FOUND' : 'OPERATOR_BAD_REQUEST',
        result.error === 'NOT_FOUND' ? '这条内容已经不在了。' : '没能移除。');
    }
    if (!result.already) note('message-remove', { channel: channelId, messageId });
    return listing();
  }

  function dismissReport(id) {
    const report = core.resolveReport(id, 'dismissed');
    if (!report) throw peopleError('NOT_FOUND', '这条举报已经不在了。');
    note('report-dismiss', { messageId: report.messageId });
    return listing();
  }

  function removeReport(id) {
    const report = core.getReport(id);
    if (!report || report.status !== 'open') throw peopleError('NOT_FOUND', '这条举报已经不在了。');
    const removed = core.removeMessage(report.channelId, report.messageId);
    if (!removed.ok && removed.error !== 'NOT_FOUND') throw peopleError('OPERATOR_BAD_REQUEST', '没能移除。');
    if (!removed.ok) core.resolveReport(id, 'removed');
    note('message-remove', { channel: report.channelId, messageId: report.messageId });
    return listing();
  }

  function revertModeration() {
    pavilion.revertModeration();
    note('deny-revert', {});
    return listing();
  }

  return {
    listing, mute, kick, messages, requireSeat, saveModeration, revertModeration,
    removeMessage, dismissReport, removeReport
  };
}

module.exports = { createPeopleController, peopleError, isIpAddress, normalizeIp };
