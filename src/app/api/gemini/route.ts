/**
 * app/api/gemini/route.ts
 * POST /api/gemini  ->  talk-to-data. Hides the Gemini key, runs askData server-side.
 * Body: { question: string, history?: string }. Returns a QueryResult.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Transaction } from "@/lib/contract";
import { askData } from "@/lib/gemini/askData";
import dataset from "@/data/dataset.json";

const transactions = dataset as Transaction[];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const question = body?.question;
    const history = typeof body?.history === "string" ? body.history : "";

    if (typeof question !== "string" || question.trim().length === 0) {
      return NextResponse.json({ error: "A question is required." }, { status: 400 });
    }

    const result = await askData(question, history, transactions);
    return NextResponse.json(result);
  } catch (err) {
    // Never leak the stack or the key. Log server-side, return a safe message.
    console.error("POST /api/gemini failed", err);
    return NextResponse.json(
      { error: "The keeper could not read the ledger just now." },
      { status: 502 },
    );
  }
}
