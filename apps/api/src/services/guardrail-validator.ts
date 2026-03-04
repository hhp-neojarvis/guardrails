import type {
  GuardrailRule,
  CampaignGroup,
  GuardrailViolation,
  CampaignGuardrailResult,
  GuardrailValidationResult,
  GuardrailCheck,
  GuardrailField,
} from "@guardrails/shared";

/**
 * Validate campaign groups against active guardrail rules.
 * Pure deterministic logic — no LLM involved.
 */
export function validateGuardrails(
  groups: CampaignGroup[],
  rules: GuardrailRule[],
): GuardrailValidationResult {
  const activeRules = rules.filter((r) => r.active);
  const supportedGroups = groups.filter((g) => g.status !== "unsupported");

  const results: CampaignGuardrailResult[] = supportedGroups.map((group) => {
    const violations: GuardrailViolation[] = [];

    for (const rule of activeRules) {
      const violation = checkRule(group, rule);
      if (violation) {
        violations.push(violation);
      }
    }

    return {
      campaignGroupId: group.id ?? "",
      campaignName: group.campaignName,
      violations,
      status: violations.length > 0 ? "fail" : "pass",
    };
  });

  return {
    totalRules: activeRules.length,
    totalCampaigns: supportedGroups.length,
    results,
    hasViolations: results.some((r) => r.status === "fail"),
  };
}

function checkRule(
  group: CampaignGroup,
  rule: GuardrailRule,
): GuardrailViolation | null {
  const { check } = rule;
  if (!check) return null; // LLM-only rules have no structured check
  const actual = extractFieldValue(group, check.field);

  switch (check.operator) {
    case "is_set":
      return checkIsSet(rule, check, actual);
    case "not_empty":
      return checkNotEmpty(rule, check, actual);
    case "all_within":
      return checkAllWithin(rule, check, group);
    case "gte":
      return checkGte(rule, check, actual);
    case "lte":
      return checkLte(rule, check, actual);
    case "equals":
      return checkEquals(rule, check, actual);
    default:
      return null;
  }
}

function extractFieldValue(group: CampaignGroup, field: GuardrailField): unknown {
  switch (field) {
    case "geo_targets":
      return group.resolvedGeoTargets;
    case "budget":
      // Get budgets from line items, return first non-empty as representative
      return group.lineItems
        ?.map((li) => li.budget)
        .filter((b) => b && b.trim() !== "");
    case "buy_type":
      return group.campaignBuyType?.buyingType;
    case "start_date":
      return group.lineItems
        ?.map((li) => li.startDate)
        .filter((d) => d && d.trim() !== "");
    case "end_date":
      return group.lineItems
        ?.map((li) => li.endDate)
        .filter((d) => d && d.trim() !== "");
    case "frequency_cap":
      return group.frequencyCap;
    case "targeting":
      return group.lineItemConfigs
        ?.map((c) => c.targeting)
        .filter(Boolean);
    default:
      return undefined;
  }
}

function makeViolation(
  rule: GuardrailRule,
  check: GuardrailCheck,
  actual: unknown,
  message: string,
): GuardrailViolation {
  return {
    ruleId: rule.id,
    ruleDescription: rule.description,
    field: check.field,
    expected: check.value,
    actual,
    message,
  };
}

function checkIsSet(
  rule: GuardrailRule,
  check: GuardrailCheck,
  actual: unknown,
): GuardrailViolation | null {
  if (actual === null || actual === undefined) {
    return makeViolation(rule, check, actual, `${check.field} is not set`);
  }
  if (Array.isArray(actual) && actual.length === 0) {
    return makeViolation(rule, check, actual, `${check.field} is not set`);
  }
  return null;
}

function checkNotEmpty(
  rule: GuardrailRule,
  check: GuardrailCheck,
  actual: unknown,
): GuardrailViolation | null {
  if (actual === null || actual === undefined) {
    return makeViolation(rule, check, actual, `${check.field} is empty`);
  }
  if (Array.isArray(actual) && actual.length === 0) {
    return makeViolation(rule, check, actual, `${check.field} is empty`);
  }
  if (typeof actual === "string" && actual.trim() === "") {
    return makeViolation(rule, check, actual, `${check.field} is empty`);
  }
  return null;
}

function checkAllWithin(
  rule: GuardrailRule,
  check: GuardrailCheck,
  group: CampaignGroup,
): GuardrailViolation | null {
  const value = check.value as Record<string, string> | null;
  if (!value || !value.country) return null;

  const targets = group.resolvedGeoTargets;
  if (!targets || targets.length === 0) {
    return makeViolation(
      rule,
      check,
      [],
      `No geo targets resolved to check against '${value.state ? value.state + ", " : ""}${value.country}'`,
    );
  }

  // Check country
  const outsideCountry = targets.filter(
    (t) => t.countryCode !== value.country,
  );
  if (outsideCountry.length > 0) {
    const names = outsideCountry.map((t) => `${t.name} (${t.countryCode})`).join(", ");
    return makeViolation(
      rule,
      check,
      targets.map((t) => ({ name: t.name, countryCode: t.countryCode, region: t.region })),
      `Geo targets outside ${value.country}: ${names}`,
    );
  }

  // Check state/region if specified
  if (value.state) {
    const outsideState = targets.filter(
      (t) => t.region?.toLowerCase() !== value.state.toLowerCase(),
    );
    if (outsideState.length > 0) {
      const names = outsideState.map((t) => `${t.name} (${t.region || "unknown region"})`).join(", ");
      return makeViolation(
        rule,
        check,
        targets.map((t) => ({ name: t.name, region: t.region, countryCode: t.countryCode })),
        `Geo targets outside ${value.state}: ${names}`,
      );
    }
  }

  return null;
}

function checkGte(
  rule: GuardrailRule,
  check: GuardrailCheck,
  actual: unknown,
): GuardrailViolation | null {
  const threshold = Number(check.value);
  if (isNaN(threshold)) return null;

  if (Array.isArray(actual)) {
    // Check each value in array (e.g. budgets)
    for (const item of actual) {
      const num = parseFloat(String(item).replace(/[^0-9.-]/g, ""));
      if (isNaN(num) || num < threshold) {
        return makeViolation(
          rule,
          check,
          actual,
          `${check.field} value '${item}' is below minimum ${threshold}`,
        );
      }
    }
    return null;
  }

  const num = typeof actual === "number" ? actual : parseFloat(String(actual).replace(/[^0-9.-]/g, ""));
  if (isNaN(num) || num < threshold) {
    return makeViolation(
      rule,
      check,
      actual,
      `${check.field} value '${actual}' is below minimum ${threshold}`,
    );
  }
  return null;
}

function checkLte(
  rule: GuardrailRule,
  check: GuardrailCheck,
  actual: unknown,
): GuardrailViolation | null {
  const threshold = Number(check.value);
  if (isNaN(threshold)) return null;

  if (Array.isArray(actual)) {
    for (const item of actual) {
      const num = parseFloat(String(item).replace(/[^0-9.-]/g, ""));
      if (isNaN(num) || num > threshold) {
        return makeViolation(
          rule,
          check,
          actual,
          `${check.field} value '${item}' exceeds maximum ${threshold}`,
        );
      }
    }
    return null;
  }

  const num = typeof actual === "number" ? actual : parseFloat(String(actual).replace(/[^0-9.-]/g, ""));
  if (isNaN(num) || num > threshold) {
    return makeViolation(
      rule,
      check,
      actual,
      `${check.field} value '${actual}' exceeds maximum ${threshold}`,
    );
  }
  return null;
}

function checkEquals(
  rule: GuardrailRule,
  check: GuardrailCheck,
  actual: unknown,
): GuardrailViolation | null {
  const expected = String(check.value);

  if (actual === null || actual === undefined) {
    return makeViolation(
      rule,
      check,
      actual,
      `${check.field} is not set (expected '${expected}')`,
    );
  }

  const actualStr = String(actual);
  if (actualStr !== expected) {
    return makeViolation(
      rule,
      check,
      actual,
      `${check.field} is '${actualStr}', expected '${expected}'`,
    );
  }
  return null;
}
