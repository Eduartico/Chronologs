import test from 'node:test';
import assert from 'node:assert/strict';

import { probeOllama } from './assistant.js';

/** `/api/tags` as Ollama answers it, with each model's capabilities. */
const tags = (models) => async () => ({ ok: true, json: async () => ({ models }) });

test('Ollama not running reads as unreachable, not as ready', async () => {
  const down = async () => {
    throw new Error('fetch failed');
  };
  const r = await probeOllama('http://localhost:11434', 'gemma3:12b', down);
  assert.equal(r.reachable, false);
  assert.match(r.detail, /fetch failed/);
});

test('a model without tools is found and flagged, with the models that have them', async () => {
  const r = await probeOllama(
    'http://x',
    'gemma3:12b',
    tags([
      { name: 'gemma3:12b', capabilities: ['completion', 'vision'] },
      { name: 'qwen3:14b', capabilities: ['completion', 'tools', 'thinking'] },
    ]),
  );
  assert.deepEqual(r, { reachable: true, installed: true, tools: false, toolModels: ['qwen3:14b'] });
});

test('":latest" is the same model, and an old Ollama without capabilities is unknown', async () => {
  const r = await probeOllama('http://x', 'mistral', tags([{ name: 'mistral:latest' }]));
  assert.equal(r.installed, true);
  assert.equal(r.tools, null);
  const missing = await probeOllama('http://x', 'llama3.1:8b', tags([{ name: 'mistral:latest' }]));
  assert.equal(missing.installed, false);
});
