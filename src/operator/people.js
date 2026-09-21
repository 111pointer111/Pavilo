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
    log.unshift({ at: now(), action, ...detail });
    if (log.length > 20) log.length = 20;
  }

  function listing() {
    const snapshot = pavilion.snapshot();
    const seats = core.listSeats();
    return {
      ok: true,
      seats,
      moderation: snapshot.moderation,
      sources: snapshot.sources,
      updatedAt: snapshot.updatedAt,
      log,
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
    note(active ? 'mute' : 'unmute', { id: seat.id, username: seat.username });
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
      note('kick-deny', { id: seat.id, username: seat.username, ip });
    } else {
      const result = core.kick(id);
      if (!result.ok) throw peopleError(result.error, '这一席已经不在了。');
      note('kick', { id: seat.id, username: seat.username, ip: seat.ip || '' });
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
    pavilion.saveModeration(input);
    note('deny-save', { count: (pavilion.snapshot().moderation.ipDenyList || []).length });
    return listing();
  }

  function revertModeration() {
    pavilion.revertModeration();
    note('deny-revert', {});
    return listing();
  }

  return { listing, mute, kick, messages, requireSeat, saveModeration, revertModeration };
}

module.exports = { createPeopleController, peopleError, isIpAddress, normalizeIp };
