import type {
  CampaignGroup,
  MetaCampaignSnapshot,
  MetaAdSetSnapshot,
  FieldComparison,
  CampaignValidationResult,
} from "@guardrails/shared";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse a date string and return YYYY-MM-DD only */
export function parseDateOnly(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Extract all geo keys from a MetaCampaignSnapshot's ad sets */
export function extractMetaGeoKeys(
  metaCampaign: MetaCampaignSnapshot,
): Set<string> {
  const keys = new Set<string>();
  for (const adSet of metaCampaign.adSets) {
    const geo = adSet.targeting.geoLocations;
    if (geo.countries) {
      for (const c of geo.countries) {
        keys.add(c);
      }
    }
    if (geo.regions) {
      for (const r of geo.regions) {
        keys.add(r.key);
      }
    }
    if (geo.cities) {
      for (const c of geo.cities) {
        keys.add(c.key);
      }
    }
  }
  return keys;
}

// ─── Individual Field Comparators ───────────────────────────────────────────

function compareBudget(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planBudget = plan.lineItems.reduce((sum, li) => {
    const b = parseFloat(li.budget);
    return sum + (isNaN(b) ? 0 : b);
  }, 0);

  if (planBudget === 0) {
    return {
      field: "budget",
      status: "skipped",
      expected: "0",
      actual: "",
      message: "Plan budget is 0 or missing — skipped",
    };
  }

  let metaBudget = 0;
  for (const adSet of meta.adSets) {
    if (adSet.lifetimeBudget) {
      metaBudget += parseFloat(adSet.lifetimeBudget);
    } else if (adSet.dailyBudget && adSet.startTime && adSet.endTime) {
      const start = new Date(adSet.startTime).getTime();
      const end = new Date(adSet.endTime).getTime();
      const days = Math.max(
        1,
        Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
      );
      metaBudget += parseFloat(adSet.dailyBudget) * days;
    }
  }

  const diff = Math.abs(planBudget - metaBudget) / planBudget;
  const pass = diff <= 0.05;

  return {
    field: "budget",
    status: pass ? "pass" : "fail",
    expected: String(planBudget),
    actual: String(metaBudget),
    message: pass
      ? `Budget within tolerance (${(diff * 100).toFixed(1)}% difference)`
      : `Budget mismatch: plan=${planBudget}, meta=${metaBudget} (${(diff * 100).toFixed(1)}% difference, exceeds 5% tolerance)`,
  };
}

function compareStartDate(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planDates = plan.lineItems
    .map((li) => li.startDate)
    .filter(Boolean)
    .sort();
  const planEarliest = planDates.length > 0 ? parseDateOnly(planDates[0]) : "";

  const metaDates = meta.adSets
    .map((as) => as.startTime)
    .filter(Boolean)
    .sort();
  const metaEarliest =
    metaDates.length > 0 ? parseDateOnly(metaDates[0]) : "";

  if (!planEarliest) {
    return {
      field: "start_date",
      status: "skipped",
      expected: "",
      actual: metaEarliest,
      message: "No plan start date — skipped",
    };
  }

  const pass = planEarliest === metaEarliest;
  return {
    field: "start_date",
    status: pass ? "pass" : "fail",
    expected: planEarliest,
    actual: metaEarliest,
    message: pass
      ? "Start dates match"
      : `Start date mismatch: plan=${planEarliest}, meta=${metaEarliest}`,
  };
}

function compareEndDate(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planDates = plan.lineItems
    .map((li) => li.endDate)
    .filter(Boolean)
    .sort();
  const planLatest =
    planDates.length > 0 ? parseDateOnly(planDates[planDates.length - 1]) : "";

  const metaDates = meta.adSets
    .map((as) => as.endTime)
    .filter(Boolean)
    .sort();
  const metaLatest =
    metaDates.length > 0 ? parseDateOnly(metaDates[metaDates.length - 1]) : "";

  if (!planLatest) {
    return {
      field: "end_date",
      status: "skipped",
      expected: "",
      actual: metaLatest,
      message: "No plan end date — skipped",
    };
  }

  const pass = planLatest === metaLatest;
  return {
    field: "end_date",
    status: pass ? "pass" : "fail",
    expected: planLatest,
    actual: metaLatest,
    message: pass
      ? "End dates match"
      : `End date mismatch: plan=${planLatest}, meta=${metaLatest}`,
  };
}

function compareGeoTargeting(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planKeys = new Set(plan.resolvedGeoTargets.map((g) => g.key));
  const metaKeys = extractMetaGeoKeys(meta);

  if (planKeys.size === 0) {
    return {
      field: "geo_targeting",
      status: "skipped",
      expected: "",
      actual: [...metaKeys].join(", "),
      message: "No plan geo targets — skipped",
    };
  }

  const missingFromMeta: string[] = [];
  for (const k of planKeys) {
    if (!metaKeys.has(k)) {
      missingFromMeta.push(k);
    }
  }

  const extraInMeta: string[] = [];
  for (const k of metaKeys) {
    if (!planKeys.has(k)) {
      extraInMeta.push(k);
    }
  }

  let status: FieldComparison["status"];
  let message: string;

  if (missingFromMeta.length > 0) {
    status = "fail";
    message = `Plan geo keys missing from Meta: ${missingFromMeta.join(", ")}`;
  } else if (extraInMeta.length > 0) {
    status = "warning";
    message = `Meta has extra geo keys not in plan: ${extraInMeta.join(", ")}`;
  } else {
    status = "pass";
    message = "All plan geo keys present in Meta";
  }

  return {
    field: "geo_targeting",
    status,
    expected: [...planKeys].sort().join(", "),
    actual: [...metaKeys].sort().join(", "),
    message,
  };
}

function compareAgeRange(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planTargeting = plan.lineItemConfigs?.[0]?.targeting;

  if (!planTargeting) {
    return {
      field: "age_range",
      status: "skipped",
      expected: "",
      actual: "",
      message: "No plan targeting config — skipped",
    };
  }

  const firstAdSet = meta.adSets[0];
  const metaAgeMin = firstAdSet?.targeting.ageMin;
  const metaAgeMax = firstAdSet?.targeting.ageMax;

  const planStr = `${planTargeting.ageMin}-${planTargeting.ageMax}`;
  const metaStr =
    metaAgeMin !== undefined && metaAgeMax !== undefined
      ? `${metaAgeMin}-${metaAgeMax}`
      : "not set";

  const pass =
    planTargeting.ageMin === metaAgeMin &&
    planTargeting.ageMax === metaAgeMax;

  return {
    field: "age_range",
    status: pass ? "pass" : "fail",
    expected: planStr,
    actual: metaStr,
    message: pass
      ? "Age range matches"
      : `Age range mismatch: plan=${planStr}, meta=${metaStr}`,
  };
}

function compareGenders(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planTargeting = plan.lineItemConfigs?.[0]?.targeting;

  if (!planTargeting) {
    return {
      field: "genders",
      status: "skipped",
      expected: "",
      actual: "",
      message: "No plan targeting config — skipped",
    };
  }

  const firstAdSet = meta.adSets[0];
  const metaGenders = firstAdSet?.targeting.genders ?? [];
  const planGenders = planTargeting.genders;

  const planSorted = [...planGenders].sort().join(",");
  const metaSorted = [...metaGenders].sort().join(",");

  const pass = planSorted === metaSorted;

  return {
    field: "genders",
    status: pass ? "pass" : "fail",
    expected: planSorted,
    actual: metaSorted,
    message: pass
      ? "Genders match"
      : `Genders mismatch: plan=[${planSorted}], meta=[${metaSorted}]`,
  };
}

function compareFrequencyCap(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planFreq = plan.lineItems[0]?.avgFrequency;
  const planVal = planFreq ? parseFloat(planFreq) : NaN;

  if (isNaN(planVal)) {
    return {
      field: "frequency_cap",
      status: "skipped",
      expected: "",
      actual: "",
      message: "No plan frequency — skipped",
    };
  }

  const firstAdSet = meta.adSets[0];
  const metaVal =
    firstAdSet?.frequencyControlSpecs?.[0]?.maxFrequency ?? NaN;

  const pass = planVal === metaVal;

  return {
    field: "frequency_cap",
    status: pass ? "pass" : "fail",
    expected: String(planVal),
    actual: isNaN(metaVal) ? "not set" : String(metaVal),
    message: pass
      ? "Frequency cap matches"
      : `Frequency cap mismatch: plan=${planVal}, meta=${isNaN(metaVal) ? "not set" : metaVal}`,
  };
}

function comparePlacements(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planInventory = plan.lineItemConfigs?.[0]?.inventory;

  if (!planInventory) {
    return {
      field: "placements",
      status: "skipped",
      expected: "",
      actual: "",
      message: "No plan inventory config — skipped",
    };
  }

  const planPlatforms = new Set(
    planInventory.publisherPlatforms.map((p) => p.toLowerCase()),
  );
  const firstAdSet = meta.adSets[0];
  const metaPlatforms = new Set(
    (firstAdSet?.targeting.publisherPlatforms ?? []).map((p) =>
      p.toLowerCase(),
    ),
  );

  const missing: string[] = [];
  for (const p of planPlatforms) {
    if (!metaPlatforms.has(p)) {
      missing.push(p);
    }
  }

  const pass = missing.length === 0;

  return {
    field: "placements",
    status: pass ? "pass" : "fail",
    expected: [...planPlatforms].sort().join(", "),
    actual: [...metaPlatforms].sort().join(", "),
    message: pass
      ? "All plan platforms present in Meta"
      : `Plan platforms missing from Meta: ${missing.join(", ")}`,
  };
}

function compareObjective(
  plan: CampaignGroup,
  meta: MetaCampaignSnapshot,
): FieldComparison {
  const planObjective = plan.campaignBuyType?.objective;

  if (!planObjective) {
    return {
      field: "objective",
      status: "skipped",
      expected: "",
      actual: meta.objective,
      message: "No plan buy type — skipped",
    };
  }

  const pass =
    planObjective.toLowerCase() === meta.objective.toLowerCase();

  return {
    field: "objective",
    status: pass ? "pass" : "fail",
    expected: planObjective,
    actual: meta.objective,
    message: pass
      ? "Objective matches"
      : `Objective mismatch: plan=${planObjective}, meta=${meta.objective}`,
  };
}

// ─── Main Validator ─────────────────────────────────────────────────────────

/**
 * Validates a single matched plan campaign vs. live Meta campaign.
 * Does NOT run guardrail checks (those are handled separately).
 */
export function validateCampaignFields(
  planCampaign: CampaignGroup,
  metaCampaign: MetaCampaignSnapshot,
  matchConfidence: number,
): CampaignValidationResult {
  const fieldComparisons: FieldComparison[] = [
    compareBudget(planCampaign, metaCampaign),
    compareStartDate(planCampaign, metaCampaign),
    compareEndDate(planCampaign, metaCampaign),
    compareGeoTargeting(planCampaign, metaCampaign),
    compareAgeRange(planCampaign, metaCampaign),
    compareGenders(planCampaign, metaCampaign),
    compareFrequencyCap(planCampaign, metaCampaign),
    comparePlacements(planCampaign, metaCampaign),
    compareObjective(planCampaign, metaCampaign),
  ];

  const failCount = fieldComparisons.filter((c) => c.status === "fail").length;
  const warnCount = fieldComparisons.filter(
    (c) => c.status === "warning",
  ).length;

  let overallStatus: CampaignValidationResult["overallStatus"];
  if (failCount > 0) {
    overallStatus = "fail";
  } else if (warnCount > 0) {
    overallStatus = "warning";
  } else {
    overallStatus = "pass";
  }

  return {
    campaignGroupId: planCampaign.id ?? "",
    campaignGroupName: planCampaign.campaignName,
    metaCampaignId: metaCampaign.metaCampaignId,
    metaCampaignName: metaCampaign.name,
    matchConfidence,
    fieldComparisons,
    guardrailResults: [],
    overallStatus,
    failCount,
    warnCount,
  };
}
