import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('shared framework registry has dated sources and unique rule identifiers', async () => {
  const framework = await readJson('shared/framework-rules.json');
  assert.match(framework.version, /^framework-/);
  assert.ok(framework.sources.length >= 4);
  assert.ok(framework.rules.length >= 10);
  assert.equal(new Set(framework.rules.map((rule) => rule.id)).size, framework.rules.length);
  for (const rule of framework.rules) {
    assert.ok(rule.sourceIds.length > 0, `${rule.id} must cite at least one source`);
    assert.match(rule.confidence, /^(high|medium|low)$/);
  }
});

test('shared regression fixture keeps the five source cases', async () => {
  const suite = await readJson('shared/test-cases.json');
  assert.equal(suite.cases.length, 5);
  assert.ok(suite.cases.every((item) => item.id && item.objective && item.expected));
});

test('project schema preserves the portable cross-platform contract', async () => {
  const schema = await readJson('shared/prompt-project.schema.json');
  assert.equal(schema.title, 'Prompt Refining Engine Project');
  assert.deepEqual(schema.properties.variants.items.properties.modelClass.enum, ['standard', 'reasoning', 'agentic']);
  assert.deepEqual(schema.properties.variants.items.properties.outputTier.enum, ['tier1', 'tier2', 'tier3']);
});

test('capability registry accounts for every approved roadmap item', async () => {
  const registry = await readJson('shared/feature-capabilities.json');
  assert.equal(registry.capabilities.length, 11);
  assert.equal(registry.capabilities.filter((item) => item.kind === 'improvement').length, 5);
  assert.equal(registry.capabilities.filter((item) => item.kind === 'feature').length, 6);
  assert.ok(registry.capabilities.every((item) => item.entryPoint));
});

const readText = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('root page shows a boot fallback instead of a blank white page', async () => {
  const html = await readText('index.html');
  // Dark inline boot styling + placeholder paint before any bundle loads,
  // and a watchdog replaces a stuck placeholder with a diagnosable error.
  assert.match(html, /background:\s*#07111f/);
  assert.match(html, /boot-fallback/);
  assert.match(html, /did not load/);
  assert.match(html, /setTimeout/);
});

test('boot renders the shell before touching storage and validates saved projects', async () => {
  const main = await readText('src/main.ts');
  const bootBody = main.slice(main.indexOf('async function boot'));
  assert.ok(bootBody.indexOf('renderShell();') !== -1, 'boot must render the shell');
  assert.ok(
    bootBody.indexOf('renderShell();') < bootBody.indexOf('store.load()'),
    'renderShell must happen before store.load() so storage can never blank the page',
  );
  const store = await readText('src/store.ts');
  assert.match(store, /normalizeProject/);
  assert.match(store, /onblocked/);
  assert.match(store, /DB_OPEN_TIMEOUT_MS/);
});

test('production build defaults to a subpath-safe base and Pages deploy is guarded', async () => {
  const viteConfig = await readText('vite.config.ts');
  assert.match(viteConfig, /'\.\/'/);
  const workflow = await readText('.github/workflows/pages.yml');
  assert.match(workflow, /Verify built site is deployable/);
  assert.match(workflow, /build_type=workflow/);
  assert.match(workflow, /\/src\/main\.ts/);
});
