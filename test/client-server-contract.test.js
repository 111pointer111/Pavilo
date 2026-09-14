'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DEFAULTS } = require('../config');
const { createChatCore } = require('../src/core');
const { parseServerEvent, PROTOCOL_VERSION } = require('../client/protocol');
const { reduce, createInitialState } = require('../client/state');

// Validate real domain output, not a second hand-written copy of the protocol.
// In particular, public avatar seeds are numbers, including zero and uint32 max.
for (const version of [1, 2, PROTOCOL_VERSION]) {
  test(`client parser accepts actual v${version} core events and snapshots`, () => {
    const core = createChatCore({ ...DEFAULTS, maxMessages: 2 }, {
      schedule: () => Symbol('timer'), cancel() {}, now: () => 1_700_000_000_000
    });
    const seen = new Set();
    function check(effects) {
      for (const effect of effects) {
        for (const payload of effect.payloads || (effect.payload ? [effect.payload] : [])) {
          assert.deepEqual(parseServerEvent(JSON.stringify(payload)), payload, payload.type);
          seen.add(payload.type);
        }
      }
      return effects;
    }
    function dispatch(peer, command) { return check(core.dispatch(peer, command).effects); }
    function join(peer, avatarSeed) {
      core.connect(peer, '127.0.0.1');
      const effects = dispatch(peer, { type: 'join', protocolVersion: version,
        clientSessionId: `session-${peer}`, username: peer, avatarSeed });
      let state = createInitialState();
      for (const payload of effects.find((effect) => effect.kind === 'initial').payloads) state = reduce(state, payload);
      assert.equal(state.self.avatarSeed, avatarSeed);
      assert.equal(state.connection.joined, true);
      core.completeSync(peer);
      return state;
    }
    join('alice', 0);
    join('bob', 0xffffffff);
    const first = dispatch('alice', { type: 'message', kind: 'text', clientMessageId: 'message-0001', text: 'one' });
    const messageId = first.find((effect) => effect.payload?.type === 'ack').payload.messageId;
    dispatch('bob', { type: 'message', kind: 'text', clientMessageId: 'message-0002', text: 'reply', replyTo: messageId });
    dispatch('bob', { type: 'reaction', messageId, emoji: '👍', active: true });
    dispatch('alice', { type: 'typing', active: true });
    dispatch('alice', { type: 'message', kind: 'text', clientMessageId: 'message-0003', text: 'evicts one' });
    dispatch('alice', { type: 'message', kind: 'text', clientMessageId: 'bad', text: 'invalid correlation' });
    check(core.disconnect('alice'));
    const resumed = join('alice', 0);
    assert.deepEqual(resumed.messages.map((message) => message.text), ['reply', 'evicts one']);
    assert.equal(resumed.messages[0].replyTo.id, messageId);
    for (const type of ['presence', 'message', 'reaction', 'typing', 'ack', 'error']) assert.ok(seen.has(type), type);
    if (version >= 2) for (const type of ['stateStart', 'history', 'historyEnd']) assert.ok(seen.has(type), type);
    else assert.ok(seen.has('state'));
    core.shutdown();
  });
}
