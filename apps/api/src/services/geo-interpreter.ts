import type { GeoIntent } from "@guardrails/shared";
import { callLLM } from "../lib/llm.js";

/**
 * Use LLM to interpret a Markets column value into structured GeoIntents.
 */
export async function interpretGeoFromMarkets(
  marketsValue: string,
  companyId?: string,
): Promise<GeoIntent[]> {
  const parsed = await callLLM("geo_interpretation", companyId, marketsValue);

  // Validate structure
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("geoIntents" in parsed) ||
    !Array.isArray((parsed as { geoIntents: unknown }).geoIntents)
  ) {
    throw new Error(`LLM returned unexpected structure: ${JSON.stringify(parsed).slice(0, 500)}`);
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
