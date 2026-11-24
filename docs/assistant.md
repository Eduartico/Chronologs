# The assistant

A conversation with the local model about the reader's own ledger. It lives on
the Assistant page, runs entirely against the Ollama instance configured in
Settings → Local AI, and is built the way the hosted assistants are: a system
prompt, a catalogue of read-only tools, and a loop in which the model asks for
figures and writes from what came back.

## How a turn runs

1. `server/routes/assistant.js` receives the question and opens a
   server-sent event stream.
2. `server/engines/assistant/agent.js` (`runTurn`) sends the system prompt,
   the last twelve messages and the question to Ollama's `/api/chat` with the
   tool catalogue and `stream: true`.
3. If the reply is a tool request, the tool runs (`tools.js`), the result goes
   back as a `tool` message, and the model is asked again — at most
   `MAX_ROUNDS` (6) times. Each call and result is streamed to the page as it
   happens, which is what the evidence chips above an answer are.
4. If the reply is prose, it is streamed word by word, saved with the tool
   calls it made (`store.js`, one JSON file per conversation under
   `user-data/state/chats/`), and a second, cheap call with `format: 'json'`
   asks for three follow-up questions.

Closing the connection aborts the model call; an aborted turn is not saved.

## The tools

All in `server/engines/assistant/tools.js`, all read-only, all wrappers over an
engine a screen already uses. The model never sees the ledger itself.

| Tool | Engine behind it |
|---|---|
| `period_overview` | `computeMonthlyCashflow`, `computeCategoryShifts`, `projectCurrentMonth` |
| `spending_by_category` | `computeCategoryBreakdown` (+ prior period) |
| `monthly_trend` | `computeMonthlyCashflow`, `computeSavingsRate` |
| `top_merchants` | `computeTopMerchants` |
| `search_transactions` | `applyTransactionFilters` |
| `recurring_bills` | `detectRecurring`, `occurrences` |
| `cash_forecast` | `forecastCash` |
| `budget_goals` | `budgetReport` |
| `net_worth` | `computeNetWorth` |
| `trips` | `tripSpending` |
| `month_pace` | `computePace` |
| `typical_month` | `typicalMonth` |

Rules the tests hold them to: every tool runs with no arguments; every result
echoes the period it was computed over; rows are capped (40) and results are
truncated at 6 000 characters before going back to the model; a bad tool name
or bad arguments return `{ error }` rather than throwing, so the model can
correct itself. The travel overlay is applied the same way the dashboard
applies it, and investing is kept apart from spending.

Adding a tool is one entry in `TOOLS` plus a label `assistant.tool.<name>` in
every catalogue — `tools.test.js` fails without the label.

## Models

Tool calling needs a model that supports it: llama3.1, qwen2.5, mistral-nemo,
and most recent instruct models do. A model that does not (Ollama answers 400
to the `tools` field) drops into **grounded mode**: `period_overview`,
`recurring_bills` and `budget_goals` are run with their defaults and pasted
into the system prompt, and the answer carries a note saying so. The context
window is asked for explicitly (`num_ctx: 16384`), because Ollama's default of
2–4K would not hold the catalogue and one result.

The prompt follows the interface language like every other prompt
(`server/engines/prompts/assistant.{en,pt}.js`, with the language directive
for the other twelve). The Portuguese one asks for the pre-AO90 register.

## What the page shows

- **Evidence chips** for every tool call, with the period it covered; open one
  for the arguments and the JSON result. A number in the answer can always be
  traced to the lookup it came from.
- **Starters** from `/api/assistant/starters`: the category that moved most,
  the next bills, the goal at risk — keys and params, translated on the client.
- **Follow-ups** after each answer, from the second call.
- A standing reminder that a local model can be wrong, and a note when the
  answer came from grounded mode or from an exhausted loop.
- Markdown in answers is rendered by `web/src/components/Markdown.jsx`, a small
  block parser that builds elements — never `innerHTML`.
