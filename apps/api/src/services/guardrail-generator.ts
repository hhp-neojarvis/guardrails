import type {
  GeneratedRule,
  GuardrailField,
  GuardrailOperator,
} from "@guardrails/shared";
import { callLLM } from "../lib/llm.js";

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

function isValidRule(rule: unknown): rule is GeneratedRule {
  if (!rule || typeof rule !== "object") return false;

  const r = rule as Record<string, unknown>;
  if (typeof r.description !== "string" || !r.description) return false;

  // Rules without check are valid (description-only for LLM validation)
  if (!r.check) return true;

  if (typeof r.check !== "object") return false;
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
  companyId?: string,
): Promise<GeneratedRule[]> {
  const parsed = await callLLM("guardrail_generation", companyId, prompt);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("rules" in parsed) ||
    !Array.isArray((parsed as { rules: unknown }).rules)
  ) {
    throw new Error(`LLM returned unexpected structure: ${JSON.stringify(parsed).slice(0, 500)}`);
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
