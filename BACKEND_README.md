# Backend: the SQL-agent build

The engine for the Brim track, folded into the existing Next.js 15 (App Router) + React 19 app. The UI (the "Roaming Keeper" storybook) talks to it through five HTTP endpoints and never sees a key. Talk-to-data is an agentic SQL loop, not a hand-written query planner.

## Install

```
npm install
```

Dependencies that matter: `openai` (the proxy speaks the OpenAI Chat Completions protocol), `better-sqlite3` (the in-memory query engine), `xlsx` (the spreadsheet parser). `better-sqlite3` is a native module, so `next.config.mjs` lists it under `serverExternalPackages` to keep it out of the bundle. `@google/genai` is not used.

## Environment

`.env.local` (never committed):

```
GEMINI_GATEWAY_URL=https://api.tokenrouter.com/v1
GEMINI_GATEWAY_TOKEN=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

`gemini/client.ts` reads `GEMINI_GATEWAY_TOKEN` and `GEMINI_GATEWAY_URL` and throws at load if either is missing, so a misconfigured proxy fails loudly, not mid-request. The proxy serves one model, `google/gemini-3.5-flash`.

## One-time: build the dataset

The endpoints read `src/data/dataset.json`. Generate it from the spreadsheet once:

```
npm run preprocess
```

`scripts/preprocess.ts` runs the source xlsx through `parseTransactions.parseWorkbook` and writes the cleaned `Transaction[]`.

## File map

```
src/lib/
  contract.ts            The shared types. Single source of truth. Import, never redefine.
  parseTransactions.ts   parseWorkbook(buffer) -> Transaction[]. Used by preprocess and upload.
  db.ts                  In-memory SQLite mirror of the dataset + guarded read-only runSql().
  grounding.ts           Data dictionary + spend rule + policy + answer-format, as one string.
  aggregate.ts           Pure totals: by category, by merchant, over time, filters.
  compliance.ts          findViolations(), repeatOffenders(). Robust anomaly scoring.
  budgets.ts             CATEGORY_BUDGETS derived from real spend + budgetStatus().
  trips.ts               buildReports(): clusters spend into monthly route reports.
  gemini/
    client.ts            The one OpenAI-SDK client pointed at the proxy + MODEL.
    parse.ts             stripFence() + clampSeverity(), shared by the route and approve.
    schemas.ts           The JSON shapes for the structured calls (narration, approval).
    persona.ts           SYSTEM_INSTRUCTION (the agent), the persona + approval prompts,
                         and the violation-narration template.
    approve.ts           buildApprovalItem(): AI approve/deny with budget + history context.
src/app/api/
  gemini/route.ts        POST  /api/gemini      talk-to-data, the agentic SQL loop
  violations/route.ts    GET   /api/violations  policy violations + repeat offenders
  reports/route.ts       GET   /api/reports     trip-clustered expense reports
  approvals/route.ts     GET   /api/approvals   pre-approval queue (top charges by amount)
  voice/route.ts         POST  /api/voice       ElevenLabs TTS proxy (audio/mpeg)
```

## How talk-to-data works (the AI-depth point)

`POST /api/gemini` runs an agentic loop, not a single prompt:

1. The model is given one tool, `run_sql`, plus the grounding (the data dictionary, the spend rule, the policy, and the answer-format). It writes a SQL `SELECT`; the route runs it through `db.runSql` (a guarded, read-only path) and feeds the rows back. It iterates up to six times, correcting its own SQL when a query errors.
2. The chart is then DERIVED from the rows of the most chartable query (column typing plus shape: date-like labels become a line, a few non-negative slices a donut, otherwise a bar, a single row or a long list `none`). No second model call decides the chart.
3. One structured persona call (the bridge) turns the prose answer into the contract's `answerText` + `narration` + `severity`, so the keeper still speaks and emotes.

The response is the existing `QueryResult` (answerText, narration, severity, chart, tableRows) plus an additive `trace` (the executed queries) for the UI's audit panel. Every failure path returns a rendered `QueryResult`, never a thrown error.

The single rule that keeps the numbers honest: rows where `mcc IS NULL` are card-generated lines (payments, fees), not purchases, so spend questions filter `is_spend = 1`. That is why the largest genuine purchase is the $55,372.46 Michelin charge, not the $264,517.44 CWB payment.

## Endpoints

- `POST /api/gemini` Request `{ question: string, history?: string }`, response `QueryResult & { trace }`.
- `GET /api/violations` Response `{ violations, repeatOffenders, count, transactionCount, spendCount }`, ranked worst-first. The $55k anomaly leads; rules are OVER_PREAUTH, ALCOHOL, GIFT_CARD, DUPLICATE, ANOMALY, SPLIT.
- `GET /api/reports` Response `{ reports, count }`, one route report per month with category totals and its own policy checks.
- `GET /api/approvals` Response `{ items, count }`. The largest charges that need pre-authorization, each with budget status, card history, and an AI recommendation. Capped at the top 20 by amount (each item is a model call).
- `POST /api/voice` Request `{ text: string }`, response streamed `audio/mpeg` in the configured voice. The key stays server-side.

## Verify

```
npm run build       # production build, type-check, native-module bundling
npm run test:data   # deterministic ground-truth assertions against runSql
```

`npm run test:data` asserts the four golden facts: the largest genuine purchase is Michelin $55,372.46 (not the larger payment line); the AB TRANSP $940 duplicate pair on 2025-10-06 stays two rows; exactly three foreign purchases; and 2,724 purchases over $50.

## Known gaps

- The dataset contains no alcohol purchases (MCC 5921/5813), so the ALCOHOL rule is correct but inert here; GIFT_CARD is retained so the feed keeps a real personal-use flag.
- The trip clustering is monthly because this fleet runs almost daily (no multi-day gaps) and crosses many states per route; calendar months are the most meaningful segmentation the data supports.
- `/api/approvals` makes one model call per item, so it is capped at 20 charges and is the slowest route.
