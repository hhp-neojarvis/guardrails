import OpenAI from "openai";
import type { GeoIntent } from "@guardrails/shared";

const SYSTEM_PROMPT = `You are a geo-targeting expert. Given a "Markets" value from a media plan, extract structured geographic targeting intents.

Rules:
- Each location becomes a separate GeoIntent object
- Determine the type: "city", "region" (state/province), or "country"
- If a region is mentioned with specific cities in parentheses, extract ONLY the cities (not the region itself), and set parentRegion to the region name
- "Pan India" or just "India" means the whole country — type "country"
- Default countryCode to "IN" (India) unless another country is explicitly mentioned
- Return valid JSON with a "geoIntents" array

Examples:

Input: "Maharashtra (Amravati, Bhiwandi)"
Output: {"geoIntents": [
  {"name": "Amravati", "type": "city", "parentRegion": "Maharashtra", "countryCode": "IN"},
  {"name": "Bhiwandi", "type": "city", "parentRegion": "Maharashtra", "countryCode": "IN"}
]}

Input: "Maharashtra"
Output: {"geoIntents": [
  {"name": "Maharashtra", "type": "region", "countryCode": "IN"}
]}

Input: "Pan India"
Output: {"geoIntents": [
  {"name": "India", "type": "country", "countryCode": "IN"}
]}

Input: "Delhi, Mumbai"
Output: {"geoIntents": [
  {"name": "Delhi", "type": "city", "countryCode": "IN"},
  {"name": "Mumbai", "type": "city", "countryCode": "IN"}
]}

Input: "Karnataka (Bangalore, Mysore), Tamil Nadu"
Output: {"geoIntents": [
  {"name": "Bangalore", "type": "city", "parentRegion": "Karnataka", "countryCode": "IN"},
  {"name": "Mysore", "type": "city", "parentRegion": "Karnataka", "countryCode": "IN"},
  {"name": "Tamil Nadu", "type": "region", "countryCode": "IN"}
]}`;

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing env var: OPENAI_API_KEY");
    }
    const baseURL = process.env.OPENAI_BASE_URL;
    openaiClient = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }
  return openaiClient;
}

/**
 * Use LLM to interpret a Markets column value into structured GeoIntents.
 */
export async function interpretGeoFromMarkets(
  marketsValue: string,
): Promise<GeoIntent[]> {
  const client = getClient();
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: marketsValue },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response for geo interpretation");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content}`);
  }

  // Validate structure
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("geoIntents" in parsed) ||
    !Array.isArray((parsed as { geoIntents: unknown }).geoIntents)
  ) {
    throw new Error(`LLM returned unexpected structure: ${content}`);
  }

  const intents = (parsed as { geoIntents: unknown[] }).geoIntents;

  // Validate each intent
  for (const intent of intents) {
    if (
      !intent ||
      typeof intent !== "object" ||
      typeof (intent as GeoIntent).name !== "string" ||
      typeof (intent as GeoIntent).type !== "string" ||
      !["city", "region", "country"].includes((intent as GeoIntent).type)
    ) {
      throw new Error(`LLM returned malformed geo intent: ${JSON.stringify(intent)}`);
    }
  }

  return intents as GeoIntent[];
}

/** Exposed for testing — allows injecting a mock client */
export function _setOpenAIClient(client: OpenAI | null): void {
  openaiClient = client;
}
