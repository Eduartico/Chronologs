/**
 * The agent loop.
 *
 * This is the shape every hosted assistant runs: a system prompt that says
 * what the model is and what it may do, a tool catalogue, and a loop — the model
 * answers, and if the answer is a request for a tool, the tool runs, its result
 * is appended as a `tool` message, and the model is asked again. It stops when
 * the model answers in prose, or after `MAX_ROUNDS` so a model that keeps
 * asking for the same figure cannot spin forever.
 *
 * Everything the model says is streamed as it is generated, including the tool
 * calls, so the screen can show "looking at your recurring bills…" while the
 * figures are fetched rather than a spinner for fifteen seconds.
 *
 * `chat` — the one function that talks to Ollama — is injected, so the whole
 * loop is tested against a scripted model in `agent.test.js`. Nothing in this
 * file knows a URL.
 *
 * Models that cannot call tools (Ollama answers 400 to the `tools` field for
 * them) fall back to **grounded mode**: the three summaries a reader most often
 * asks about are fetched up front and pasted into the system prompt, and the
 * model answers from those. Less precise, never blind.
 */
import { toolDefinitions, runTool } from './tools.js';

export const MAX_ROUNDS = 6;
/** A local model's default window is 2–4K tokens, which the tool schemas alone
    would fill. Asked for explicitly so the catalogue and two tool results fit. */
export const CONTEXT_WINDOW = 16384;
export const TEMPERATURE = 0.2;

const NO_TOOLS = /does not support tools|tools? (?:are|is) not supported/i;

export class ToolsUnsupported extends Error {}

/**
 * Which tool calls came back, from either of Ollama's two shapes.
 *
 * A streaming reply delivers `tool_calls` on whichever chunk the model emitted
 * them in; a non-streaming one delivers them once on the final message. Both
 * land here. `arguments` is an object in Ollama's native format and a string in
 * the OpenAI-compatible one — `runTool` accepts either.
 */
function callsOf(message) {
  return (message?.tool_calls || []).map((c, i) => ({
    id: c.id || `call_${i}`,
    name: c.function?.name,
    arguments: c.function?.arguments ?? {},
  }));
}

/** Tool results trimmed to what the window can hold. Compact to begin with, but
    forty search rows with descriptions is still a page. */
const MAX_RESULT_CHARS = 6000;
function serialise(result) {
  const text = JSON.stringify(result);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}…(truncated; ask for fewer rows or a narrower range)`;
}

/**
 * Run one user turn.
 *
 * @param {object} p
 * @param {string} p.system      The system prompt.
 * @param {Array}  p.history     Prior `{role, content}` messages, oldest first.
 * @param {string} p.question    The new user message.
 * @param {object} p.toolContext From `buildToolContext`.
 * @param {Function} p.chat      `({messages, tools, onDelta, signal}) => Promise<message>`.
 *                               Throws `ToolsUnsupported` when the model has no tools.
 * @param {Function} p.emit      Receives each event as it happens.
 * @param {AbortSignal} [p.signal]
 * @returns {{content, steps, mode}}
 */
export async function runTurn({ system, history, question, toolContext, chat, emit = () => {}, signal }) {
  const tools = toolDefinitions();
  let messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];
  const steps = [];
  let mode = 'tools';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let reply;
    try {
      reply = await chat({
        messages,
        tools: mode === 'tools' ? tools : undefined,
        signal,
        onDelta: (delta) => emit({ type: 'delta', ...delta }),
      });
    } catch (err) {
      if (err instanceof ToolsUnsupported && mode === 'tools') {
        mode = 'grounded';
        emit({ type: 'mode', mode });
        messages = [
          { role: 'system', content: `${system}\n\n${groundingContext(toolContext)}` },
          ...messages.slice(1),
        ];
        round -= 1;
        continue;
      }
      throw err;
    }

    const calls = callsOf(reply);
    if (!calls.length) {
      return { content: reply?.content || '', steps, mode };
    }

    // The assistant's own request goes back into the transcript ahead of the
    // results, which is how the model knows which answer belongs to which ask.
    messages.push({ role: 'assistant', content: reply.content || '', tool_calls: reply.tool_calls });
    for (const call of calls) {
      emit({ type: 'tool_call', name: call.name, arguments: call.arguments });
      const result = runTool(call.name, call.arguments, toolContext);
      steps.push({ name: call.name, arguments: call.arguments, result });
      emit({ type: 'tool_result', name: call.name, result });
      messages.push({ role: 'tool', tool_name: call.name, content: serialise(result) });
    }
  }

  // Out of rounds. Ask once more with the tools withheld so the model has to
  // write from what it already has, rather than returning nothing.
  emit({ type: 'mode', mode: 'final' });
  const reply = await chat({
    messages: [
      ...messages,
      { role: 'user', content: 'Answer now from the figures you already have. Do not request more tools.' },
    ],
    signal,
    onDelta: (delta) => emit({ type: 'delta', ...delta }),
  });
  return { content: reply?.content || '', steps, mode };
}

/** What a model without tool support gets instead: the overview, the bills and
    the goals, run with their defaults. */
export function groundingContext(toolContext) {
  const blocks = ['period_overview', 'recurring_bills', 'budget_goals'].map(
    (name) => `### ${name}\n${serialise(runTool(name, {}, toolContext))}`,
  );
  return `DATA (this model cannot call tools, so the three most useful summaries are included here; answer from them and say when something is not covered):\n\n${blocks.join('\n\n')}`;
}

/**
 * Ollama's chat endpoint, streaming.
 *
 * NDJSON, one object per line. Text arrives in `message.content`, reasoning
 * (for models that expose it) in `message.thinking`, and tool calls in
 * `message.tool_calls`. The final line has `done: true`. The accumulated
 * message is returned so the loop can read it whole.
 */
export function ollamaChat({ baseUrl, model, contextWindow = CONTEXT_WINDOW }) {
  return async ({ messages, tools, format, onDelta, signal }) => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        stream: true,
        messages,
        ...(tools ? { tools } : {}),
        ...(format ? { format } : {}),
        options: { temperature: TEMPERATURE, num_ctx: contextWindow },
      }),
    }).catch((err) => {
      if (err?.name === 'AbortError') throw err;
      throw new Error(`Ollama unreachable at ${baseUrl}`);
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 400 && NO_TOOLS.test(text) && tools) throw new ToolsUnsupported(text);
      throw new Error(`Ollama request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const message = { role: 'assistant', content: '', thinking: '', tool_calls: [] };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const take = (line) => {
      if (!line.trim()) return;
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        return;
      }
      if (chunk.error) throw new Error(chunk.error);
      const m = chunk.message || {};
      if (m.content) {
        message.content += m.content;
        onDelta?.({ text: m.content });
      }
      if (m.thinking) {
        message.thinking += m.thinking;
        onDelta?.({ thinking: m.thinking });
      }
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) message.tool_calls.push(...m.tool_calls);
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        take(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    take(buffer);
    if (!message.tool_calls.length) delete message.tool_calls;
    return message;
  };
}

/**
 * Three questions the reader might ask next, as a cheap second call with the
 * answer in context. JSON-formatted so a model that pads its answer with prose
 * cannot break the parse; any failure is simply no suggestions.
 */
export async function followUps({ chat, system, question, answer, signal }) {
  try {
    const reply = await chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question },
        { role: 'assistant', content: answer },
        {
          role: 'user',
          content:
            'Suggest three short follow-up questions I might ask next about my finances, in the same language as the conversation, each under 60 characters. Answer with JSON only: {"questions": ["...", "...", "..."]}',
        },
      ],
      format: 'json',
      signal,
    });
    const parsed = JSON.parse(reply?.content || '{}');
    const list = Array.isArray(parsed) ? parsed : parsed?.questions;
    return (Array.isArray(list) ? list : [])
      .filter((q) => typeof q === 'string' && q.trim())
      .map((q) => q.trim())
      .slice(0, 3);
  } catch {
    return [];
  }
}
