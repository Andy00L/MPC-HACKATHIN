<div align="center">

<h1>The Ledger of the Unknown</h1>

<p><em>AI expense intelligence for SMBs, wearing the skin of a storybook.</em></p>

<p>
<img alt="Next.js" src="https://img.shields.io/badge/Next.js_15-000?style=flat-square&logo=next.js&logoColor=white">
<img alt="React" src="https://img.shields.io/badge/React_19-149ECA?style=flat-square&logo=react&logoColor=white">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
<img alt="SQLite" src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white">
<img alt="Gemini" src="https://img.shields.io/badge/Gemini-8E75B2?style=flat-square&logo=googlegemini&logoColor=white">
<img alt="ElevenLabs" src="https://img.shields.io/badge/ElevenLabs-000?style=flat-square">
</p>

</div>

<table>
<tr><td>

A hand-drawn Keeper narrates a fleet company's six months of card spending across a two page book spread. Under the illustration is a real analyst: a SQL-writing agent, a policy engine, and a reconstructed employee layer.

</td></tr>
</table>

## Features

<table>
<tr>
<td width="50%" valign="top">

### Talk to your data
Plain English in, the right chart/table/number out. The model gets a data dictionary and one tool, `run_sql`, and writes its own `SELECT` against the live data. No canned queries, nothing precomputed.

</td>
<td width="50%" valign="top">

### Policy compliance engine
Finance sets the rules (pre-auth threshold, per-category caps, toggles); the scan updates live. Code handles determinate checks (duplicate, split, anomaly, foreign, gift card); the AI handles ambiguous cases (`meal`/`alcohol` to "receipt required"). Ranked worst-first.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### AI pre-approval
A fleet statement has no employee/department, so we reconstruct them behaviorally and surface request + history + budget + an AI approve/deny recommendation in one view.

</td>
<td width="50%" valign="top">

### Automated reports
Spend grouped into reports; the Keeper narrates the main insights aloud, so a report reads like a passage instead of a spreadsheet.

</td>
</tr>
</table>

## Architecture

```text
question -> POST /api/gemini (agentic loop, max 6 turns, temp 0)
              |  model writes SELECT
              v
         run_sql tool -> guarded read-only layer (SELECT only, no writes)
              |  rows as JSON, refine until answered
              v
   prose answer --> charts (deterministic from rows, no model call)
                --> Keeper narration (2nd non-agentic call) + severity -> ElevenLabs
```

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| Data | `dataset.json` mirrored into in-memory SQLite (`better-sqlite3`) |
| Reasoning | Gemini, single-tool agentic loop at temperature 0 |
| Voice | ElevenLabs cloned narrator |

## Compliance: two passes

```text
Pass 1 (sync)   findViolations(txns, rules)
                OVER_PREAUTH | CATEGORY_LIMIT | ALCOHOL | GIFT_CARD
                DUPLICATE | ANOMALY (MAD z + 4x median) | SPLIT | FOREIGN_TXN
Pass 2 (async)  applyContextualRules -> meal/alcohol rows -> Gemini
                returns reimbursability + missing context
                PENDING_CONTEXT suppresses CATEGORY_LIMIT on the same txn
```

## Run

```bash
npm install
echo "GEMINI_API_KEY=..."     >> .env.local
echo "ELEVENLABS_API_KEY=..." >> .env.local
npm run dev   # http://localhost:3000
```

## Employee reconstruction

No employee columns exist, so each transaction is mapped to a spend category, grouped by category + geography + date window into a coherent cardholder, and a department is inferred from dominant activity:

```text
fuel, tolls, truck stops   -> Operations
DMV, DOT, permits          -> Compliance
hotels, meals, rideshare   -> Sales & Travel
Costco, Amazon, retail     -> Administration
cash advances, bank fees   -> Finance
high-value mixed           -> Management
```

## Honest constraints

Grounding was most of the battle: the real numbers only appeared once the data dictionary split purchases from payments (rows without an MCC are fees/EFT, not spend), or the agent reported a $264K transfer as the largest purchase. The principle throughout: the model handles ambiguity, code handles anything determinate, and the two never blur.
