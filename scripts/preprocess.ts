/**
 * scripts/preprocess.ts
 * One-time (and re-runnable) build step. Reads the source spreadsheet once, runs it
 * through the single shared parser (parseTransactions.parseWorkbook), and writes the
 * cleaned Transaction[] to src/data/dataset.json — the file every API route imports.
 *
 * Run with:  npm run preprocess
 *        or:  npx tsx scripts/preprocess.ts "path/to/file.xlsx"
 *
 * This is a Node script run by tsx, not part of the Next bundle, so it reads the file
 * from disk as a Buffer and uses the parser's Node "buffer" path unchanged.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseWorkbook } from "../src/lib/parseTransactions";

// Step 1: resolve the input path. A CLI arg wins, then INPUT_PATH env, then the default
// sponsor file. Spaces/parentheses in the filename are fine inside a string literal.
const INPUT_PATH = resolve(
  process.cwd(),
  process.argv[2] || process.env.INPUT_PATH || "src/dummy_data (2).xlsx",
);
const OUTPUT_PATH = resolve(process.cwd(), "src/data/dataset.json");

// Step 2: read the workbook as a Node Buffer and parse it. parseWorkbook throws a clear
// "Unexpected file format" message on a bad file; we let that surface so a malformed
// input fails loudly here, at build-prep time, rather than silently shipping bad data.
const buffer = readFileSync(INPUT_PATH);
const transactions = parseWorkbook(buffer);

// Step 3: write the dataset, creating src/data/ if it does not yet exist.
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(transactions, null, 2));

// Step 4: print an honest summary so the operator can sanity-check the result.
const spend = transactions.filter((txn) => txn.isSpend);
const totalSpend = spend.reduce((sum, txn) => sum + txn.amount, 0);
const formattedTotal = totalSpend.toLocaleString("en-US", {
  style: "currency",
  currency: "USD",
});
console.log(`Read:  ${INPUT_PATH}`);
console.log(`Parsed ${transactions.length} transactions (${spend.length} real spend).`);
console.log(`Total spend: ${formattedTotal}`);
console.log(`Wrote: ${OUTPUT_PATH}`);
