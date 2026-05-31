/**
 * gemini/client.ts
 * One model client for the whole app. The company proxy (tokenrouter) speaks the OpenAI
 * /v1/chat/completions protocol and authenticates with a Bearer token, so we use the
 * official `openai` SDK pointed at the proxy base URL instead of the old hand-rolled
 * fetch adapter. Every model call in the app (the SQL agent, the narration bridge, the
 * approval reasoning) goes through this single `ai` instance. Swapping providers is one
 * env var.
 *
 * Env names: this reads GEMINI_GATEWAY_TOKEN and GEMINI_GATEWAY_URL, the names already set
 * and working in .env.local. (The integration prompt's snippet named GEMINI_API_KEY /
 * GEMINI_BASE_URL, but those are not set in this repo. We deliberately keep the live
 * gateway names rather than edit the secrets file, so there is one source of truth for the
 * proxy credentials and nothing already-working breaks.)
 */
import OpenAI from "openai";

// The proxy bearer token and base URL (e.g. https://api.tokenrouter.com/v1).
const apiKey = process.env.GEMINI_GATEWAY_TOKEN;
const baseURL = process.env.GEMINI_GATEWAY_URL;

// Fail loudly at module load if the proxy is misconfigured, not at the first request, so a
// missing key surfaces immediately rather than as a confusing runtime error mid-question.
if (!apiKey) throw new Error("GEMINI_GATEWAY_TOKEN is required (the proxy bearer token).");
if (!baseURL) throw new Error("GEMINI_GATEWAY_URL is required (the proxy base URL).");

// The one OpenAI-protocol client. Callers use ai.chat.completions.create(...).
export const ai = new OpenAI({ apiKey, baseURL });

// The only model the proxy serves (OpenRouter-style "provider/model" id).
export const MODEL = "google/gemini-3.5-flash";
