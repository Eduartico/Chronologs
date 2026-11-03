import test from 'node:test';
import assert from 'node:assert/strict';

import { runTurn, followUps, ToolsUnsupported, MAX_ROUNDS } from './agent.js';

/**
 * The loop against a scripted model.
 *
 * The real `chat` talks to Ollama; this one answers from a queue, which is
 * enough to hold the things the loop promises: a tool request runs the tool
 * and goes back as a `tool` message, the final prose ends the turn, a model
 * that never stops asking is cut off, and a model with no tool support is
 * given the data another way.
 */
function scripted(replies, log = []) {
  return async ({ messages, tools, onDelta }) => {
    log.push({ messages, tools });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    if (next.content) onDelta?.({ text: next.content });
    return next;
  };
}

const toolContext = {};
let ran = [];
// The tool layer is replaced so this file tests the loop, not the ledger.
const { runTool } = await import('./tools.js');
const original = runTool;
void original;

test('a tool request is executed and fed back before the prose answer', async () => {
  const events = [];
  const log = [];
  const chat = scripted(
    [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'nonexistent_tool', arguments: { month: '2026-02' } } }],
      },
      { role: 'assistant', content: 'You spent €900.' },
    ],
    log,
  );
  const turn = await runTurn({
    system: 'sys',
    history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    question: 'how much?',
    toolContext,
    chat,
    emit: (e) => events.push(e),
  });
  assert.equal(turn.content, 'You spent €900.');
  assert.equal(turn.mode, 'tools');
  assert.equal(turn.steps.length, 1);
  assert.equal(turn.steps[0].name, 'nonexistent_tool');
  // An unknown tool is an error *result*, which the model sees and can recover from.
  assert.match(turn.steps[0].result.error, /Unknown tool/);

  assert.deepEqual(
    events.map((e) => e.type),
    ['tool_call', 'tool_result', 'delta'],
  );

  // Second call carries system, history, question, the assistant's request and the tool result, in that order.
  const roles = log[1].messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user', 'assistant', 'tool']);
  assert.equal(log[1].messages[5].tool_name, 'nonexistent_tool');
  assert.ok(log[0].tools.length > 5, 'the catalogue is offered');
});

test('a model that keeps asking is cut off and made to answer', async () => {
  const ask = { role: 'assistant', content: '', tool_calls: [{ function: { name: 'x', arguments: {} } }] };
  const replies = Array.from({ length: MAX_ROUNDS }, () => ({ ...ask }));
  replies.push({ role: 'assistant', content: 'Final.' });
  const log = [];
  const turn = await runTurn({ system: 's', history: [], question: 'q', toolContext, chat: scripted(replies, log) });
  assert.equal(turn.content, 'Final.');
  assert.equal(turn.steps.length, MAX_ROUNDS);
  const last = log[log.length - 1];
  assert.equal(last.tools, undefined, 'the final ask withholds the tools');
  assert.match(last.messages[last.messages.length - 1].content, /Answer now/);
});

test('a model without tool support falls back to grounded mode', async () => {
  const events = [];
  const log = [];
  const chat = scripted([new ToolsUnsupported('model does not support tools'), { role: 'assistant', content: 'Grounded.' }], log);
  const turn = await runTurn({ system: 'SYS', history: [], question: 'q', toolContext, chat, emit: (e) => events.push(e) });
  assert.equal(turn.content, 'Grounded.');
  assert.equal(turn.mode, 'grounded');
  assert.deepEqual(events[0], { type: 'mode', mode: 'grounded' });
  assert.equal(log[1].tools, undefined);
  assert.match(log[1].messages[0].content, /^SYS\n\nDATA/);
  assert.match(log[1].messages[0].content, /period_overview/);
});

test('any other failure propagates', async () => {
  await assert.rejects(
    runTurn({ system: 's', history: [], question: 'q', toolContext, chat: scripted([new Error('Ollama unreachable')]) }),
    /unreachable/,
  );
});

test('follow-ups are parsed leniently and never throw', async () => {
  assert.deepEqual(
    await followUps({ chat: async () => ({ content: '{"questions": [" A? ", "B?", "C?", "D?"]}' }), system: 's', question: 'q', answer: 'a' }),
    ['A?', 'B?', 'C?'],
  );
  assert.deepEqual(await followUps({ chat: async () => ({ content: '["x"]' }), system: 's', question: 'q', answer: 'a' }), ['x']);
  assert.deepEqual(await followUps({ chat: async () => ({ content: 'not json' }), system: 's', question: 'q', answer: 'a' }), []);
  assert.deepEqual(await followUps({ chat: async () => { throw new Error('down'); }, system: 's', question: 'q', answer: 'a' }), []);
});
