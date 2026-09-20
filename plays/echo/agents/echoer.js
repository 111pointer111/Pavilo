'use strict';

const { createPlayAgent } = require('../../../src/play/agent');

module.exports = createPlayAgent({
  role: 'echoer',
  timeoutMs: 8_000,
  maxTokens: 64,
  system() {
    return 'You are a fixture agent. Reply with JSON only: {"name":"echo","payload":{"text":"pong"}}';
  },
  view(ctx) {
    return ctx.privateView || {};
  },
  schema(ctx) {
    return ctx.legalActions || [{ name: 'echo', payload: { text: 'pong' } }];
  }
});
