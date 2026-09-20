'use strict';

const echoer = require('./agents/echoer');

function create(runtime) {
  let lastEcho = null;
  let lastShout = '';
  let agentName = '';

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
      return { ok: false, code: 'PLAY_ACTION_REJECTED', message: `unknown action ${name}` };
    }
  };
}

module.exports = { id: 'echo', create };
