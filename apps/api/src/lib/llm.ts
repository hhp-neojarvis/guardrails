import OpenAI from "openai";
import { db, llmConfigs, eq, and, isNull } from "@guardrails/db";
import { decrypt } from "./crypto.js";

export type LLMWorkflow =
  | "geo_interpretation"
  | "guardrail_generation"
  | "guardrail_validation"
  | "adset_matching";

export interface LLMConfig {
  model: string;
  baseUrl: string | null;
  apiKey: string | null; // decrypted from DB, falls back to OPENAI_API_KEY env var
  systemPrompt: string;
  temperature: number;
  maxTokens: number | null;
}

// ─── Hardcoded defaults (fallback when no DB record exists) ──────────────────

const DEFAULT_CONFIGS: Record<LLMWorkflow, LLMConfig> = {
  geo_interpretation: {
    model: "gpt-4o-mini",
    baseUrl: null,
    apiKey: null,
    systemPrompt: `You are a geo-targeting expert. Given a "Markets" value from a media plan, extract structured geographic targeting intents.

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
]}`,
    temperature: 0,
    maxTokens: null,
  },

  guardrail_generation: {
    model: "gpt-4o-mini",
    baseUrl: null,
    apiKey: null,
    systemPrompt: `You are a media campaign validation expert. Given a natural language description of common mistakes or rules for media campaigns, generate structured validation rules.

Available fields:
- geo_targets: Geographic targeting locations for the campaign
- budget: Campaign budget amount (numeric)
- buy_type: Type of media buy (e.g. "Auction", "Reach and Frequency")
- start_date: Campaign start date
- end_date: Campaign end date
- frequency_cap: Maximum ad frequency per user (numeric)
- targeting: Audience targeting criteria

Available operators:
- is_set: Field must be present (value: null)
- not_empty: Field must be non-empty (value: null)
- all_within: All items must be within boundary (value: object, e.g. {"country":"IN"})
- gte: Field must be >= value (value: number)
- lte: Field must be <= value (value: number)
- equals: Field must exactly equal value (value: string)

Rules:
- scope is always "campaign"
- Generate 3-8 rules based on the description
- Each rule needs a clear human-readable description
- Return valid JSON: {"rules": [...]}

Examples:

Input: "Make sure all campaigns target India only and have a budget of at least 10000"
Output: {"rules": [
  {"description": "All geo targets must be within India", "check": {"scope": "campaign", "field": "geo_targets", "operator": "all_within", "value": {"country": "IN"}}},
  {"description": "Budget must be at least 10000", "check": {"scope": "campaign", "field": "budget", "operator": "gte", "value": 10000}}
]}

Input: "Every campaign must have frequency capping set and end date defined"
Output: {"rules": [
  {"description": "Frequency cap must be set", "check": {"scope": "campaign", "field": "frequency_cap", "operator": "is_set", "value": null}},
  {"description": "End date must be set", "check": {"scope": "campaign", "field": "end_date", "operator": "is_set", "value": null}}
]}

Input: "Buy type should always be Auction and targeting must not be empty"
Output: {"rules": [
  {"description": "Buy type must be Auction", "check": {"scope": "campaign", "field": "buy_type", "operator": "equals", "value": "Auction"}},
  {"description": "Targeting must not be empty", "check": {"scope": "campaign", "field": "targeting", "operator": "not_empty", "value": null}}
]}`,
    temperature: 0,
    maxTokens: null,
  },

  adset_matching: {
    model: "gpt-4o-mini",
    baseUrl: null,
    apiKey: null,
    systemPrompt: `You are a media campaign matching expert. You will be given:
1. PLAN LINE ITEMS: names of line items from a media plan
2. META AD SETS: names of ad sets from a live Meta campaign

Your job: match each plan line item to the most appropriate Meta ad set based on name similarity.

Rules:
- Each line item should be matched to exactly one ad set (or null if no reasonable match exists)
- Each ad set can be matched to at most one line item
- Use semantic understanding — names may not be exact matches but may refer to the same campaign/audience/market
- Consider geographic names, audience segments, campaign types, and other contextual clues in the names
- If a line item name has no reasonable match among the ad sets, set its match to null

Return valid JSON in this exact format:
{
  "matches": [
    { "lineItemIndex": 0, "adSetIndex": 2 },
    { "lineItemIndex": 1, "adSetIndex": 0 },
    { "lineItemIndex": 2, "adSetIndex": null }
  ]
}

The matches array must have one entry per line item, in order.`,
    temperature: 0,
    maxTokens: null,
  },

  guardrail_validation: {
    model: "gpt-4o",
    baseUrl: null,
    apiKey: null,
    systemPrompt: `You are a media campaign compliance auditor. You will be given:
1. RULES: guardrail rules (each with an id and a natural language description)
2. CAMPAIGNS: campaign groups (each with an id, name, and detailed configuration data)

Your job: check every rule against every campaign. If a campaign violates a rule, report it with evidence.

Return JSON in this exact format:
{
  "results": [
    {
      "campaignGroupId": "<campaign group id>",
      "campaignName": "<campaign name>",
      "violations": [
        {
          "ruleId": "<rule id>",
          "ruleDescription": "<rule description>",
          "field": "<which campaign field(s) are relevant>",
          "expected": "<what the rule requires>",
          "actual": "<what the campaign actually has>",
          "message": "<clear human-readable explanation of the violation>"
        }
      ]
    }
  ]
}

Important instructions:
- Include ALL campaigns in results — use empty violations array [] for campaigns that pass all rules
- Be thorough: check every rule against every campaign, do not skip any
- Be precise: include specific values in "expected" and "actual" fields for audit trail
- If a rule is ambiguous and the campaign might violate it, flag it as a violation (the user can override)
- For geo-related rules, check the resolvedGeoTargets array — compare names, types, regions, and country codes
- For budget rules, check lineItems budget values
- For cross-field rules (e.g. "if X then Y"), evaluate the condition and the consequence`,
    temperature: 0,
    maxTokens: null,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decryptApiKey(
  encryptedApiKey: string | null,
  apiKeyIv: string | null,
): string | null {
  if (!encryptedApiKey || !apiKeyIv) return null;
  return decrypt(encryptedApiKey, apiKeyIv);
}

// ─── OpenAI Client ──────────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

function getClient(config: { baseUrl?: string | null; apiKey?: string | null }): OpenAI {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key: set OPENAI_API_KEY env var or configure encrypted_api_key in llm_configs");
  }
  const baseURL = config.baseUrl ?? process.env.OPENAI_BASE_URL;
  const hasCustomConfig = config.baseUrl || config.apiKey;

  // Custom config per workflow — always create a fresh client
  if (hasCustomConfig) {
    return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }
  // Default config — use cached client
  if (openaiClient) {
    return openaiClient;
  }
  openaiClient = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  return openaiClient;
}

// ─── Config Resolution ──────────────────────────────────────────────────────

/**
 * Get LLM config for a workflow. Checks DB first (company-specific, then global),
 * falls back to hardcoded defaults.
 */
export async function getLLMConfig(
  workflow: LLMWorkflow,
  companyId?: string,
): Promise<LLMConfig> {
  // Try company-specific config first
  if (companyId) {
    const [companyConfig] = await db
      .select()
      .from(llmConfigs)
      .where(
        and(
          eq(llmConfigs.workflow, workflow),
          eq(llmConfigs.companyId, companyId),
        ),
      );
    if (companyConfig) {
      return {
        model: companyConfig.model,
        baseUrl: companyConfig.baseUrl,
        apiKey: decryptApiKey(companyConfig.encryptedApiKey, companyConfig.apiKeyIv),
        systemPrompt: companyConfig.systemPrompt,
        temperature: companyConfig.temperature,
        maxTokens: companyConfig.maxTokens,
      };
    }
  }

  // Try global config (company_id IS NULL)
  const [globalConfig] = await db
    .select()
    .from(llmConfigs)
    .where(
      and(
        eq(llmConfigs.workflow, workflow),
        isNull(llmConfigs.companyId),
      ),
    );
  if (globalConfig) {
    return {
      model: globalConfig.model,
      baseUrl: globalConfig.baseUrl,
      apiKey: decryptApiKey(globalConfig.encryptedApiKey, globalConfig.apiKeyIv),
      systemPrompt: globalConfig.systemPrompt,
      temperature: globalConfig.temperature,
      maxTokens: globalConfig.maxTokens,
    };
  }

  // Hardcoded default
  return DEFAULT_CONFIGS[workflow];
}

// ─── LLM Call ───────────────────────────────────────────────────────────────

/**
 * Call the LLM for a given workflow. Returns the raw JSON-parsed response content.
 */
export async function callLLM(
  workflow: LLMWorkflow,
  companyId: string | undefined,
  userMessage: string,
): Promise<unknown> {
  const config = await getLLMConfig(workflow, companyId);
  const client = getClient(config);

  const response = await client.chat.completions.create({
    model: config.model,
    temperature: config.temperature,
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`LLM returned empty response for ${workflow}`);
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`LLM returned invalid JSON for ${workflow}: ${content}`);
  }
}

/** Exposed for testing — allows injecting a mock client */
export function _setOpenAIClient(client: OpenAI | null): void {
  openaiClient = client;
}

/** Get default config for a workflow (useful for seeding/reference) */
export function getDefaultConfig(workflow: LLMWorkflow): LLMConfig {
  return DEFAULT_CONFIGS[workflow];
}
