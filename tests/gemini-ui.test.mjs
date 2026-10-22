import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { handleRequest } from '../relay/worker.mjs';

const bundled = await build({
  entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'iife', target: 'es2022',
  loader: { '.css': 'empty' }, external: ['pdfjs-dist/*'],
  plugins: [{ name: 'raw-markdown', setup(build) {
    build.onResolve({ filter: /\.md\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw-markdown' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-markdown' }, async (args) => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
const source = bundled.outputFiles[0].text;
const ORIGIN = 'https://8ry8.github.io';
const RELAY_URL = 'https://pre-gemini-relay.example.workers.dev';
const TOKEN = 'test-only-relay-password-with-32-characters';
const KEY = 'test-only-server-key-not-a-real-google-key';
const WORKSPACE_KEY = 'pre-v1-5-1-project';
const RESPONSE_TEXT = 'Improved prompt. <img src="x" onerror="alert(1)">';
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { await tick(); await tick(); }
async function waitUntil(condition, description) {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await delay(5);
  }
}

async function openApp(t, saved = {}) {
  const dom = new JSDOM('<div id="app"></div>', { url: `${ORIGIN}/PRE1.5.1/`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.AbortController = AbortController;
  window.TextEncoder = TextEncoder;
  Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle });
  for (const [key, value] of Object.entries(saved)) window.localStorage.setItem(key, value);
  const calls = [];
  const upstream = [];
  let generate = async () => Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: RESPONSE_TEXT }] } }],
    modelVersion: 'gemini-test-version', usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10 },
  });
  window.fetch = async (url, options) => {
    calls.push({ url, options });
    return handleRequest(new Request(url, { ...options, headers: { ...options.headers, Origin: ORIGIN } }), {
      GEMINI_API_KEY: KEY, RELAY_ACCESS_TOKEN: TOKEN, ALLOWED_ORIGIN: ORIGIN, GEMINI_MODEL: 'gemini-test',
      GEMINI_LIMITER: { limit: async () => ({ success: true }) },
    }, async (url, options) => {
      upstream.push({ url, options });
      return options.method === 'GET' ? Response.json({ supportedGenerationMethods: ['generateContent'] }) : generate();
    });
  };
  window.eval(source);
  await settle();
  const element = (selector) => {
    const found = window.document.querySelector(selector);
    assert.ok(found, `Missing UI element: ${selector}`);
    return found;
  };
  const click = (selector) => element(selector).click();
  const fill = (selector, value) => {
    const input = element(selector);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const consent = () => {
    element('#gemini-consent').checked = true;
    element('#gemini-consent').dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const snapshot = () => Object.fromEntries(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)]));
  const project = () => JSON.parse(window.localStorage.getItem(WORKSPACE_KEY));
  const connect = async (password = TOKEN) => {
    click('[data-view="connection"]');
    fill('#relay-url', RELAY_URL);
    fill('#relay-password', password);
    element('#relay-password').dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(element('#relay-password').value, password, 'blur must not erase the connection form');
    click('[data-action="connect-gemini"]');
    assert.equal(element('#relay-password').value, '', 'password must be removed from the form before network I/O');
    // The real boundary hashes credentials asynchronously through WebCrypto.
    await waitUntil(() => !element('[data-action="connect-gemini"]').textContent.includes('Checking'), 'connection');
    await settle();
  };
  const localDraft = async () => {
    click('[data-view="workbench"]');
    fill('#raw-goal', 'Write a concise summary of the supplied report.');
    click('[data-action="refine"]');
    await settle();
  };
  const waitForRefinement = async () => {
    await waitUntil(() => !element('[data-action="refine"]').disabled, 'refinement');
    await settle();
  };
  return { window, calls, upstream, element, click, fill, consent, snapshot, project, connect, localDraft, waitForRefinement, setGeneration: (callback) => { generate = callback; } };
}

test('local workbench and empty-input validation need no key or network access', async (t) => {
  const app = await openApp(t);
  assert.equal(app.calls.length, 0);
  assert.match(app.element('[data-view="connection"]').textContent, /Gemini/);
  app.click('[data-action="refine"]');
  await settle();
  assert.match(app.element('#notice').textContent, /Enter a goal/);
  assert.equal(app.project(), null);
  await app.localDraft();
  assert.equal(app.project().variants.length, 1);
  assert.equal(app.project().variants[0].generation, undefined);
  assert.equal(app.calls.length, 0);
  assert.match(app.element('#notice').textContent, /No provider call occurred/);
});

test('connection → consent → live refinement → review → disconnect preserves privacy and provenance', async (t) => {
  const app = await openApp(t);
  app.click('[data-view="connection"]');
  assert.match(app.element('#content').textContent, /GEMINI_API_KEY/);
  assert.match(app.element('#content').textContent, /Variables and Secrets/);
  await app.connect();
  assert.match(app.element('#notice').textContent, /Gemini connected/);
  assert.equal(app.calls.length, 1);
  assert.equal(app.upstream[0].options.method, 'GET');
  assert.equal(app.snapshot()['pre-gemini-relay-url'], RELAY_URL);
  assert.equal(JSON.stringify(app.snapshot()).includes(TOKEN), false);
  assert.equal(app.element('#app').innerHTML.includes(TOKEN), false);

  await app.localDraft();
  const parentId = app.project().variants[0].id;
  assert.equal(app.calls.length, 1, 'connecting must not change the local button into a live call');
  assert.equal(app.element('[data-action="refine-gemini"]').disabled, true);
  app.click('[data-action="refine-gemini"]');
  assert.equal(app.calls.length, 1);

  // Exercise local extraction and consent for an attached text file.
  const file = new app.window.File(['untrusted report text'], 'report.txt', { type: 'text/plain' });
  file.text = async () => 'untrusted report text';
  Object.defineProperty(app.element('#context-file'), 'files', { value: [file] });
  app.element('#context-file').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  await waitUntil(() => app.window.document.querySelector('.context-item'), 'attachment extraction');
  assert.match(app.element('.context-item').textContent, /report.txt/);
  assert.equal(app.calls.length, 1, 'extraction itself is local');

  app.consent();
  app.click('[data-action="refine-gemini"]');
  await app.waitForRefinement();
  assert.equal(app.calls.length, 2);
  const sent = JSON.parse(app.calls[1].options.body);
  assert.match(sent.prompt, /untrusted report text/);
  assert.equal(sent.apiKey, undefined);
  assert.equal(JSON.stringify(sent).includes(TOKEN), false);
  const variants = app.project().variants;
  assert.equal(variants.length, 2);
  assert.equal(variants[1].parentId, parentId);
  assert.equal(variants[1].refinedPrompt, RESPONSE_TEXT);
  assert.equal(variants[1].generation.model, 'gemini-test-version');
  assert.equal(variants[1].generation.inputTokens, 30);
  assert.equal(variants[1].targetModel, 'standard-fast');
  assert.equal(variants[1].changes.at(-1).ruleId, undefined);
  assert.match(variants[1].changes.at(-1).explanation, /unattributed/);
  assert.ok(variants[1].diagnostics.some((item) => item.title === 'AI rewrite needs review'));
  assert.equal(app.element('#gemini-consent').checked, false, 'every new live request requires consent again');
  assert.equal(app.element('.prompt-output').textContent, RESPONSE_TEXT);
  assert.equal(app.window.document.querySelector('.prompt-output img'), null, 'provider text must not become HTML');
  assert.match(app.element('.output-meta').textContent, /Live Gemini/);
  assert.equal(JSON.stringify(app.snapshot()).includes(TOKEN), false);
  assert.equal(JSON.stringify(app.snapshot()).includes(KEY), false);

  app.click('[data-view="review"]');
  assert.match(app.element('#content').textContent, /unattributed change requiring human review/);
  app.click('[data-view="evaluation"]');
  app.click('[data-action="run-evaluation"]');
  await settle();
  assert.equal(app.calls.length, 2, 'evaluation stays local after connecting');
  assert.equal(app.project().variants.at(-1).evaluation.mode, 'local-simulation');
  assert.match(app.project().variants.at(-1).evaluation.notes.join(' '), /does not verify the rewritten text/);
  app.click('[data-action="run-stress"]');
  assert.match(app.element('.finding-list').textContent, /does not verify that Gemini preserved/);
  assert.equal(app.calls.length, 2);

  app.click('[data-view="connection"]');
  app.click('[data-action="disconnect-gemini"]');
  assert.match(app.element('#notice').textContent, /password was cleared/);
  app.click('[data-view="workbench"]');
  assert.equal(app.window.document.querySelector('[data-action="refine-gemini"]'), null);

  const reloaded = await openApp(t, app.snapshot());
  assert.equal(reloaded.calls.length, 0, 'saved URL never auto-connects');
  assert.match(reloaded.element('.output-meta').textContent, /Live Gemini/);
  assert.equal(reloaded.window.document.querySelector('[data-action="refine-gemini"]'), null);
  reloaded.click('[data-view="connection"]');
  assert.equal(reloaded.element('#relay-url').value, RELAY_URL);
  assert.equal(reloaded.element('#relay-password').value, '');
});

test('invalid key/password is explained, cleared, and never saved', async (t) => {
  const app = await openApp(t);
  await app.connect('AIza' + 'x'.repeat(35));
  assert.match(app.element('#notice').textContent, /looks like a Google API key/);
  assert.equal(app.calls.length, 0);
  await app.connect('wrong-relay-password-with-enough-characters');
  assert.match(app.element('#notice').textContent, /Access password is incorrect/);
  assert.equal(app.upstream.length, 0);
  assert.deepEqual(app.snapshot(), {});
  await app.localDraft();
  assert.equal(app.project().variants.length, 1);
});

test('failed live calls preserve prior output and history without silent local fallback', async (t) => {
  const app = await openApp(t);
  await app.connect();
  await app.localDraft();
  const previous = app.project().variants[0];
  app.setGeneration(async () => Response.json({ error: 'private detail' }, { status: 429 }));
  app.consent();
  app.click('[data-action="refine-gemini"]');
  await app.waitForRefinement();
  assert.match(app.element('#notice').textContent, /quota.*previous output is unchanged/i);
  assert.deepEqual(app.project().variants, [previous]);
  assert.equal(app.element('.prompt-output').textContent, previous.refinedPrompt);
  assert.equal(app.calls.length, 2);
  assert.equal(app.element('#gemini-consent').checked, false);
});

test('pending requests prevent duplicate calls and history/project mutations', async (t) => {
  const app = await openApp(t);
  await app.connect();
  await app.localDraft();
  let release;
  app.setGeneration(() => new Promise((resolve) => { release = resolve; }));
  app.consent();
  app.click('[data-action="refine-gemini"]');
  await waitUntil(() => release, 'provider dispatch');
  assert.equal(typeof release, 'function');
  assert.equal(app.element('[data-action="refine-gemini"]').disabled, true);
  app.click('[data-action="refine-gemini"]');
  app.click('[data-action="new-project"]');
  app.click('[data-view="history"]');
  app.click('[data-action="load-variant"]');
  assert.ok(app.window.document.querySelector('.history-list'), 'history load is blocked while refining');
  app.click('[data-view="workbench"]');
  release(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Completed rewrite' }] } }] }));
  await app.waitForRefinement();
  assert.equal(app.calls.length, 2);
  assert.equal(app.project().variants.length, 2);
  assert.equal(app.element('.prompt-output').textContent, 'Completed rewrite');
});

test('typing a draft retains focus and caret when auto-detection rerenders', async (t) => {
  const app = await openApp(t);
  app.element('#raw-goal').focus();
  app.fill('#raw-goal', 'Summarize');
  assert.equal(app.window.document.activeElement.id, 'raw-goal');
  assert.equal(app.element('#raw-goal').selectionStart, 9);
  app.fill('#raw-goal', 'Summarize this');
  assert.equal(app.window.document.activeElement.id, 'raw-goal');
  assert.equal(app.element('#raw-goal').selectionStart, 14);
});

test('blocked browser storage never prevents local mode or API setup from rendering', async (t) => {
  const app = await openApp(t);
  const reloaded = new JSDOM('<div id="app"></div>', { url: `${ORIGIN}/PRE1.5.1/`, runScripts: 'outside-only' });
  t.after(() => reloaded.window.close());
  reloaded.window.fetch = app.window.fetch;
  Object.defineProperty(reloaded.window, 'localStorage', { get() { throw new Error('Blocked'); } });
  reloaded.window.eval(source);
  await settle();
  assert.ok(reloaded.window.document.querySelector('[data-action="refine"]'));
  reloaded.window.document.querySelector('[data-view="connection"]').click();
  assert.ok(reloaded.window.document.querySelector('#relay-password'));
});

test('editing, profile changes, and history loads revoke consent for the old draft', async (t) => {
  const app = await openApp(t);
  await app.connect();
  await app.localDraft();
  app.consent();
  app.fill('#raw-goal', 'A different, private task.');
  assert.equal(app.element('#gemini-consent').checked, false);
  assert.equal(app.element('[data-action="refine-gemini"]').disabled, true);
  app.consent();
  app.element('#tier-select').value = 'tier1';
  app.element('#tier-select').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.element('#gemini-consent').checked, false);
  app.consent();
  app.click('[data-view="history"]');
  app.click('[data-action="load-variant"]');
  assert.equal(app.element('#gemini-consent').checked, false);
  assert.equal(app.calls.length, 1);
});

test('an in-flight file extraction blocks dispatch and requires new sharing consent', async (t) => {
  const app = await openApp(t);
  await app.connect();
  await app.localDraft();
  app.consent();
  let release;
  const file = new app.window.File(['private context'], 'slow.txt', { type: 'text/plain' });
  file.text = () => new Promise((resolve) => { release = resolve; });
  Object.defineProperty(app.element('#context-file'), 'files', { value: [file] });
  app.element('#context-file').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.element('[data-action="refine-gemini"]').disabled, true);
  app.click('[data-action="refine-gemini"]');
  app.click('[data-action="refine"]');
  assert.equal(app.calls.length, 1);
  assert.equal(app.project().variants.length, 1);
  release('private context');
  await waitUntil(() => app.window.document.querySelector('.context-item'), 'attachment extraction');
  assert.equal(app.element('#gemini-consent').checked, false);
  assert.equal(app.element('[data-action="refine-gemini"]').disabled, true);
});
