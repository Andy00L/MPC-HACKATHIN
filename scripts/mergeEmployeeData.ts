/**
 * scripts/mergeEmployeeData.ts
 * Reads dummy_data_employee.xlsx (which has the same rows as the original spreadsheet
 * plus employee_id and department columns) and merges those two fields into
 * src/data/dataset.json by row position (both files share the same 4235-row order).
 *
 * Run with:  npx tsx scripts/mergeEmployeeData.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";

const XLS_PATH = resolve(process.cwd(), "dummy_data_employee.xlsx");
const DATASET_PATH = resolve(process.cwd(), "src/data/dataset.json");

const wb = XLSX.readFile(XLS_PATH);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

const header = rows[0] as string[];
const empIdx = header.indexOf("employee_id");
const deptIdx = header.indexOf("department");

const data = rows.slice(1);
const transactions = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as Array<Record<string, unknown>>;

if (data.length !== transactions.length) {
  console.warn(`Row count mismatch: xlsx=${data.length}, dataset=${transactions.length}. Merging by min.`);
}

const count = Math.min(data.length, transactions.length);
for (let i = 0; i < count; i++) {
  const row = data[i] as unknown[];
  transactions[i].employeeId = String(row[empIdx] ?? "").trim() || null;
  transactions[i].department = String(row[deptIdx] ?? "").trim() || null;
}

writeFileSync(DATASET_PATH, JSON.stringify(transactions, null, 2));
console.log(`Merged employee data into ${count} transactions.`);

// Summary
const depts: Record<string, number> = {};
for (const t of transactions) {
  const d = t.department as string;
  if (d) depts[d] = (depts[d] ?? 0) + 1;
}
console.log("Dept breakdown:", depts);
