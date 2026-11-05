/**
 * The chat assistant's routes, under /api/assistant.
 *
 * Conversations are plain JSON (list, read, create, delete); a turn is a
 * server-sent event stream, because a local model takes ten to forty seconds
 * to answer and the reader should see the tool calls and the first words as
 * they happen rather than a spinner. Each event is one JSON object:
 *
 *   {type:'mode', mode}                   tools | grounded | final
 *   {type:'tool_call', name, arguments}
 *   {type:'tool_result', name, result}
 *   {type:'delta', text} | {type:'delta', thinking}
 *   {type:'done', message, suggestions}
 *   {type:'error', key, detail}
 *
 * Closing the connection aborts the model call — Ollama stops generating, and
 * nothing is appended to the conversation. Neither is anything when the turn
 * fails: the question and its answer are written together or not at all, so
 * the page can offer to retry it. `{from}` in the body replaces the question
 * at that index and everything after it — how editing and retrying work.
 */
import { Router } from 'express';
import { fail, failFrom } from '../lib/httpError.js';
import { loadSettings, currentLocale } from '../lib/settings.js';
import { getProjections } from '../projections/cache.js';
import { pick } from '../engines/prompts/index.js';
import { buildToolContext, runTool, toolDefinitions } from '../engines/assistant/tools.js';
import { runTurn, ollamaChat, followUps, ToolsUnsupported } from '../engines/assistant/agent.js';
import { listChats, getChat, createChat, deleteChat, commitTurn, forkChat, renameChat } from '../engines/assistant/store.js';

const router = Router();

/** Everything a turn is allowed to look back on. Older messages are still on
    disk and on screen; they are just not sent to a model with a small window. */
const HISTORY_LIMIT = 12;
const MAX_QUESTION = 4000;

function llmConfig() {
  const { llm } = loadSettings();
  if (!llm?.enabled) return { error: 'api.error.llmDisabled' };
  if (!llm.model) return { error: 'api.error.llmNoModel' };
  return { llm };
}

async function systemPrompt(ctx, { toolsAvailable }) {
  const dates = ctx.projections.transactions.map((t) => String(t.date || '').slice(0, 10)).filter(Boolean).sort();
  return pick('assistant', currentLocale())({
    today: ctx.today,
    currency: ctx.currency,
    categories: ctx.categories.filter((c) => !c.derived).map((c) => c.id),
    accounts: (ctx.projections.accounts || []).map((a) => `${a.name} (${a.kind})`),
    ledger: { count: ctx.projections.transactions.length, from: dates[0] || null, to: dates[dates.length - 1] || null },
    toolsAvailable,
  });
}

/**
 * Whether a turn would work right now, asked of Ollama itself rather than read
 * from settings: settings said "ready" while Ollama was not even running, and the
 * reader found out by losing their first question. `/api/tags` lists what is
 * installed with each model's capabilities, which is also how the page knows
 * ahead of time that the chosen model cannot call tools.
 */
const PROBE_MS = 2500;
export async function probeOllama(baseUrl, model, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(PROBE_MS) });
    if (!res.ok) return { reachable: false, detail: `HTTP ${res.status}` };
    const { models = [] } = await res.json();
    const bare = (n) => String(n || '').replace(/:latest$/, '');
    const found = models.find((m) => bare(m.name) === bare(model));
    const caps = (m) => (Array.isArray(m?.capabilities) ? m.capabilities : null);
    return {
      reachable: true,
      installed: !!found,
      // null when this Ollama is too old to report capabilities: unknown, not "no".
      tools: found && caps(found) ? caps(found).includes('tools') : null,
      toolModels: models.filter((m) => caps(m)?.includes('tools')).map((m) => m.name),
    };
  } catch (err) {
    return { reachable: false, detail: err?.message || 'unreachable' };
  }
}

router.get('/status', async (req, res) => {
  try {
    const { llm } = loadSettings();
    const configured = !!llm?.enabled && !!llm?.model;
    const connection = configured ? await probeOllama(llm.baseUrl, llm.model) : null;
    res.json({
      configured,
      ready: configured && !!connection?.reachable && connection.installed !== false,
      model: llm?.model || '',
      baseUrl: llm?.baseUrl || '',
      connection,
      tools: toolDefinitions().map((t) => t.function.name),
    });
  } catch (err) {
    failFrom(res, err);
  }
});

/**
 * Questions worth asking right now, computed from the data rather than a
 * fixed list: the category that moved most, the next bill, the goal at risk.
 * Keys and params, so they read in the interface's language.
 */
router.get('/starters', async (req, res) => {
  try {
    const projections = await getProjections();
    const ctx = buildToolContext({ projections, settings: loadSettings() });
    const starters = [{ key: 'assistant.starter.overview' }];
    const overview = runTool('period_overview', {}, ctx);
    const biggest = overview.biggestChanges?.find((c) => c.change > 0);
    if (biggest) starters.push({ key: 'assistant.starter.whyUp', params: { category: biggest.category } });
    const top = overview.topCategories?.[0];
    if (top) starters.push({ key: 'assistant.starter.merchants', params: { category: top.category } });
    const bills = runTool('recurring_bills', { days: 14 }, ctx);
    if (bills.upcoming?.length) starters.push({ key: 'assistant.starter.upcoming' });
    const goals = runTool('budget_goals', {}, ctx);
    const risk = goals.goals?.find((g) => g.status !== 'ok');
    if (risk) starters.push({ key: 'assistant.starter.goal', params: { category: risk.category } });
    starters.push({ key: 'assistant.starter.save' });
    res.json({ starters: starters.slice(0, 5) });
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/chats', (req, res) => {
  try {
    res.json(listChats());
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/chats', (req, res) => {
  try {
    res.json(createChat());
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/chats/:id', (req, res) => {
  try {
    const chat = getChat(req.params.id);
    if (!chat) return fail(res, 404, 'api.error.chatNotFound');
    res.json(chat);
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/chats/:id/fork', (req, res) => {
  try {
    const upTo = Number.isInteger(req.body?.upTo) ? req.body.upTo : undefined;
    const chat = forkChat(req.params.id, upTo);
    if (!chat) return fail(res, 404, 'api.error.chatNotFound');
    res.json(chat);
  } catch (err) {
    failFrom(res, err);
  }
});

router.put('/chats/:id', (req, res) => {
  try {
    const chat = renameChat(req.params.id, req.body?.title);
    if (!chat) return fail(res, 404, 'api.error.chatNotFound');
    res.json(chat);
  } catch (err) {
    failFrom(res, err);
  }
});

router.delete('/chats/:id', (req, res) => {
  try {
    if (!deleteChat(req.params.id)) return fail(res, 404, 'api.error.chatNotFound');
    res.json({ ok: true });
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/chats/:id/messages', async (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return fail(res, 404, 'api.error.chatNotFound');
  const question = String(req.body?.content || '').trim().slice(0, MAX_QUESTION);
  if (!question) return fail(res, 400, 'api.error.chatEmpty');
  const config = llmConfig();
  if (config.error) return fail(res, 400, config.error);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // `res`, not `req`: since Node 16 a request's 'close' fires as soon as its
  // body has been read, which here is before the model is even asked. The
  // response closes when the client goes away — or when we end it ourselves,
  // which `writableFinished` tells apart.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  try {
    const projections = await getProjections();
    const settings = loadSettings();
    const ctx = buildToolContext({ projections, settings });
    const chatFn = ollamaChat({ baseUrl: config.llm.baseUrl, model: config.llm.model });
    // `from` is the index of the question being replaced — an edit, or a
    // retry of the answer after it. Absent, the turn goes on the end.
    const from =
      Number.isInteger(req.body?.from) && req.body.from >= 0 && req.body.from <= chat.messages.length
        ? req.body.from
        : chat.messages.length;
    const history = chat.messages.slice(0, from).slice(-HISTORY_LIMIT);

    const system = await systemPrompt(ctx, { toolsAvailable: true });
    const groundedSystem = await systemPrompt(ctx, { toolsAvailable: false });
    const turn = await runTurn({
      system,
      groundedSystem,
      history,
      question,
      toolContext: ctx,
      chat: chatFn,
      emit: send,
      signal: controller.signal,
    });

    if (controller.signal.aborted) return res.end();
    const saved = commitTurn(chat.id, from, [
      { role: 'user', content: question },
      { role: 'assistant', content: turn.content, steps: turn.steps, mode: turn.mode },
    ]);
    send({ type: 'done', chat: saved, message: saved.messages[saved.messages.length - 1], title: saved.title });

    if (!controller.signal.aborted) {
      const suggestions = await followUps({
        chat: chatFn,
        system,
        question,
        answer: turn.content,
        signal: controller.signal,
      });
      if (suggestions.length) send({ type: 'suggestions', suggestions });
    }
  } catch (err) {
    if (controller.signal.aborted) return res.end();
    send({
      type: 'error',
      key: err instanceof ToolsUnsupported ? 'api.error.llmNoTools' : 'api.error.llmFailed',
      detail: err?.message || 'unknown',
    });
  }
  res.end();
});

export default router;
