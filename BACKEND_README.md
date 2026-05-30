# Backend: drop-in build

The full engine for the Brim track. Drop the `src` tree into your Next.js app (App Router). The UI (Person B) talks to it through four HTTP endpoints and never sees a key.

## Install

```
npm i @google/genai xlsx
npm i -D tsx
```

## Environment (assumed already set)

`.env.local` (never committed):

```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

`gemini/client.ts` throws at load if `GEMINI_API_KEY` is missing, so a misconfigured key fails loudly, not mid-request.

## One-time: build the dataset

The endpoints import `src/data/dataset.json`. Generate it from the spreadsheet once:

```
npx tsx scripts/preprocess.ts
```

(`scripts/preprocess.ts` is the file delivered earlier. Point its `INPUT_PATH` at the xlsx. After this runs, `src/data/dataset.json` exists and every endpoint works.) The optional UI upload path calls `parseWorkbook` from `parseTransactions.ts` directly, so it does not need the file on disk.

## File map

```
src/lib/
  contract.ts            6 shared types. Single source of truth. Import, never redefine.
  parseTransactions.ts   parseWorkbook(buffer) -> Transaction[]. Used by preprocess and upload.
  aggregate.ts           pure totals: by category, by merchant, over time, filters.
  compliance.ts          findViolations(), repeatOffenders(). Robust anomaly scoring.
  budgets.ts             CATEGORY_BUDGETS + budgetStatus(). Tune to real totals.
  trips.ts               buildReports(): clusters spend into route reports.
  gemini/
    client.ts            GoogleGenAI client + MODEL ("gemini-2.5-flash").
    schemas.ts           responseSchema objects for structured output.
    persona.ts           planner/persona/approval prompts + violation template.
    askData.ts           talk-to-data: plan -> compute -> narrate.
    approve.ts           buildApprovalItem(): AI approve/deny with context.
src/app/api/
  gemini/route.ts        POST  /api/gemini      talk-to-data
  violations/route.ts    GET   /api/violations  policy violations + repeat offenders
  reports/route.ts       GET   /api/reports     trip-clustered expense reports
  voice/route.ts         POST  /api/voice       ElevenLabs TTS proxy (audio/mpeg)
```

## Endpoints

### POST /api/gemini  (Feature 1)
Request: `{ "question": string, "history"?: string }`
Response: `QueryResult` (answerText, narration, severity, chart, tableRows).
`history` is a short string of the last 2 to 3 question/answer pairs, so follow-ups resolve. The route is stateless; the client always sends the history.

### GET /api/violations  (Feature 2)
Response: `{ violations: Violation[], repeatOffenders: {merchant,count}[], count }`.
Violations are ranked worst-first, each with `severity` (0/1/2), `reasons`, and a filled in-character `narration`. The $55k anomaly and the gift-card charge appear here.

### GET /api/reports  (Feature 4)
Response: `{ reports: ExpenseReport[], count }`. Each report is a route trip with category totals and its own policy checks.

### POST /api/voice
Request: `{ "text": string }`. Response: streamed `audio/mpeg`. Uses `eleven_flash_v2_5` for low latency. The key stays server-side; the browser only receives audio.

## How the talk-to-data loop works (the AI-depth point)

`askData` is three steps, not one prompt: Gemini plans the query (structured), `aggregate.ts` computes it (correct totals, deterministic), Gemini narrates the computed result (structured, in character). Gemini never does arithmetic on raw rows. Both `JSON.parse` calls are guarded; a parse failure or timeout returns a safe `QueryResult` with `chart.kind: "none"`, never a crash.

## Feature 3 (pre-approval) is wired but optional

`approve.ts` and `budgets.ts` are complete, but `CATEGORY_BUDGETS` ships with placeholder numbers. Tune them to the real category totals (run `aggregate.spendByCategory` once and set sensible limits) or the "remaining" figure is meaningless. There is no `/api/approvals` route yet; add one that takes a transaction id, looks it up in the dataset, and calls `buildApprovalItem` when you build Feature 3. If you are short on time, skip it.

## Edge cases handled

Empty dataset, null dates (excluded from time/range and trip logic), categories with fewer than 5 charges (no anomaly baseline), degenerate spread (MAD = 0 falls back to a median-multiple test), credits/fees/payments (excluded from spend), malformed upload (parser throws a clear "Unexpected file format"), Gemini bad JSON or timeout (safe fallback), empty query result (honest "nothing matched"), and missing voice config (clean 500, not a crash).

## Verify

```
npm run build
```

Then hit each endpoint. `POST /api/gemini` with a golden question returns a chart and narration; `GET /api/violations` returns the ranked flags. No key appears in any response body or the client bundle.
