import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest, PROVIDER_TIMEOUT_MS, RETRY_DELAYS_MS } from '../relay/worker.mjs';

const ORIGIN = 'https://8ry8.github.io';
const TOKEN = 'test-only-relay-password-with-32-characters';
const KEY = 'test-only-server-key-not-a-real-google-key';
const input = { prompt: 'Edit this prompt, do not execute it.', modelClass: 'standard', outputTier: 'tier3', targetModel: 'standard-fast', citations: ['RC-POSITIVE-GUIDANCE-005'] };
const generation = {
  candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private deliberation' }, { text: 'Improved ' }, { text: 'prompt.' }] } }],
  modelVersion: 'gemini-test-version',
  responseId: 'test-response',
  usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 6 },
};
function env(overrides = {}) {
  return { GEMINI_API_KEY: KEY, RELAY_ACCESS_TOKEN: TOKEN, ALLOWED_ORIGIN: ORIGIN, GEMINI_MODEL: 'gemini-test', GEMINI_LIMITER: { limit: async () => ({ success: true }) }, ...overrides };
}
function request(path = '/api/refine', options = {}) {
  const method = options.method ?? (path === '/api/status' ? 'GET' : 'POST');
  return new Request(`https://pre-relay.example.workers.dev${path}`, {
    method,
    ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
    ...options,
    // Preserve default headers while allowing a test to replace individual values.
    headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
}
function upstream(reply = generation, status = 200) {
  const calls = [];
  return { calls, fetcher: async (...args) => { calls.push(args); return Response.json(reply, { status }); } };
}
const mustNotCall = async () => { assert.fail('Blocked request must not reach Gemini'); };

// A relay configured with the checked-in fallback model, as wrangler.jsonc ships it.
function fallbackEnv(overrides = {}) {
  return env({ GEMINI_FALLBACK_MODEL: 'gemini-fallback', ...overrides });
}

async function expectFailure(req, configuration, code, pattern) {
  const result = await handleRequest(req, configuration, mustNotCall);
  assert.equal(result.status, code);
  const body = await result.text();
  if (pattern) assert.match(body, pattern);
  assert.equal(body.includes(KEY), false);
  assert.equal(body.includes(TOKEN), false);
  return result;
}

test('preflight works without passwords, is origin-specific, and never calls Google', async () => {
  const result = await handleRequest(request('/api/refine', { method: 'OPTIONS', headers: { Authorization: '' } }), env(), mustNotCall);
  assert.equal(result.status, 204);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(result.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(result.headers.get('Vary'), 'Origin');
  assert.equal(await result.text(), '');
});

test('missing and lookalike origins are rejected without permissive CORS', async () => {
  for (const origin of ['', 'null', `${ORIGIN}/PRE1.5.1/`, `${ORIGIN}.evil.test`, 'https://evil.test']) {
    const result = await expectFailure(request('/api/status', { headers: { Origin: origin } }), env(), 403);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('relay requires a separate strong password and complete server configuration', async () => {
  for (const configuration of [
    env({ GEMINI_API_KEY: '' }), env({ RELAY_ACCESS_TOKEN: '' }), env({ RELAY_ACCESS_TOKEN: KEY }),
    env({ RELAY_ACCESS_TOKEN: 'AIza' + 'x'.repeat(35) }), env({ GEMINI_MODEL: '' }),
    env({ GEMINI_MODEL: '../../other-host' }), env({ GEMINI_LIMITER: undefined }),
  ]) {
    await expectFailure(request(), configuration, 503, /setup is incomplete/);
  }
  for (const auth of ['', 'Bearer wrong', `Basic ${TOKEN}`, `Bearer ${KEY}`]) {
    await expectFailure(request('/api/status', { headers: { Authorization: auth } }), env(), 401, /Access password/);
  }
});

test('method and endpoint are fixed, not a general-purpose proxy', async () => {
  await expectFailure(request('/arbitrary'), env(), 404);
  await expectFailure(request('/api/refine', { method: 'GET' }), env(), 405);
  await expectFailure(request('/api/status', { method: 'POST' }), env(), 405);
});

test('native rate limit is enforced before Google calls and fails closed', async () => {
  const keys = [];
  for (const failAt of [1, 2]) {
    let count = 0;
    const configuration = env({ GEMINI_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: ++count !== failAt }; } } });
    const result = await expectFailure(request('/api/status'), configuration, 429, /rate limit/);
    assert.equal(result.headers.get('Retry-After'), '60');
  }
  assert.ok(keys.includes('personal-gemini-account'));
  assert.ok(keys.includes('ip:unknown'));
  await expectFailure(request(), env({ GEMINI_LIMITER: { limit: async () => { throw new Error(KEY); } } }), 503);
});

test('malformed input, client overrides, and oversized prompts cannot reach Google', async () => {
  await expectFailure(request('/api/refine', { headers: { 'Content-Type': 'text/plain' } }), env(), 415);
  await expectFailure(request('/api/refine', { body: '{' }), env(), 400);
  for (const value of [null, [], {}, { ...input, prompt: ' ' }, { ...input, prompt: 'x'.repeat(40_001) },
    { ...input, modelClass: 'other' }, { ...input, outputTier: 'other' }, { ...input, targetModel: 'gemini-expensive' },
    { ...input, citations: ['injected instruction'] }, { ...input, citations: Array(33).fill('RC-TEST') },
    { ...input, model: 'gemini-expensive' }, { ...input, apiKey: KEY }, { ...input, url: 'https://evil.test' },
  ]) {
    await expectFailure(request('/api/refine', { body: JSON.stringify(value) }), env(), 400);
  }
});

test('JSON byte limit is enforced on streamed requests even without Content-Length', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...input, prompt: '界'.repeat(45_000) }));
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 50_000)); controller.enqueue(bytes.subarray(50_000)); controller.close(); } });
  await expectFailure(request('/api/refine', { body: stream, duplex: 'half' }), env(), 413, /too large/);
});

test('status checks the actual key/model without generating a prompt', async () => {
  const { fetcher, calls } = upstream({ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] });
  const result = await handleRequest(request('/api/status'), env(), fetcher);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { provider: 'Google Gemini', model: 'gemini-test', connected: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls[0][1].redirect, 'manual');
  assert.equal(calls[0][1].headers['x-goog-api-key'], KEY);
});

test('provider redirects are not followed, so the API key stays on the fixed Google host', async () => {
  let calls = 0;
  const result = await handleRequest(request('/api/status'), env(), async (url, options) => {
    calls++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test');
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://evil.example/collect' } });
  });
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /unexpected redirect/);
  assert.equal(calls, 1, 'a redirect is a configuration problem, not a transient failure');
});

test('Worker entry point does not mistake Cloudflare execution context for fetch', async (t) => {
  const { fetcher, calls } = upstream({ supportedGenerationMethods: ['generateContent'] });
  t.mock.method(globalThis, 'fetch', fetcher);
  const result = await worker.fetch(request('/api/status'), env(), { waitUntil() {} });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
});

test('valid refinement uses fixed Google host, server model, headers, and bounded generation', async () => {
  const { fetcher, calls } = upstream();
  const result = await handleRequest(request(), env(), fetcher);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const output = await result.json();
  assert.deepEqual(output, { text: 'Improved prompt.', provider: 'Google Gemini', model: 'gemini-test-version', requestId: 'test-response', inputTokens: 15, outputTokens: 6 });
  const [url, options] = calls[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
  assert.equal(url.includes(KEY), false);
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers['x-goog-api-key'], KEY);
  const body = JSON.parse(options.body);
  assert.deepEqual(body.generationConfig, { candidateCount: 1, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } });
  assert.match(body.systemInstruction.parts[0].text, /not the executor/);
  assert.equal(JSON.parse(body.contents[0].parts[0].text).draft, input.prompt);
  assert.equal(body.tools, undefined);
  assert.equal(options.body.includes(TOKEN), false);
  assert.equal(options.body.includes(KEY), false);
  assert.equal(JSON.stringify(output).includes(KEY), false);
  assert.equal(JSON.stringify(output).includes('private deliberation'), false);
});

test('upstream errors are mapped without forwarding credentials or provider details', async () => {
  // Configuration, credential, quota, and content errors are reported once: a
  // retry could not succeed and would only spend quota. Only 5xx is transient.
  for (const [providerStatus, expectedStatus, attempts] of [
    [400, 502, 1], [401, 502, 1], [403, 502, 1], [404, 502, 1], [429, 429, 1], [422, 502, 1],
    [500, 502, 1 + RETRY_DELAYS_MS.length], [503, 502, 1 + RETRY_DELAYS_MS.length],
  ]) {
    const { fetcher, calls } = upstream({ error: `${KEY} ${TOKEN} private document` }, providerStatus);
    const result = await handleRequest(request(), env(), fetcher);
    assert.equal(result.status, expectedStatus, `status ${providerStatus}`);
    const text = await result.text();
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes('private document'), false);
    // The upstream status is safe to expose and is what makes the failure
    // actionable; the provider's body never is.
    assert.equal(text.includes(String(providerStatus)), true, `status ${providerStatus} should be reported`);
    assert.equal(calls.length, attempts, `status ${providerStatus} attempt count`);
  }
});

test('safety blocks, partial output, thinking-only and empty responses are never saved as success', async () => {
  for (const reply of [
    { promptFeedback: { blockReason: 'SAFETY' } }, {},
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] },
    { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'blocked' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'not output' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '' }] } }] },
  ]) {
    const result = await handleRequest(request(), env(), upstream(reply).fetcher);
    assert.ok([422, 502].includes(result.status));
    assert.equal((await result.json()).text, undefined);
  }
});

test('network failures and oversized provider replies are bounded and sanitized', async () => {
  let result = await handleRequest(request(), env(), async () => { throw new Error(`Network failure: ${KEY}`); });
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes(KEY), false);
  result = await handleRequest(request(), env(), upstream({ oversized: 'x'.repeat(530_000) }).fetcher);
  assert.equal(result.status, 502);
  result = await handleRequest(request('/api/status'), env(), upstream({ supportedGenerationMethods: ['embedContent'] }).fetcher);
  assert.equal(result.status, 502);
});

test('provider timeout aborts without starting another attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let calls = 0;
  const pending = handleRequest(request(), env(), async (_url, options) => {
    calls++;
    markStarted();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  await started;
  t.mock.timers.tick(180_000);
  const result = await pending;
  assert.equal(result.status, 504);
  assert.match((await result.json()).error, /timed out.*stopped attempting/i);
  assert.equal(calls, 1);
});

test('malformed provider JSON is a gateway failure, not a successful or client-invalid request', async () => {
  const result = await handleRequest(request(), env(), async () => new Response('not-json'));
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /unreadable response/);
});

test('provider timeout also aborts a stalled response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const pending = handleRequest(request(), env(), async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      markStarted();
    },
  })));
  await started;
  t.mock.timers.tick(180_000);
  const result = await pending;
  assert.equal(result.status, 504);
  assert.match((await result.json()).error, /timed out/);
});

test('a provider-side failure falls back once and reports the model that actually answered', async () => {
  const calls = [];
  const result = await handleRequest(request(), fallbackEnv(), async (url, options) => {
    calls.push({ url, options });
    // 404/400/401/403/500 all map to a 502 provider failure worth one retry.
    return url.includes('gemini-test:generateContent')
      ? Response.json({ error: `${KEY} ${TOKEN} private detail` }, { status: 404 })
      : Response.json({ ...generation, modelVersion: 'gemini-fallback-served' });
  });
  assert.equal(result.status, 200);
  const output = await result.json();
  // The saved variant must name the fallback, never the primary that failed.
  assert.equal(output.model, 'gemini-fallback-served');
  assert.equal(output.text, 'Improved prompt.');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
  assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-fallback:generateContent');
  // The retry repeats the same bounded request: same key, same fixed host,
  // same generation config, and no credential or provider detail leaked.
  assert.equal(calls[1].options.headers['x-goog-api-key'], KEY);
  assert.equal(calls[1].options.redirect, 'manual');
  assert.deepEqual(JSON.parse(calls[1].options.body).generationConfig, JSON.parse(calls[0].options.body).generationConfig);
  const text = await Promise.resolve(JSON.stringify(output));
  for (const secret of [KEY, TOKEN, 'private detail']) assert.equal(text.includes(secret), false);
});

test('quota, safety, and client failures never trigger the fallback model', async () => {
  for (const [providerStatus, reply, expected] of [
    // 429: the account is out of quota, so a second model fails too and would
    // only burn the shared time budget.
    [429, { error: 'quota' }, 429],
    // A safety block or truncated generation is a 422 about the content, not a
    // provider outage; re-asking another model would be a duplicate charge.
    [200, { promptFeedback: { blockReason: 'SAFETY' } }, 422],
    [200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] }, 422],
    [200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'x' }] } }] }, 502],
  ]) {
    const calls = [];
    const result = await handleRequest(request(), fallbackEnv(), async (...args) => {
      calls.push(args);
      return Response.json(reply, { status: providerStatus });
    });
    assert.equal(result.status, expected, `status ${providerStatus}`);
    assert.equal(calls.length, 1, `status ${providerStatus} must not reach the fallback model`);
    assert.equal(calls[0][0].includes('gemini-fallback'), false);
  }
  // Requests rejected before any upstream call still never reach Google at all.
  await expectFailure(request('/api/refine', { body: JSON.stringify({ ...input, modelClass: 'other' }) }), fallbackEnv(), 400);
});

test('the fallback model is rate-limited as a second upstream call', async () => {
  let accountChecks = 0;
  const calls = [];
  const configuration = fallbackEnv({
    GEMINI_LIMITER: {
      limit: async ({ key }) => {
        if (key !== 'personal-gemini-account') return { success: true };
        // First unit authorizes the primary; the second is refused, so the
        // fallback must not be attempted and the primary error is reported.
        return { success: ++accountChecks < 2 };
      },
    },
  });
  const result = await handleRequest(request(), configuration, async (...args) => {
    calls.push(args[0]);
    return Response.json({ error: 'unavailable' }, { status: 500 });
  });
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /Gemini is unavailable/);
  // The primary's own transient retries do not consume account units; only the
  // switch to the fallback model does, and that unit was refused.
  assert.equal(calls.length, 1 + RETRY_DELAYS_MS.length, 'a refused rate-limit unit must not start the fallback');
  assert.ok(calls.every((url) => url.includes('gemini-test:generateContent')));
  assert.equal(accountChecks, 2, 'the fallback must consume its own account rate-limit unit');
});

test('an invalid or duplicate fallback model fails closed instead of reaching Google', async () => {
  for (const fallback of ['gemini-test', '../../other-host', 'gpt-expensive', 'AIza' + 'x'.repeat(35), 'x'.repeat(120), 42]) {
    await expectFailure(request(), fallbackEnv({ GEMINI_FALLBACK_MODEL: fallback }), 503, /setup is incomplete/);
  }
  // Unset and empty both mean "single model, no fallback" and must still work.
  for (const configuration of [env(), fallbackEnv({ GEMINI_FALLBACK_MODEL: '' })]) {
    const { fetcher, calls } = upstream();
    const result = await handleRequest(request(), configuration, fetcher);
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
  }
});

test('the status check never falls back, so a broken primary model stays visible', async () => {
  const calls = [];
  const result = await handleRequest(request('/api/status'), fallbackEnv(), async (...args) => {
    calls.push(args[0]);
    return Response.json({ error: 'no such model' }, { status: 404 });
  });
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /model not found/);
  assert.equal(calls.length, 1, '/api/status must report on the configured primary model only');
  assert.equal(calls[0].includes('gemini-fallback'), false);
});

// Drives the shared request budget through the injected clock. Mock timers are
// not usable for this case: tick() inside a fetcher fires the deadline abort
// before the primary's response body has been read.
function fakeClock(start = 1_000_000) {
  const state = { current: start };
  return { start, now: () => state.current, advance: (ms) => { state.current += ms; } };
}

test('both models share one server deadline, so a fallback cannot double the wait', async (t) => {
  // Mock timers keep the test instant; the injected clock still decides how much
  // budget the fallback is given, which is the behavior under test.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = fakeClock();
  const calls = [];
  let markFallback;
  const fallbackStarted = new Promise((resolve) => { markFallback = resolve; });
  const pending = handleRequest(request(), fallbackEnv(), async (url, options) => {
    calls.push(url);
    if (url.includes('gemini-test:generateContent')) {
      // The primary burns most of the budget, then fails with a retryable 502.
      clock.advance(170_000);
      return Response.json({ error: 'unavailable' }, { status: 500 });
    }
    // The fallback then hangs; only the shared deadline can end it.
    markFallback();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }, clock.now);
  // Awaiting the fetcher's own signal guarantees the fallback's deadline timer
  // is already armed when the clock moves, so the tick below is decisive.
  await fallbackStarted;
  // The fallback's timer was armed for the 10s remainder, so advancing 10s ends
  // the whole request. Had it restarted its own 180s budget this tick would not
  // fire and the request would still be pending.
  t.mock.timers.tick(10_000);
  const result = await pending;
  assert.equal(result.status, 504);
  assert.match((await result.json()).error, /timed out/);
  assert.equal(calls.length, 2, 'the fallback did start, with only the leftover budget');
  assert.ok(calls[1].includes('gemini-fallback:generateContent'));
  // No further attempt exists at the 360s mark a per-attempt budget would allow.
  t.mock.timers.tick(360_000);
  assert.equal(calls.length, 2);
});

test('an exhausted budget never starts the fallback, so the primary error is reported', async () => {
  const clock = fakeClock();
  const calls = [];
  const result = await handleRequest(request(), fallbackEnv(), async (url) => {
    calls.push(url);
    clock.advance(PROVIDER_TIMEOUT_MS);
    return Response.json({ error: 'unavailable' }, { status: 500 });
  }, clock.now);
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /Gemini is unavailable/);
  assert.equal(calls.length, 1, 'no budget left means no second attempt');
});

test('a transient provider failure is retried automatically, so the edit still succeeds', async () => {
  const calls = [];
  let attempt = 0;
  const result = await handleRequest(request(), env(), async (url, options) => {
    calls.push({ url, options });
    // First call fails with a transient provider 5xx, the retry succeeds.
    return ++attempt === 1
      ? Response.json({ error: 'backend overloaded' }, { status: 503 })
      : Response.json(generation);
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).text, 'Improved prompt.');
  assert.equal(calls.length, 2);
  // The retry repeats the identical bounded request: same fixed host, same
  // server-side model, same generation config, no client-supplied overrides.
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.equal(calls[1].options.headers['x-goog-api-key'], KEY);
  assert.equal(calls[1].options.body, calls[0].options.body);
});

test('a transient network failure is also retried instead of failing the edit', async () => {
  let attempt = 0;
  const result = await handleRequest(request(), env(), async () => {
    if (++attempt === 1) throw new Error(`connection reset ${KEY}`);
    return Response.json(generation);
  });
  assert.equal(result.status, 200);
  assert.equal(attempt, 2);
  assert.equal(JSON.stringify(await result.json()).includes(KEY), false);
});

test('transient retries are bounded, do not consume account units, and say what happened', async () => {
  let accountChecks = 0;
  const calls = [];
  const configuration = env({
    GEMINI_LIMITER: { limit: async ({ key }) => { if (key === 'personal-gemini-account') accountChecks++; return { success: true }; } },
  });
  const result = await handleRequest(request(), configuration, async (url) => {
    calls.push(url);
    return Response.json({ error: 'unavailable' }, { status: 500 });
  });
  assert.equal(result.status, 502);
  const message = (await result.json()).error;
  assert.match(message, /Gemini is unavailable/);
  assert.match(message, new RegExp(`tried ${1 + RETRY_DELAYS_MS.length} times`));
  assert.match(message, /HTTP 500/);
  assert.equal(calls.length, 1 + RETRY_DELAYS_MS.length, 'retries stay at the fixed bound');
  // One unit for the request's first call; retries of a failed 5xx call are not
  // charged, so a brief outage cannot exhaust the owner's per-minute allowance.
  assert.equal(accountChecks, 1);
  assert.equal(message.includes(KEY), false);
  assert.equal(message.includes(TOKEN), false);
});

test('a provider outage across both models is still bounded by attempts', async () => {
  const calls = [];
  let accountChecks = 0;
  const configuration = fallbackEnv({
    GEMINI_LIMITER: { limit: async ({ key }) => { if (key === 'personal-gemini-account') accountChecks++; return { success: true }; } },
  });
  const result = await handleRequest(request(), configuration, async (url) => {
    calls.push(url);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  });
  assert.equal(result.status, 502);
  const perModel = 1 + RETRY_DELAYS_MS.length;
  assert.equal(calls.length, perModel * 2, 'at most the fixed bound per model, never an open loop');
  assert.equal(calls.filter((url) => url.includes('gemini-test:generateContent')).length, perModel);
  assert.equal(calls.filter((url) => url.includes('gemini-fallback:generateContent')).length, perModel);
  assert.match((await result.json()).error, /Gemini is unavailable.*HTTP 503/);
  // Only the fallback switch spends a second account unit, even with retries.
  assert.equal(accountChecks, 2);
});

test('a failure that is not transient is reported at once and never retried', async () => {
  // 429 quota, 400 credential/config rejection, 404 model missing, 302 redirect,
  // an oversized reply, and a content/safety stop can all only repeat.
  const cases = [
    [429, { error: 'quota' }, 429],
    [400, { error: 'bad request' }, 502],
    [401, { error: 'bad key' }, 502],
    [403, { error: 'forbidden' }, 502],
    [404, { error: 'no model' }, 502],
    [302, { error: 'redirect' }, 502],
    [418, { error: 'teapot' }, 502],
  ];
  for (const [providerStatus, reply, expected] of cases) {
    let calls = 0;
    const result = await handleRequest(request(), env(), async () => { calls++; return Response.json(reply, { status: providerStatus }); });
    assert.equal(result.status, expected, `status ${providerStatus}`);
    assert.equal(calls, 1, `status ${providerStatus} must not be retried`);
  }
  let oversized = 0;
  const big = await handleRequest(request(), env(), async () => { oversized++; return Response.json({ oversized: 'x'.repeat(530_000) }); });
  assert.equal(big.status, 502);
  assert.equal(oversized, 1, 'an oversized reply would repeat identically');
});
