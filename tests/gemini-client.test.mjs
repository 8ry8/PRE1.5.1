import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/ai/gemini.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022' });
const { GeminiRelay, normalizeRelayUrl } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const URL_BASE = 'https://pre-gemini-relay.example.workers.dev';
const TOKEN = 'test-only-relay-password-with-32-characters';
const input = { prompt: 'Edit this draft.', modelClass: 'standard', outputTier: 'tier3', targetModel: 'standard-fast', citations: [] };
const status = { provider: 'Google Gemini', model: 'gemini-test', connected: true };

function mockClient(reply) {
  const calls = [];
  const client = new GeminiRelay(URL_BASE, TOKEN, async (...args) => {
    calls.push(args);
    return typeof reply === 'function' ? reply(...args) : Response.json(reply);
  });
  return { client, calls };
}

test('relay URL requires HTTPS and cannot carry credentials or API paths', () => {
  assert.equal(normalizeRelayUrl(` ${URL_BASE}/ `), URL_BASE);
  for (const url of ['not a URL', '/api', 'http://example.com', 'https://user:pass@example.com', `${URL_BASE}/api/refine`, `${URL_BASE}/?key=secret`, `${URL_BASE}/#secret`, 'https://generativelanguage.googleapis.com']) {
    assert.throws(() => normalizeRelayUrl(url));
  }
});

test('Google keys and weak relay passwords are rejected before any network request', () => {
  for (const password of ['', 'short', 'has spaces '.repeat(5), 'AIza' + 'x'.repeat(35), 'x'.repeat(257)]) {
    assert.throws(() => new GeminiRelay(URL_BASE, password));
  }
});

test('connection testing authenticates without prompt generation or URL credentials', async () => {
  const { client, calls } = mockClient(status);
  assert.deepEqual(await client.testConnection(), status);
  const [url, options] = calls[0];
  assert.equal(url, `${URL_BASE}/api/status`);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(options.body, undefined);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.cache, 'no-store');
  assert.equal(JSON.stringify(client).includes(TOKEN), false, 'private password must not be enumerable');
  assert.equal(calls.length, 1);
});

test('refinement sends only the contract and validates returned metadata', async () => {
  const { client, calls } = mockClient({ ...status, text: 'Revised prompt', inputTokens: 13, outputTokens: 8, requestId: 'test-response', secret: 'ignored' });
  const result = await client.refine(input);
  assert.deepEqual(JSON.parse(calls[0][1].body), input);
  assert.equal(calls[0][0], `${URL_BASE}/api/refine`);
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json');
  assert.deepEqual(result, { provider: 'Google Gemini', model: 'gemini-test', text: 'Revised prompt', inputTokens: 13, outputTokens: 8, requestId: 'test-response' });
});

test('blank and oversized drafts never leave the browser', async () => {
  const { client, calls } = mockClient({});
  await assert.rejects(client.refine({ ...input, prompt: ' ' }), /non-empty draft/);
  await assert.rejects(client.refine({ ...input, prompt: 'x'.repeat(40_001) }), /40,000/);
  assert.equal(calls.length, 0);
});

test('invalid, empty, and wrong-provider replies are not accepted as successful calls', async () => {
  for (const reply of [null, {}, { ...status, connected: false }, { ...status, provider: 'unknown' }, { ...status, model: '' }]) {
    await assert.rejects(mockClient(reply).client.testConnection(), /Unexpected connection response/);
  }
  for (const reply of [null, {}, { ...status, text: ' ' }, { ...status, text: 'x'.repeat(96_001) }, { ...status, text: 'ok', model: null }]) {
    await assert.rejects(mockClient(reply).client.refine(input), /invalid refinement/);
  }
});

test('invalid usage is dropped rather than saved as trustworthy counts', async () => {
  const { client } = mockClient({ ...status, text: 'Prompt', inputTokens: -1, outputTokens: '5', requestId: {} });
  const result = await client.refine(input);
  assert.equal(result.inputTokens, undefined);
  assert.equal(result.outputTokens, undefined);
  assert.equal(result.requestId, undefined);
});

test('network, CORS, non-JSON and HTTP failures are actionable and never retried', async () => {
  for (const [reply, expected] of [
    [() => { throw new Error('private network details'); }, /Could not reach the relay/],
    [() => new Response('<html>not a relay</html>'), /did not return relay JSON/],
    [() => Response.json({ error: 'Access password is incorrect.' }, { status: 401 }), /Access password is incorrect/],
    [() => Response.json({ error: 'Gemini quota reached.' }, { status: 429 }), /quota reached/],
    [() => Response.json({}, { status: 503 }), /failed \(503\)/],
  ]) {
    const { client, calls } = mockClient(reply);
    await assert.rejects(client.testConnection(), expected);
    assert.equal(calls.length, 1);
  }
});

test('a relay cannot echo the password into an error notice', async () => {
  const { client } = mockClient(() => Response.json({ error: `Echo: ${TOKEN}` }, { status: 400 }));
  await assert.rejects(client.testConnection(), (error) => !error.message.includes(TOKEN) && error.message.includes('[redacted]'));
});

test('browser timeout aborts and does not automatically retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, calls } = mockClient((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const pending = client.testConnection();
  t.mock.timers.tick(60_000);
  await assert.rejects(pending, /timed out.*no automatic retry/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].signal.aborted, true);
});

test('browser timeout also covers a stalled response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { client } = mockClient((_url, options) => new Response(new ReadableStream({
    start(controller) { options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); },
  })));
  const pending = client.testConnection();
  await Promise.resolve();
  t.mock.timers.tick(60_000);
  await assert.rejects(pending, /timed out.*no automatic retry/i);
});
