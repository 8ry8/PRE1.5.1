import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../relay/worker.mjs';

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
  assert.match((await result.json()).error, /Gemini is unavailable/);
  assert.equal(calls, 1);
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
  assert.deepEqual(body.generationConfig, { candidateCount: 1, maxOutputTokens: 8192 });
  assert.match(body.systemInstruction.parts[0].text, /not the executor/);
  assert.equal(JSON.parse(body.contents[0].parts[0].text).draft, input.prompt);
  assert.equal(body.tools, undefined);
  assert.equal(options.body.includes(TOKEN), false);
  assert.equal(options.body.includes(KEY), false);
  assert.equal(JSON.stringify(output).includes(KEY), false);
  assert.equal(JSON.stringify(output).includes('private deliberation'), false);
});

test('upstream errors are mapped without forwarding credentials or provider details', async () => {
  for (const [providerStatus, expectedStatus] of [[400, 502], [401, 502], [403, 502], [404, 502], [429, 429], [500, 502]]) {
    const { fetcher, calls } = upstream({ error: `${KEY} ${TOKEN} private document` }, providerStatus);
    const result = await handleRequest(request(), env(), fetcher);
    assert.equal(result.status, expectedStatus);
    const text = await result.text();
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes('private document'), false);
    assert.equal(calls.length, 1);
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

test('provider timeout aborts with no automatic retry', async (t) => {
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
  t.mock.timers.tick(45_000);
  const result = await pending;
  assert.equal(result.status, 504);
  assert.match((await result.json()).error, /timed out.*no automatic retry/i);
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
  t.mock.timers.tick(45_000);
  const result = await pending;
  assert.equal(result.status, 504);
  assert.match((await result.json()).error, /timed out/);
});
