'use strict';

const { createPlayAgent } = require('../../../src/play/agent');

// 夹具：会公开发言的 Agent。验证 host 返回的 post 能走到频道消息。
module.exports = createPlayAgent({
  role: 'talker',
  timeoutMs: 8_000,
  maxTokens: 64,
  system() {
    return 'You are a fixture agent. Reply with JSON only: {"name":"say","payload":{"text":"hello from bot"}}';
  },
  view(ctx) {
    return ctx.privateView || {};
  },
  schema(ctx) {
    return ctx.legalActions || [{ name: 'say', payload: { text: 'hello from bot' } }];
  }
});
