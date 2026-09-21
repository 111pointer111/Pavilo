'use strict';

const echoer = require('./agents/echoer');
const talker = require('./agents/talker');

function create(runtime) {
  let lastEcho = null;
  let lastShout = '';
  let agentName = '';
  let ticks = 0;

  function privateView(actor) {
    return {
      lastEcho,
      lastShout,
      agentName,
      actor: actor ? { id: actor.id, username: actor.username, kind: actor.kind } : null
    };
  }

  return {
    onJoin(actor) {
      return { ok: true, snapshots: [{ visibility: 'private', actorId: actor.id, state: privateView(actor) }] };
    },
    onLeave() {},
    snapshot(actor) {
      return privateView(actor);
    },
    onAction(actor, { name, payload }) {
      if (name === 'echo') {
        lastEcho = { from: actor.username, payload: payload || {} };
        runtime.save({ lastEcho, lastShout, agentName });
        return {
          ok: true,
          snapshots: [{ visibility: 'private', actorId: actor.id, state: privateView(actor) }]
        };
      }
      if (name === 'shout') {
        const text = String(payload?.text || '').trim();
        if (!text) return { ok: false, code: 'PLAY_ACTION_REJECTED', message: 'empty shout' };
        lastShout = text;
        runtime.save({ lastEcho, lastShout, agentName });
        return {
          ok: true,
          post: { text },
          snapshots: [{ visibility: 'channel', state: { lastShout } }]
        };
      }
      if (name === 'summon') {
        const seated = runtime.seatAgent({ username: 'EchoBot', spec: echoer, role: 'echoer' });
        if (seated.error) return { ok: false, code: seated.error, message: 'cannot seat agent' };
        agentName = seated.actor.username;
        runtime.save({ lastEcho, lastShout, agentName });
        runtime.requestTurn(seated.actor, {
          legalActions: [{ name: 'echo', payload: { text: 'pong' } }]
        });
        return {
          ok: true,
          snapshots: [{ visibility: 'channel', state: { agentName } }]
        };
      }
      if (name === 'boom') throw new Error('echo host exploded');
      // Fixture for host-initiated pushes: a deadline fires and the host has
      // to reach players without an onAction return value to ride on.
      if (name === 'tick') {
        runtime.schedule(() => {
          ticks += 1;
          runtime.emit([
            { visibility: 'channel', state: { ticks } },
            { visibility: 'private', actorId: actor.id, state: { ticks, you: actor.username } }
          ]);
        }, Number(payload?.delayMs) || 0);
        return { ok: true };
      }
      // Fixture for an agent speaking publicly on its own turn.
      if (name === 'say') {
        const text = String(payload?.text || '').trim();
        if (!text) return { ok: false, code: 'PLAY_ACTION_REJECTED', message: 'empty say' };
        lastShout = text;
        return { ok: true, post: { text }, snapshots: [{ visibility: 'channel', state: { lastShout } }] };
      }
      if (name === 'summonTalker') {
        const seated = runtime.seatAgent({ username: 'TalkBot', spec: talker, role: 'talker' });
        if (seated.error) return { ok: false, code: seated.error, message: 'cannot seat agent' };
        agentName = seated.actor.username;
        runtime.requestTurn(seated.actor, { legalActions: [{ name: 'say', payload: { text: 'hello from bot' } }] });
        return { ok: true, snapshots: [{ visibility: 'channel', state: { agentName } }] };
      }
      return { ok: false, code: 'PLAY_ACTION_REJECTED', message: `unknown action ${name}` };
    }
  };
}

module.exports = { id: 'echo', create };
