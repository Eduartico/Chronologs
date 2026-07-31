import { loadSettings } from './settings.js';

// Every call is gated on settings.llm.enabled — the app never depends on the
// local LLM being present.

function config() {
  const { llm } = loadSettings();
  return llm || { enabled: false };
}

export function llmEnabled() {
  return !!config().enabled;
}

export async function listModels() {
  const llm = config();
  if (!llm.enabled) throw new Error('LLM integration is disabled in Settings');
  const res = await fetch(`${llm.baseUrl}/api/tags`).catch(() => null);
  if (!res || !res.ok) throw new Error(`Ollama unreachable at ${llm.baseUrl}`);
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

export async function testConnection() {
  const models = await listModels();
  return { ok: true, models };
}

/**
 * Sends a prompt expecting a strict-JSON reply. Returns the parsed JSON or
 * throws — callers must treat failures as "no suggestions", never as fatal.
 */
export async function generateJSON(prompt) {
  const llm = config();
  if (!llm.enabled) throw new Error('LLM integration is disabled in Settings');
  if (!llm.model) throw new Error('No Ollama model selected in Settings');

  const res = await fetch(`${llm.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: llm.model,
      stream: false,
      format: 'json',
      messages: [{ role: 'user', content: prompt }],
    }),
  }).catch(() => null);
  if (!res || !res.ok) throw new Error(`Ollama request failed at ${llm.baseUrl}`);

  const data = await res.json();
  const content = data.message?.content;
  if (!content) throw new Error('Empty LLM response');
  return JSON.parse(content);
}
