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
