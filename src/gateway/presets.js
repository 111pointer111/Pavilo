'use strict';

const GATEWAY_PRESET_IDS = Object.freeze(['deepseek', 'openai-compatible']);

const GATEWAY_PRESETS = Object.freeze({
  deepseek: Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: Object.freeze(['deepseek-chat', 'deepseek-reasoner'])
  }),
  'openai-compatible': Object.freeze({
    id: 'openai-compatible',
    label: 'OpenAI compatible',
    baseUrl: null,
    defaultModel: null,
    models: Object.freeze([])
  })
});

module.exports = { GATEWAY_PRESET_IDS, GATEWAY_PRESETS };
