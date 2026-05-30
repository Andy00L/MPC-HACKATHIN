/**
 * gemini/client.ts
 * The single server-side GenAI client and the model constant. Verified current:
 * the SDK is @google/genai (the old @google/generative-ai is deprecated). The key
 * lives in the environment and is read here, never shipped to the browser.
 */

import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  // Fail loudly at module load rather than mid-request with a confusing error.
  throw new Error("GEMINI_API_KEY is not set");
}

export const ai = new GoogleGenAI({ apiKey });

// Fast, cheap, strong enough for query planning and short reasoning. One constant
// so the model can be swapped in a single place.
export const MODEL = "gemini-2.5-flash";
