'use strict';

const { redactSecrets } = require('./secret');

function resultError(code, message, extra = {}) {
  return { ok: false, code, message, retryable: false, ...extra };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function sleep(ms, signal, schedule, cancel) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cancel(timer);
      reject(Object.assign(new Error('Gateway request timed out'), { code: 'GATEWAY_TIMEOUT' }));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    const timer = schedule(resolve, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseUpstream(payload) {
  const choice = payload?.choices?.[0]?.message;
  const text = typeof choice?.content === 'string' ? choice.content : '';
  const usage = payload?.usage && typeof payload.usage === 'object' ? payload.usage : {};
  return {
    ok: true,
    model: typeof payload?.model === 'string' ? payload.model : '',
    text,
    usage: {
      promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0,
      completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : 0
    }
  };
}

function statusCode(status) {
  if (status === 401 || status === 403) return { code: 'GATEWAY_AUTH', retryable: false };
  if (status === 400 || status === 404) return { code: 'GATEWAY_BAD_REQUEST', retryable: false };
  if (status === 429 || status === 502 || status === 503) return { code: 'GATEWAY_UPSTREAM', retryable: true };
  return { code: 'GATEWAY_UPSTREAM', retryable: false };
}

async function once({ fetchImpl, url, apiKey, body, signal }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body,
      signal
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'GATEWAY_TIMEOUT') {
      return resultError('GATEWAY_TIMEOUT', 'Gateway request timed out');
    }
    return resultError('GATEWAY_UNAVAILABLE', redactSecrets(error.message || 'Gateway request failed', [apiKey]), { retryable: true });
  }
  let payload = null;
  let raw = '';
  try {
    raw = await response.text();
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  const safe = redactSecrets(typeof payload?.error?.message === 'string' ? payload.error.message : (raw || response.statusText || 'upstream error'), [apiKey]);
  if (!response.ok) {
    const mapped = statusCode(response.status);
    return resultError(mapped.code, safe, { retryable: mapped.retryable, status: response.status });
  }
  if (!payload || typeof payload !== 'object') return resultError('GATEWAY_UPSTREAM', 'Upstream returned a non-JSON body');
  return parseUpstream(payload);
}

async function completeChat(request, runtime = {}) {
  const fetchImpl = runtime.fetch || globalThis.fetch;
  const now = runtime.now || Date.now;
  const schedule = runtime.schedule || ((fn, ms) => setTimeout(fn, ms));
  const cancel = runtime.cancel || clearTimeout;
  const timeoutMs = request.timeoutMs;
  const maxRetries = request.maxRetries;
  const url = `${normalizeBaseUrl(request.baseUrl)}/chat/completions`;
  const body = JSON.stringify({
    model: request.model,
    messages: request.messages,
    stream: false,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {})
  });
  const signal = runtime.signal || AbortSignal.timeout(timeoutMs);
  const started = now();
  let last = resultError('GATEWAY_UPSTREAM', 'Gateway request failed');
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal.aborted) return resultError('GATEWAY_TIMEOUT', 'Gateway request timed out');
    if (attempt > 0) {
      const delay = attempt === 1 ? 200 : 800;
      try {
        await sleep(delay, signal, schedule, cancel);
      } catch (error) {
        return resultError(error.code || 'GATEWAY_TIMEOUT', error.message);
      }
    }
    last = await once({ fetchImpl, url, apiKey: request.apiKey, body, signal });
    last.latencyMs = Math.max(0, now() - started);
    if (last.ok || !last.retryable) return last;
  }
  last.retryable = false;
  return last;
}

module.exports = { completeChat, normalizeBaseUrl };
