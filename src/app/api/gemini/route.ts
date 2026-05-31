/**
 * app/api/gemini/route.ts
 * POST /api/gemini  ->  talk-to-data, as an agentic SQL loop. The model is given one tool,
 * run_sql, and the grounding (data dictionary + policy + answer-format). It writes SQL, we
 * execute it against the in-memory mirror (db.ts), feed the rows back, and let it iterate
 * until it has a prose answer. Then two deterministic, non-model steps finish the job:
 *   - the chart is DERIVED from the last query's rows (column typing + shape), never from a
 *     second model call, so the chart kind always follows the data;
 *   - a single persona call (the bridge) turns the prose answer into the contract's
 *     answerText + narration + severity, so the keeper still speaks and emotes.
 *
 * The response is the existing QueryResult (answerText, narration, severity, chart,
 * tableRows) plus an additive `trace` (the executed queries) for the SQL-audit panel.
 *
 * Nothing here throws to the caller. Every failure path (bad body, model/proxy error,
 * unparseable tool args, bad SQL, loop exhaustion) resolves to a rendered QueryResult or a
 * 400, and never leaks the key, the raw SQL, or a stack in an error message.
 */
import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import type { QueryResult, ChartSpec, Severity } from "@/lib/contract";
import { ai, MODEL } from "@/lib/gemini/client";
import { runSql } from "@/lib/db";
import { GROUNDING } from "@/lib/grounding";
import { SYSTEM_INSTRUCTION, PERSONA_PROMPT } from "@/lib/gemini/persona";
import { narrationSchema } from "@/lib/gemini/schemas";
import { stripFence, clampSeverity } from "@/lib/gemini/parse";

// better-sqlite3 is a native module, so this route must run on the Node runtime, not edge.
export const runtime = "nodejs";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type TableRows = Record<string, string | number>[];

// One audit-trail entry per executed query (surfaced to the UI as the keeper's notes).
interface TraceEntry {
  query: string;
  rowCount: number;
  error?: string;
}

const MAX_TURNS = 6; // hard ceiling on agent round-trips (the prompt's loop bound)
const ROWS_TO_MODEL = 50; // rows fed back per tool result (keeps token use sane)
const TABLE_CAP = 50; // rows returned to the UI table
const SERIES_CAP = 15; // chart series points

// The single tool the agent may call. Its arguments are a JSON string with one `query`.
const RUN_SQL_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "run_sql",
    description: "Run a single read-only SQL SELECT against the transactions table and get the rows back as JSON. Call it again to refine or follow up.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "One read-only SQL SELECT statement." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

// Remove markdown bold markers, so any **bolded** text surfaced as a fallback answer reads
// cleanly in the plain-text UI (the dialog box and table do not render markdown).
function stripBold(text: string): string {
  return text.replace(/\*\*/g, "");
}

// Coerce a raw SQL row into the contract's string|number cells (null -> "", others -> String).
function coerceRow(row: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "number" ? value : value === null || value === undefined ? "" : String(value);
  }
  return out;
}

// Is a cell usable as a chart value (a real number, or a numeric string)?
function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return Number.isFinite(Number(value));
  return false;
}

// A label that looks like a calendar bucket: "2025", "2025-09", "2025-09-02", or "2025-W37".
const DATE_LIKE = /^\d{4}(-\d{2}(-\d{2})?|-W\d{2})?$/;

/**
 * Derives the chart and the detail table from the LAST successful query's rows. No model
 * call. Steps:
 *   1. pick a value column (first column whose non-null cells are all numeric);
 *   2. pick a label column (first other column whose cells are text);
 *   3. build the series from those two (dropping non-numeric values), always, so the Story
 *      view's seed questions get a series even when the display kind is "none";
 *   4. choose the kind from the shape: date-like labels -> line; a few non-negative slices
 *      -> donut; a single row or a long list -> none (the number/table carries it); else bar.
 * Guards: empty rows, no numeric column, no text column, all-null values, non-numeric values.
 */
function deriveChart(rows: Record<string, unknown>[] | null, title: string): { chart: ChartSpec; tableRows?: TableRows } {
  if (!rows || rows.length === 0) return { chart: { kind: "none", title, series: [] } };

  const columns = Object.keys(rows[0]);
  const tableRows: TableRows = rows.slice(0, TABLE_CAP).map(coerceRow);

  // Step 1: the value column. Must have at least one non-null cell, and every non-null cell
  // must be numeric.
  const valueColumn =
    columns.find(
      (col) =>
        rows.some((row) => row[col] !== null && row[col] !== undefined) &&
        rows.every((row) => row[col] === null || row[col] === undefined || isNumeric(row[col])),
    ) ?? null;

  // Step 2: the label column. The first non-value column whose cells are text.
  const labelColumn =
    columns.find(
      (col) =>
        col !== valueColumn &&
        rows.some((row) => typeof row[col] === "string" && (row[col] as string).trim() !== "") &&
        rows.every((row) => row[col] === null || row[col] === undefined || typeof row[col] === "string"),
    ) ?? null;

  // Without both a label and a value there is nothing to plot; the table/answer carries it.
  if (!valueColumn || !labelColumn) return { chart: { kind: "none", title, series: [] }, tableRows };

  // Step 3: the series, dropping any row whose value is not a finite number, capped.
  const series = rows
    .map((row) => ({ label: String(row[labelColumn] ?? ""), value: Number(row[valueColumn]) }))
    .filter((point) => Number.isFinite(point.value))
    .slice(0, SERIES_CAP);

  if (series.length === 0) return { chart: { kind: "none", title, series: [] }, tableRows };

  // Step 4: pick the kind from the data's shape (the "different chart when needed" behavior).
  let kind: ChartSpec["kind"];
  if (series.length === 1 || rows.length > SERIES_CAP) {
    // A single number, or a list too long to read as a chart: let the text/table carry it.
    kind = "none";
  } else if (series.every((point) => DATE_LIKE.test(point.label))) {
    kind = "line"; // a time series
  } else if (series.length <= 6 && series.every((point) => point.value >= 0)) {
    kind = "donut"; // a few non-negative parts read as a share of a whole
  } else {
    kind = "bar"; // the general categorical comparison
  }

  return { chart: { kind, title, series, xLabel: labelColumn, yLabel: valueColumn }, tableRows };
}

/**
 * Picks which query's rows drive the chart and table. The agent frequently runs a small
 * follow-up query (a grand total, a count of null dates) after the main breakdown, so the
 * last successful result is often the wrong one to visualize. Score each result: one that
 * yields a drawable chart beats one that does not (ties broken by series length); if none
 * are drawable, the one with the most rows wins (the richest detail table). Returns null
 * when no query succeeded.
 */
function selectPrimaryRows(results: Record<string, unknown>[][]): Record<string, unknown>[] | null {
  let best: Record<string, unknown>[] | null = null;
  let bestScore = -1;
  for (const rows of results) {
    const { chart } = deriveChart(rows, "");
    const score = chart.kind !== "none" ? 1000 + chart.series.length : rows.length;
    if (score >= bestScore) {
      bestScore = score;
      best = rows;
    }
  }
  return best;
}

/**
 * The narration + severity bridge. One structured persona call (json_object) turns the
 * agent's plain answer + a small data sample into the keeper's spoken line and a severity.
 * On any failure it falls back to the plain answer, a neutral line, and severity 0; it never
 * throws.
 */
async function runBridge(question: string, answer: string, sampleRows: Record<string, unknown>[]): Promise<{ answerText: string; narration: string; severity: Severity }> {
  const safeAnswer = stripBold(answer).trim() || "The ledger gave no clear answer to that.";
  try {
    const completion = await ai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${PERSONA_PROMPT}\n\nReturn ONLY a JSON object with exactly this shape:\n${JSON.stringify(narrationSchema)}` },
        {
          role: "user",
          content: `Question: ${question}\nPlain answer (already correct): ${safeAnswer}\nData sample: ${JSON.stringify(sampleRows.slice(0, 8))}`,
        },
      ],
    });
    const parsed = JSON.parse(stripFence(completion.choices?.[0]?.message?.content ?? "")) as {
      answerText?: unknown;
      narration?: unknown;
      severity?: unknown;
    };
    return {
      answerText: typeof parsed.answerText === "string" && parsed.answerText.trim() ? stripBold(parsed.answerText) : safeAnswer,
      narration: typeof parsed.narration === "string" && parsed.narration.trim() ? parsed.narration : "The keeper read the page, and gave a quiet nod.",
      severity: clampSeverity(parsed.severity),
    };
  } catch {
    // The numbers are already settled; only the phrasing failed. Still return the data.
    return { answerText: safeAnswer, narration: "The keeper read the page, and gave a quiet nod.", severity: 0 };
  }
}

// A safe QueryResult for any hard-failure path. Never throws; always renders.
function fallbackResult(answerText: string, trace: TraceEntry[]): QueryResult & { trace: TraceEntry[] } {
  return {
    answerText,
    narration: "The keeper turned the page, but the ink there had faded.",
    severity: 0,
    chart: { kind: "none", title: "", series: [] },
    trace,
  };
}

export async function POST(req: NextRequest) {
  // Validate the body up front: a non-empty question is required.
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const history = typeof body?.history === "string" ? body.history.slice(-4000) : "";
  if (question.length === 0) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }

  // The trace is built incrementally so even a mid-loop failure can return what ran.
  const trace: TraceEntry[] = [];

  try {
    // Step 1: the agentic SQL loop.
    const messages: ChatMessage[] = [
      { role: "system", content: `${SYSTEM_INSTRUCTION}\n\n${GROUNDING}` },
    ];
    // Thread prior turns so follow-ups like "that" or "compared to" resolve.
    if (history) {
      messages.push({ role: "system", content: `Conversation so far (for resolving follow-up references):\n${history}` });
    }
    messages.push({ role: "user", content: question });

    let answer = "";
    let answered = false;
    const successfulResults: Record<string, unknown>[][] = [];

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const completion = await ai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages,
        tools: [RUN_SQL_TOOL],
        tool_choice: "auto",
      });

      const message = completion.choices?.[0]?.message;
      if (!message) break; // no choice returned; fall through to the exhaustion fallback
      messages.push(message);

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // No tool call means the model is done: its text is the answer.
        answer = message.content ?? "";
        answered = true;
        break;
      }

      // Run each requested query and feed the result (or the error) back to the model.
      for (const call of toolCalls) {
        if (call.type !== "function") {
          // We only expose run_sql; reply so the model can recover rather than hang.
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Only the run_sql tool is available." }) });
          continue;
        }

        // Parse the tool arguments. Unparseable args -> push an error so the model retries.
        let query = "";
        try {
          const args = JSON.parse(call.function.arguments) as { query?: unknown };
          query = typeof args.query === "string" ? args.query : "";
        } catch {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Could not parse tool arguments as JSON." }) });
          continue;
        }

        const result = runSql(query);
        trace.push({ query, rowCount: result.rows.length, error: result.error });
        if (result.error) {
          // Hand the error back; the model corrects its SQL on the next turn.
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: result.error }) });
        } else {
          successfulResults.push(result.rows);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.rows.slice(0, ROWS_TO_MODEL)) });
        }
      }
    }

    // If the loop ran out of turns without a final text answer, say so honestly.
    if (!answered) {
      answer = "The keeper searched the ledger but could not settle on a single answer.";
    }

    // Step 2: derive the chart (and table) from the most chartable query's rows. No model
    // call. The agent often issues a scalar follow-up (a grand total, a null-date count)
    // AFTER the main breakdown, so the LAST result is frequently the wrong thing to chart;
    // selectPrimaryRows picks the richest result instead. Otherwise the breakdown's chart
    // and the Story view's seed KPIs (category share, vendors, trend) would come back empty.
    const primaryRows = selectPrimaryRows(successfulResults);
    const { chart, tableRows } = deriveChart(primaryRows, question.slice(0, 80));

    // Step 3: the narration + severity bridge (keeps the keeper speaking and emoting).
    const bridged = await runBridge(question, answer, primaryRows ?? []);

    // Step 4: assemble the contract response plus the additive trace.
    const result: QueryResult & { trace: TraceEntry[] } = {
      answerText: bridged.answerText,
      narration: bridged.narration,
      severity: bridged.severity,
      chart,
      tableRows,
      trace,
    };
    return NextResponse.json(result);
  } catch (err) {
    // Proxy/network or any unexpected failure: log server-side, return a rendered fallback
    // (not a thrown error) so the UI always shows something. No key/SQL/stack in the body.
    console.error("POST /api/gemini failed", err);
    return NextResponse.json(fallbackResult("The keeper could not read the ledger just now.", trace));
  }
}
