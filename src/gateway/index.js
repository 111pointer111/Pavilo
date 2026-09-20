'use strict';

const { completeChat } = require('./client');
const { createGatewayStore } = require('./store');
const { redactSecrets } = require('./secret');
const { operatorConsoleEnabled } = require('../../config');

function fail(code, message) {
  return { ok: false, code, message };
}

function createSemaphore(max) {
  let inFlight = 0;
  const queue = [];
  return {
    async acquire(signal) {
      if (inFlight < max) {
        inFlight += 1;
        return;
      }
      await new Promise((resolve, reject) => {
        const entry = { resolve, reject };
        const onAbort = () => {
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(Object.assign(new Error('Gateway is busy'), { code: 'GATEWAY_BUSY' }));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        queue.push(entry);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      inFlight += 1;
    },
    release() {
      inFlight = Math.max(0, inFlight - 1);
      const next = queue.shift();
      if (next) next.resolve();
    }
  };
}

function createGateway(config, runtime = {}) {
  const store = runtime.store || createGatewayStore(config, runtime);
  const fetchImpl = runtime.fetch || globalThis.fetch;
  const now = runtime.now || Date.now;
  const schedule = runtime.schedule || ((fn, ms) => setTimeout(fn, ms));
  const cancel = runtime.cancel || clearTimeout;
  const semaphore = createSemaphore(config.gateway?.maxInFlight || 4);
  let consecutiveFailures = 0;
  const warnings = [];

  function available() {
    return operatorConsoleEnabled(config);
  }

  function defaultChannelId() {
    return store.listResolved().find((channel) => channel.enabled)?.id || '';
  }

  function status() {
    const channels = store.listResolved();
    return {
      enabled: available(),
      defaultChannel: defaultChannelId(),
      channels: channels.length,
      degraded: consecutiveFailures >= 3,
      usageTracking: store.tracksUsage,
      writable: store.writable && available()
    };
  }

  function healthPatch() {
    if (!available()) return {};
    const snapshot = status();
    return {
      gateway: {
        enabled: true,
        channels: snapshot.channels,
        degraded: snapshot.degraded
      }
    };
  }

  async function complete(request = {}) {
    const timeoutMs = Math.min(
      Number.isFinite(request.timeoutMs) ? request.timeoutMs : (config.gateway?.timeoutMs || 30_000),
      config.gateway?.timeoutMs || 30_000
    );
    const signal = runtime.signalFactory ? runtime.signalFactory(timeoutMs) : AbortSignal.timeout(timeoutMs);
    if (!available()) return fail('GATEWAY_DISABLED', 'Gateway requires sqlite and operator.token');
    const channelId = request.channelId || defaultChannelId();
    if (!channelId) return fail('GATEWAY_NOT_CONFIGURED', 'No gateway channel configured');
    const channel = store.resolve(channelId);
    if (!channel || !channel.enabled) return fail('GATEWAY_NOT_CONFIGURED', `Gateway channel "${channelId}" is not configured`);
    let apiKey = '';
    try {
      apiKey = store.unwrapKey(channel);
    } catch (error) {
      consecutiveFailures += 1;
      store.recordUsage({ channelId, ok: false, code: error.code, at: now() });
      return fail(error.code || 'GATEWAY_KEY_UNWRAP_FAILED', '无法解密渠道密钥');
    }
    if (!apiKey) return fail('GATEWAY_NOT_CONFIGURED', `Gateway channel "${channelId}" has no API key`);
    try {
      await semaphore.acquire(signal);
    } catch (error) {
      return fail(error.code || 'GATEWAY_BUSY', redactSecrets(error.message, [apiKey]));
    }
    try {
      const result = await completeChat({
        baseUrl: request.baseUrl || channel.baseUrl,
        apiKey,
        model: request.model || channel.model,
        messages: request.messages || [],
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        timeoutMs,
        maxRetries: config.gateway?.maxRetries ?? 2
      }, { fetch: fetchImpl, now, schedule, cancel, signal });
      if (result.ok) {
        consecutiveFailures = 0;
        store.recordUsage({
          channelId,
          ok: true,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          at: now()
        });
        return {
          ok: true,
          model: result.model || channel.model,
          text: result.text,
          usage: result.usage,
          latencyMs: result.latencyMs,
          channelId
        };
      }
      consecutiveFailures += 1;
      store.recordUsage({ channelId, ok: false, code: result.code, at: now() });
      return fail(result.code, redactSecrets(result.message, [apiKey]));
    } finally {
      semaphore.release();
    }
  }

  function listChannels() {
    return store.listPublic(config.operator?.token || '');
  }

  return {
    complete,
    probe(channelId) {
      return complete({
        channelId,
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 4
      });
    },
    status,
    healthPatch,
    listChannels,
    upsertChannel(input) {
      return store.upsertChannel(input);
    },
    deleteChannel(id) {
      return store.deleteChannel(id);
    },
    listUsage(days) {
      return store.listUsage(days);
    },
    warnings,
    store,
    close() {
      store.close();
    }
  };
}

module.exports = { createGateway };
