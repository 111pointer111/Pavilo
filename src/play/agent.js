'use strict';

function extractJson(text) {
  if (typeof text !== 'string') throw new Error('empty model text');
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('model text is not JSON');
  return JSON.parse(trimmed.slice(start, end + 1));
}

function samePayload(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function isLegalAction(action, legalActions) {
  if (!action || typeof action.name !== 'string') return false;
  if (action.name === 'skip') return true;
  if (!Array.isArray(legalActions) || legalActions.length === 0) return false;
  return legalActions.some((entry) => {
    if (!entry || entry.name !== action.name) return false;
    if (!Object.hasOwn(entry, 'payload')) return true;
    return samePayload(entry.payload, action.payload ?? {});
  });
}

function createPlayAgent(spec = {}) {
  if (!spec || typeof spec !== 'object') throw new Error('agent spec must be an object');

  async function runTurn(ctx = {}) {
    const legalActions = typeof spec.schema === 'function' ? spec.schema(ctx) : (ctx.legalActions || []);
    const view = typeof spec.view === 'function' ? spec.view(ctx) : ctx.privateView;
    const system = typeof spec.system === 'function' ? spec.system(ctx) : (spec.system || '');
    const memory = ctx.memory?.read ? ctx.memory.read() : [];
    const fallback = () => {
      if (typeof spec.onInvalid === 'function') return spec.onInvalid(ctx, { code: 'AGENT_INVALID' });
      return { name: 'skip', payload: {} };
    };

    if (typeof ctx.complete !== 'function') return fallback();

    const result = await ctx.complete({
      messages: [
        { role: 'system', content: String(system || '') },
        {
          role: 'user',
          content: JSON.stringify({ view, legalActions, memory })
        }
      ],
      maxTokens: spec.maxTokens || 400,
      timeoutMs: spec.timeoutMs
    });

    if (!result || result.ok !== true) {
      if (typeof spec.onInvalid === 'function') return spec.onInvalid(ctx, result || { code: 'GATEWAY_DISABLED' });
      return { name: 'skip', payload: {} };
    }

    let action;
    try {
      action = typeof spec.parse === 'function' ? spec.parse(result.text, ctx) : extractJson(result.text);
    } catch (error) {
      if (typeof spec.onInvalid === 'function') return spec.onInvalid(ctx, error);
      return { name: 'skip', payload: {} };
    }

    if (!isLegalAction(action, legalActions)) {
      if (typeof spec.onInvalid === 'function') return spec.onInvalid(ctx, { code: 'ILLEGAL_ACTION', action });
      return { name: 'skip', payload: {} };
    }

    try {
      ctx.memory?.append?.({ turn: ctx.turn, action, text: result.text });
    } catch {
      // Memory failure must not crash the host.
    }
    return { name: action.name, payload: action.payload ?? {} };
  }

  return {
    role: spec.role || '',
    timeoutMs: spec.timeoutMs,
    maxTokens: spec.maxTokens,
    runTurn,
    spec
  };
}

module.exports = { createPlayAgent, extractJson, isLegalAction };
