import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { relayErrorHint, validateDeploymentSecrets, verifyRelayConnection, workerBaseUrl } from '../scripts/relay-deploy-check.mjs';

const token = 'test-only-relay-password-with-32-characters';
const url = 'https://pre-gemini-relay.test-account.workers.dev';
const origin = 'https://8ry8.github.io';
const secrets = { CLOUDFLARE_API_TOKEN: 'test-only-cloudflare-token', CLOUDFLARE_ACCOUNT_ID: '1'.repeat(32), GEMINI_API_KEY: 'test-only-google-key', RELAY_ACCESS_TOKEN: token };

test('deployment preflight reports missing secret names, never their values', () => {
  assert.throws(() => validateDeploymentSecrets({ ...secrets, GEMINI_API_KEY: '' }), (error) => {
    assert.match(error.message, /Missing.*GEMINI_API_KEY/);
    for (const value of Object.values(secrets)) assert.equal(error.message.includes(value), false);
    return true;
  });
  assert.doesNotThrow(() => validateDeploymentSecrets(secrets));
  assert.throws(() => validateDeploymentSecrets({ ...secrets, CLOUDFLARE_ACCOUNT_ID: 'not-an-account-id' }), /account ID/);
  for (const invalid of ['', 'short', 'AIza' + 'x'.repeat(35), secrets.GEMINI_API_KEY, 'x'.repeat(257)]) {
    assert.throws(() => validateDeploymentSecrets({ ...secrets, RELAY_ACCESS_TOKEN: invalid }));
  }
});

test('deployment checks never send a password to an arbitrary or credential-bearing URL', () => {
  assert.equal(workerBaseUrl(url + '/'), url);
  for (const invalid of [undefined, '', 'https://evil.test', 'http://test.workers.dev', 'https://test.workers.dev.evil.test', 'https://u:p@test.workers.dev', url + '?token=x', url + '/api/status', url + '#fragment']) {
    assert.throws(() => workerBaseUrl(invalid));
  }
});

test('post-deployment verification checks model access, not text generation', async () => {
  const calls = [];
  const result = await verifyRelayConnection(url, token, origin, async (...args) => {
    calls.push(args);
    return Response.json({ connected: true, provider: 'Google Gemini', model: 'gemini-test' });
  });
  assert.deepEqual(result, { url, model: 'gemini-test' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], url + '/api/status');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].headers.Origin, origin);
  assert.equal(calls[0][1].headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(calls[0][1].body, undefined);
});

test('failed verification does not disclose raw network or provider errors', async () => {
  for (const fetcher of [
    async () => { throw new Error(token); },
    async () => new Response(token),
    async () => Response.json({ error: token }, { status: 502 }),
    async () => Response.json({ connected: true, provider: 'Google Gemini', model: `[${token}](https://evil.test)` }),
  ]) {
    await assert.rejects(verifyRelayConnection(url, token, origin, fetcher), (error) => {
      assert.equal(error.message.includes(token), false);
      assert.match(error.message, /deployment completed/);
      return true;
    });
  }
});

test('failed verification names the relay\'s own setup error so CI logs are actionable', async () => {
  const notFound = 'Gemini model not found. Set GEMINI_MODEL on the Worker to a model available to your key.';
  await assert.rejects(verifyRelayConnection(url, token, origin, async () => Response.json({ error: notFound }, { status: 502 })), (error) => {
    assert.match(error.message, /deployment completed/);
    assert.match(error.message, /HTTP 502/);
    assert.equal(error.message.includes(`Relay reported: ${notFound}`), true);
    return true;
  });
  // A successful status code with a malformed body is never decorated with a hint.
  await assert.rejects(verifyRelayConnection(url, token, origin, async () => Response.json({ error: notFound, connected: false })), (error) => {
    assert.equal(error.message.includes('Relay reported'), false);
    return true;
  });
});

test('every fixed relay error message can be surfaced, but secret-like text never is', async () => {
  const source = await readFile(new URL('../relay/worker.mjs', import.meta.url), 'utf8');
  const messages = [...source.matchAll(/'([A-Z][^'\n]{18,}\.)'/g)].map((match) => match[1]);
  assert.ok(messages.length >= 20, `expected the Worker's user-facing messages, found ${messages.length}`);
  for (const message of messages) assert.equal(relayErrorHint({ error: message }, token), message, message);

  for (const unsafe of [
    token,
    `Access denied for ${token}.`,
    'Key AIza' + 'x'.repeat(35) + ' was rejected.',
    'Gemini rejected the key AIzaShort.',
    'See https://evil.test for help.',
    'See //evil.test for help.',
    'Visit www.evil.test now.',
    '[Fix it](https://evil.test)',
    '<b>Gemini rejected the request.</b>',
    'Token: abcdefghijklmnopqrstuvwxyz0123456789',
    'Line one.\nLine two.',
    'x '.repeat(130),
  ]) {
    assert.equal(relayErrorHint({ error: unsafe }, token), '', unsafe);
  }
  for (const notAMessage of [undefined, null, {}, { error: 502 }, { error: '' }, { error: ['Gemini model not found.'] }]) {
    assert.equal(relayErrorHint(notAMessage, token), '');
  }
});

test('relay configuration uses a valid model ID and disables extra preview URLs', async () => {
  const text = await readFile(new URL('../relay/wrangler.jsonc', import.meta.url), 'utf8');
  const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', text);
  assert.equal(error, undefined);
  // Same rule the Worker enforces before it will contact Google.
  assert.match(config.vars.GEMINI_MODEL, /^gemini-[a-zA-Z0-9._-]{1,100}$/);
  assert.equal(config.vars.ALLOWED_ORIGIN, 'https://8ry8.github.io');
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
});

// Line-based reader for a workflow's `on:` block, so no YAML dependency is
// needed: maps each two-space-indented trigger to its non-comment body lines.
function workflowTriggers(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  assert.notEqual(start, -1, 'the workflow must declare its triggers in an on: block');
  const triggers = {};
  let current;
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#]/.test(line)) break; // the next top-level key ends the block
    const key = line.match(/^  ([A-Za-z_]+):/);
    if (key) triggers[current = key[1]] = [];
    else if (current && line.trim() && !line.trim().startsWith('#')) triggers[current].push(line.trim());
  }
  return triggers;
}

test('relay deploy starts only from explicit dispatches and never reads caller-supplied event data', async () => {
  const relay = await readFile(new URL('../.github/workflows/gemini-relay.yml', import.meta.url), 'utf8');
  const triggers = workflowTriggers(relay);
  // An allowlist, not a denylist: push, pull_request(_target), schedule,
  // workflow_run, and any other automatic trigger must never reach these secrets.
  assert.deepEqual(Object.keys(triggers).sort(), ['repository_dispatch', 'workflow_dispatch']);
  assert.deepEqual(triggers.workflow_dispatch, [], 'Run workflow takes no inputs');
  // Integrations without Actions: write (HTTP 403 on workflow_dispatch) send
  // this single event type; no other repository_dispatch event deploys.
  assert.deepEqual(triggers.repository_dispatch, ['types: [deploy-gemini-relay]']);
  // Whoever dispatches controls the event payload, so no step may interpolate it.
  assert.doesNotMatch(relay, /\$\{\{[^}]*\b(github\.event|inputs)\b/);
  // repository_dispatch always runs on the default branch; still require main.
  assert.match(relay, /if: github\.ref == 'refs\/heads\/main'/);

  assert.deepEqual(workflowTriggers('on:\n  workflow_dispatch:\n  # note\n  push:\n    branches: [main]\n\njobs:\n  x:\n'),
    { workflow_dispatch: [], push: ['branches: [main]'] }, 'the reader must see every trigger');
});

test('relay deploy is manual/main-only and secrets are isolated from Pages builds', async () => {
  const relay = await readFile(new URL('../.github/workflows/gemini-relay.yml', import.meta.url), 'utf8');
  const pages = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(relay, /workflow_dispatch:/);
  assert.match(relay, /if: github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(relay, /^  (push|pull_request|pull_request_target):/m);
  assert.match(relay, /contents: read/);
  assert.match(relay, /workingDirectory: relay/);
  assert.match(relay, /cloudflare\/wrangler-action@[a-f0-9]{40}/);
  assert.match(relay, /relay-deploy-check\.mjs validate/);
  assert.match(relay, /relay-deploy-check\.mjs verify/);
  assert.doesNotMatch(pages, /secrets\.(GEMINI_API_KEY|RELAY_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN)/);
  assert.doesNotMatch(relay, /VITE_.*(KEY|TOKEN)/);
});
