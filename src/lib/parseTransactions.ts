/**
 * parseTransactions.ts
 * The one parser. Turns an .xlsx or .csv buffer into Transaction[]. Both the
 * build-time preprocess script and the optional UI upload call parseWorkbook, so
 * there is exactly one place where raw rows become clean transactions.
 */

import * as XLSX from "xlsx";
import type { Transaction, Category } from "./contract";

// Exact column headers as they appear in the source sheet (read from the real file).
const COL = {
  code: "Transaction Code",
  description: "Transaction Description",
  postingDate: "Posting date of transaction",
  txnDate: "Transaction Date",
  merchant: "Merchant Info DBA Name",
  amount: "Transaction Amount",
  direction: "Debit or Credit",
  mcc: "Merchant Category Code",
  city: "Merchant City",
  country: "Merchant Country",
  state: "Merchant State/Province",
} as const;

// The headers we must see, or the file is not in the expected format.
const REQUIRED_HEADERS = [COL.code, COL.amount, COL.direction, COL.merchant];

// Spend category from the Merchant Category Code (MCC, ISO 18245). Unknown codes
// fall through to "other". Extend freely.
const MCC_TO_CATEGORY: Record<string, Category> = {
  "5541": "fuel",
  "5542": "fuel",
  "9399": "permits_gov",
  "7542": "vehicle_maintenance",
  "7538": "vehicle_maintenance",
  "5533": "vehicle_maintenance",
  "5532": "vehicle_maintenance",
  "5561": "vehicle_maintenance",
  "5085": "supplies",
  "5046": "supplies",
  "5200": "supplies",
  "5300": "supplies",
  "5251": "supplies",
  "4784": "tolls",
  "4812": "telecom",
  "4814": "telecom",
  "4816": "digital",
  "5947": "gift_card",
  "4121": "transport",
};

// Statement line type from the Transaction Code. Separates purchases from the rest.
const CODE_TO_LINE_TYPE: Record<string, Transaction["lineType"]> = {
  "3001": "purchase",
  "137": "fee",
  "401": "fee",
  "404": "interest",
  "3005": "atm",
  "3006": "credit",
  "375": "credit",
  "108": "payment",
  "3035": "other",
};

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function toCodeString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return String(Math.trunc(value));
  const text = String(value).trim();
  if (text.length === 0) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? String(Math.trunc(numeric)) : text;
}

function toAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : 0;
  const cleaned = String(value ?? "").replace(/[^0-9.\-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const month = String(parsed.m).padStart(2, "0");
      const day = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${month}-${day}`;
    }
  }
  return null;
}

function normalizeDirection(value: unknown): "debit" | "credit" {
  return String(value ?? "").trim().toLowerCase() === "credit" ? "credit" : "debit";
}

function rowToTransaction(row: Record<string, unknown>, index: number): Transaction {
  const transactionCode = toCodeString(row[COL.code]) ?? "unknown";
  const mcc = toCodeString(row[COL.mcc]);
  const direction = normalizeDirection(row[COL.direction]);
  const lineType = CODE_TO_LINE_TYPE[transactionCode] ?? "other";

  return {
    id: `tx_${String(index + 1).padStart(4, "0")}`,
    txnDate: toIsoDate(row[COL.txnDate]),
    postingDate: toIsoDate(row[COL.postingDate]),
    merchant: toStringOrNull(row[COL.merchant]) ?? "Unknown merchant",
    description: toStringOrNull(row[COL.description]) ?? "",
    amount: toAmount(row[COL.amount]),
    direction,
    transactionCode,
    lineType,
    mcc,
    category: mcc ? (MCC_TO_CATEGORY[mcc] ?? "other") : "other",
    city: toStringOrNull(row[COL.city]),
    state: toStringOrNull(row[COL.state]),
    country: toStringOrNull(row[COL.country]),
    // Real outgoing spend = a purchase (code 3001) that is a debit.
    isSpend: lineType === "purchase" && direction === "debit",
  };
}

/**
 * Parses a workbook buffer into clean transactions. Throws a clear error if the
 * file does not have the expected columns, so callers can show a friendly message.
 */
export function parseWorkbook(data: ArrayBuffer | Buffer | Uint8Array): Transaction[] {
  const workbook = XLSX.read(data, { cellDates: true, type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Unexpected file format: no sheets found");

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (rows.length === 0) throw new Error("Unexpected file format: no rows found");

  const headers = Object.keys(rows[0]);
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new Error(`Unexpected file format: missing columns ${missing.join(", ")}`);
  }

  return rows.map(rowToTransaction);
}
