import { callLLM } from "../lib/llm.js";
import type {
  GuardrailRule,
  CampaignGroup,
  GuardrailValidationResult,
  CampaignGuardrailResult,
} from "@guardrails/shared";

/**
 * Validate campaign groups against guardrail rules using LLM.
 * Returns structured violations compatible with the override system.
 */
export async function validateGuardrailsLLM(
  groups: CampaignGroup[],
  rules: GuardrailRule[],
  companyId: string,
): Promise<GuardrailValidationResult> {
  const activeRules = rules.filter((r) => r.active);
  const supportedGroups = groups.filter((g) => g.status !== "unsupported");

  if (activeRules.length === 0 || supportedGroups.length === 0) {
    return {
      totalRules: activeRules.length,
      totalCampaigns: supportedGroups.length,
      results: supportedGroups.map((g) => ({
        campaignGroupId: g.id ?? "",
        campaignName: g.campaignName,
        violations: [],
        status: "pass" as const,
      })),
      hasViolations: false,
    };
  }

  // Build user message with campaign data + rules
  const userMessage = buildUserMessage(supportedGroups, activeRules);

  // Call LLM
  const parsed = await callLLM("guardrail_validation", companyId, userMessage);

  // Parse and validate response
  return parseResponse(parsed, supportedGroups, activeRules);
}

function buildUserMessage(
  groups: CampaignGroup[],
  rules: GuardrailRule[],
): string {
  const rulesSection = rules.map((r) => ({
    id: r.id,
    description: r.description,
  }));

  const campaignsSection = groups.map((g) => ({
    id: g.id,
    campaignName: g.campaignName,
    markets: g.markets,
    channel: g.channel,
    resolvedGeoTargets: g.resolvedGeoTargets?.map((t) => ({
      name: t.name,
      type: t.type,
      countryCode: t.countryCode,
      region: t.region,
    })),
    lineItems: g.lineItems?.map((li) => ({
      targeting: li.targeting,
      buyType: li.buyType,
      budget: li.budget,
      startDate: li.startDate,
      endDate: li.endDate,
    })),
    campaignBuyType: g.campaignBuyType
      ? { buyingType: g.campaignBuyType.buyingType }
      : null,
    frequencyCap: g.frequencyCap ?? null,
    frequencyIntervalDays: g.frequencyIntervalDays ?? null,
  }));

  return JSON.stringify({ rules: rulesSection, campaigns: campaignsSection });
}

interface LLMViolation {
  ruleId: string;
  ruleDescription?: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
  message: string;
}

interface LLMCampaignResult {
  campaignGroupId: string;
  campaignName?: string;
  violations: LLMViolation[];
}

interface LLMResponse {
  results: LLMCampaignResult[];
}

function parseResponse(
  parsed: unknown,
  groups: CampaignGroup[],
  rules: GuardrailRule[],
): GuardrailValidationResult {
  // Validate top-level structure
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("results" in parsed) ||
    !Array.isArray((parsed as LLMResponse).results)
  ) {
    throw new Error(
      `LLM returned unexpected structure for guardrail validation: ${JSON.stringify(parsed).slice(0, 500)}`,
    );
  }

  const llmResults = (parsed as LLMResponse).results;
  const groupIds = new Set(groups.map((g) => g.id));
  const ruleMap = new Map(rules.map((r) => [r.id, r]));

  // Map LLM results to our format
  const resultMap = new Map<string, CampaignGuardrailResult>();

  for (const llmResult of llmResults) {
    if (!llmResult.campaignGroupId || !groupIds.has(llmResult.campaignGroupId)) {
      continue; // Skip unknown campaigns
    }

    const violations = (llmResult.violations ?? [])
      .filter((v) => v.ruleId && v.message)
      .map((v) => ({
        ruleId: v.ruleId,
        ruleDescription: v.ruleDescription ?? ruleMap.get(v.ruleId)?.description ?? "",
        field: v.field ?? "",
        expected: v.expected ?? null,
        actual: v.actual ?? null,
        message: v.message,
      }));

    resultMap.set(llmResult.campaignGroupId, {
      campaignGroupId: llmResult.campaignGroupId,
      campaignName: llmResult.campaignName ?? groups.find((g) => g.id === llmResult.campaignGroupId)?.campaignName ?? "",
      violations,
      status: violations.length > 0 ? "fail" : "pass",
    });
  }

  // Fill in any campaigns missing from LLM response (default to pass)
  const results: CampaignGuardrailResult[] = groups.map((g) => {
    const existing = resultMap.get(g.id ?? "");
    if (existing) return existing;
    return {
      campaignGroupId: g.id ?? "",
      campaignName: g.campaignName,
      violations: [],
      status: "pass" as const,
    };
  });

  return {
    totalRules: rules.length,
    totalCampaigns: groups.length,
    results,
    hasViolations: results.some((r) => r.status === "fail"),
  };
}
