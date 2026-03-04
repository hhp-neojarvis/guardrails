import OpenAI from "openai";
import type {
  GeneratedRule,
  GuardrailField,
  GuardrailOperator,
} from "@guardrails/shared";

const VALID_FIELDS: GuardrailField[] = [
  "geo_targets",
  "budget",
  "buy_type",
  "start_date",
  "end_date",
  "frequency_cap",
  "targeting",
];

const VALID_OPERATORS: GuardrailOperator[] = [
  "is_set",
  "not_empty",
  "all_within",
  "gte",
  "lte",
  "equals",
];

const SYSTEM_PROMPT = `You are a media campaign validation expert. Given a natural language description of common mistakes or rules for media campaigns, generate structured validation rules.

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

function isValidRule(rule: unknown): rule is GeneratedRule {
  if (!rule || typeof rule !== "object") return false;

  const r = rule as Record<string, unknown>;
  if (typeof r.description !== "string" || !r.description) return false;
  if (!r.check || typeof r.check !== "object") return false;

  const check = r.check as Record<string, unknown>;
  if (check.scope !== "campaign") return false;
  if (!VALID_FIELDS.includes(check.field as GuardrailField)) return false;
  if (!VALID_OPERATORS.includes(check.operator as GuardrailOperator))
    return false;

  return true;
}

/**
 * Use LLM to generate structured guardrail rules from a natural language prompt.
 */
export async function generateGuardrailRules(
  prompt: string,
): Promise<GeneratedRule[]> {
  const client = getClient();
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response for guardrail generation");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("rules" in parsed) ||
    !Array.isArray((parsed as { rules: unknown }).rules)
  ) {
    throw new Error(`LLM returned unexpected structure: ${content}`);
  }

  const rawRules = (parsed as { rules: unknown[] }).rules;

  // Filter out invalid rules (log but don't throw)
  const validRules: GeneratedRule[] = [];
  for (const rule of rawRules) {
    if (isValidRule(rule)) {
      validRules.push(rule);
    } else {
      console.warn(
        "Filtered out invalid guardrail rule from LLM:",
        JSON.stringify(rule),
      );
    }
  }

  return validRules;
}

/** Exposed for testing — allows injecting a mock client */
export function _setOpenAIClient(client: OpenAI | null): void {
  openaiClient = client;
}
