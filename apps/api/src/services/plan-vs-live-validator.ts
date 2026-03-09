import type {
  CampaignGroup,
  MetaCampaignSnapshot,
  MetaAdSetSnapshot,
  FieldComparison,
  CampaignValidationResult,
  LineItemValidationResult,
  ExcelRow,
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
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const planEarliest = planDates.length > 0 ? parseDateOnly(planDates[0]) : "";

  const metaDates = meta.adSets
    .map((as) => as.startTime)
    .filter(Boolean)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
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
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const planLatest =
    planDates.length > 0 ? parseDateOnly(planDates[planDates.length - 1]) : "";

  const metaDates = meta.adSets
    .map((as) => as.endTime)
    .filter(Boolean)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
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

  const pass = !isNaN(metaVal) && Math.abs(planVal - metaVal) < 0.01;

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

// ─── Line-Item-Level Validation (1:N Strategy) ─────────────────────────────

function compareLineItemBudget(
  lineItem: ExcelRow,
  adSet: MetaAdSetSnapshot,
): FieldComparison {
  const planBudget = parseFloat(lineItem.budget);

  if (isNaN(planBudget) || planBudget === 0) {
    return {
      field: "budget",
      status: "skipped",
      expected: lineItem.budget || "0",
      actual: "",
      message: "Line item budget is 0 or missing — skipped",
    };
  }

  let metaBudget = 0;
  if (adSet.lifetimeBudget) {
    metaBudget = parseFloat(adSet.lifetimeBudget);
  } else if (adSet.dailyBudget && adSet.startTime && adSet.endTime) {
    const start = new Date(adSet.startTime).getTime();
    const end = new Date(adSet.endTime).getTime();
    const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    metaBudget = parseFloat(adSet.dailyBudget) * days;
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

function compareLineItemStartDate(
  lineItem: ExcelRow,
  adSet: MetaAdSetSnapshot,
): FieldComparison {
  if (!lineItem.startDate) {
    return {
      field: "start_date",
      status: "skipped",
      expected: "",
      actual: adSet.startTime ? parseDateOnly(adSet.startTime) : "",
      message: "No line item start date — skipped",
    };
  }

  const planDate = parseDateOnly(lineItem.startDate);
  const metaDate = adSet.startTime ? parseDateOnly(adSet.startTime) : "";
  const pass = planDate === metaDate;

  return {
    field: "start_date",
    status: pass ? "pass" : "fail",
    expected: planDate,
    actual: metaDate,
    message: pass
      ? "Start dates match"
      : `Start date mismatch: plan=${planDate}, meta=${metaDate}`,
  };
}

function compareLineItemEndDate(
  lineItem: ExcelRow,
  adSet: MetaAdSetSnapshot,
): FieldComparison {
  if (!lineItem.endDate) {
    return {
      field: "end_date",
      status: "skipped",
      expected: "",
      actual: adSet.endTime ? parseDateOnly(adSet.endTime) : "",
      message: "No line item end date — skipped",
    };
  }

  const planDate = parseDateOnly(lineItem.endDate);
  const metaDate = adSet.endTime ? parseDateOnly(adSet.endTime) : "";
  const pass = planDate === metaDate;

  return {
    field: "end_date",
    status: pass ? "pass" : "fail",
    expected: planDate,
    actual: metaDate,
    message: pass
      ? "End dates match"
      : `End date mismatch: plan=${planDate}, meta=${metaDate}`,
  };
}

function extractAdSetGeoKeys(adSet: MetaAdSetSnapshot): Set<string> {
  const keys = new Set<string>();
  const geo = adSet.targeting.geoLocations;
  if (geo.countries) {
    for (const c of geo.countries) keys.add(c);
  }
  if (geo.regions) {
    for (const r of geo.regions) keys.add(r.key);
  }
  if (geo.cities) {
    for (const c of geo.cities) keys.add(c.key);
  }
  return keys;
}

function compareLineItemGeoTargeting(
  planGroup: CampaignGroup,
  adSet: MetaAdSetSnapshot,
): FieldComparison {
  const planKeys = new Set(planGroup.resolvedGeoTargets.map((g) => g.key));
  const metaKeys = extractAdSetGeoKeys(adSet);

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
    if (!metaKeys.has(k)) missingFromMeta.push(k);
  }

  const extraInMeta: string[] = [];
  for (const k of metaKeys) {
    if (!planKeys.has(k)) extraInMeta.push(k);
  }

  let status: FieldComparison["status"];
  let message: string;

  if (missingFromMeta.length > 0) {
    status = "fail";
    message = `Plan geo keys missing from Meta ad set: ${missingFromMeta.join(", ")}`;
  } else if (extraInMeta.length > 0) {
    status = "warning";
    message = `Meta ad set has extra geo keys not in plan: ${extraInMeta.join(", ")}`;
  } else {
    status = "pass";
    message = "All plan geo keys present in Meta ad set";
  }

  return {
    field: "geo_targeting",
    status,
    expected: [...planKeys].sort().join(", "),
    actual: [...metaKeys].sort().join(", "),
    message,
  };
}

function compareLineItemAgeRange(
  planGroup: CampaignGroup,
  lineItemIndex: number,
  adSet: MetaAdSetSnapshot,
): FieldComparison {
  const planTargeting = planGroup.lineItemConfigs?.[lineItemIndex]?.targeting;

  if (!planTargeting) {
    return {
      field: "age_range",
      status: "skipped",
      expected: "",
      actual: "",
      message: "No plan targeting config — skipped",
    };
  }

  const metaAgeMin = adSet.targeting.ageMin;
  const metaAgeMax = adSet.targeting.ageMax;

  const planStr = `${planTargeting.ageMin}-${planTargeting.ageMax}`;
  const metaStr =
    metaAgeMin !== undefined && metaAgeMax !== undefined
      ? `${metaAgeMin}-${metaAgeMax}`
      : "not set";

  const pass = planTargeting.ageMin === metaAgeMin && planTargeting.ageMax === metaAgeMax;

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

function compareLineItemGenders(
  planGroup: CampaignGroup,
  lineItemIndex: number,
  adSet: MetaAdSetSnapshot,
): FieldComparison {
  const planTargeting = planGroup.lineItemConfigs?.[lineItemIndex]?.targeting;

  if (!planTargeting) {
    return {
      field: "genders",
      status: "skipped",
      expected: "",
      actual: "",
      message: "No plan targeting config — skipped",
    };
  }

  const metaGenders = adSet.targeting.genders ?? [];
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

function compareLineItemFrequencyCap(
  lineItem: ExcelRow,
  adSet: MetaAdSetSnapshot,
): FieldComparison {
  const planVal = lineItem.avgFrequency ? parseFloat(lineItem.avgFrequency) : NaN;

  if (isNaN(planVal)) {
    return {
      field: "frequency_cap",
      status: "skipped",
      expected: "",
      actual: "",
      message: "No plan frequency — skipped",
    };
  }

  const metaVal = adSet.frequencyControlSpecs?.[0]?.maxFrequency ?? NaN;

  const pass = !isNaN(metaVal) && Math.abs(planVal - metaVal) < 0.01;

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

function compareLineItemPlacements(
  planGroup: CampaignGroup,
  lineItemIndex: number,
  adSet: MetaAdSetSnapshot,
): FieldComparison {
  const planInventory = planGroup.lineItemConfigs?.[lineItemIndex]?.inventory;

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
  const metaPlatforms = new Set(
    (adSet.targeting.publisherPlatforms ?? []).map((p) => p.toLowerCase()),
  );

  const missing: string[] = [];
  for (const p of planPlatforms) {
    if (!metaPlatforms.has(p)) missing.push(p);
  }

  const pass = missing.length === 0;

  return {
    field: "placements",
    status: pass ? "pass" : "fail",
    expected: [...planPlatforms].sort().join(", "),
    actual: [...metaPlatforms].sort().join(", "),
    message: pass
      ? "All plan platforms present in Meta ad set"
      : `Plan platforms missing from Meta ad set: ${missing.join(", ")}`,
  };
}

/**
 * Validates a single line item against a single ad set (1:N strategy).
 */
export function validateLineItemFields(
  lineItem: ExcelRow,
  lineItemIndex: number,
  adSet: MetaAdSetSnapshot,
  planGroup: CampaignGroup,
): LineItemValidationResult {
  const fieldComparisons: FieldComparison[] = [
    compareLineItemBudget(lineItem, adSet),
    compareLineItemStartDate(lineItem, adSet),
    compareLineItemEndDate(lineItem, adSet),
    compareLineItemGeoTargeting(planGroup, adSet),
    compareLineItemAgeRange(planGroup, lineItemIndex, adSet),
    compareLineItemGenders(planGroup, lineItemIndex, adSet),
    compareLineItemFrequencyCap(lineItem, adSet),
    compareLineItemPlacements(planGroup, lineItemIndex, adSet),
  ];

  const failCount = fieldComparisons.filter((c) => c.status === "fail").length;
  const warnCount = fieldComparisons.filter((c) => c.status === "warning").length;

  let overallStatus: LineItemValidationResult["overallStatus"];
  if (failCount > 0) {
    overallStatus = "fail";
  } else if (warnCount > 0) {
    overallStatus = "warning";
  } else {
    overallStatus = "pass";
  }

  return {
    lineItemIndex,
    lineItemName: lineItem.campaignName,
    metaAdSetId: adSet.metaAdSetId,
    metaAdSetName: adSet.name,
    fieldComparisons,
    overallStatus,
    failCount,
    warnCount,
  };
}

/**
 * Validates a plan campaign vs a Meta campaign using 1:N strategy.
 * Campaign-level checks only objective; budget/dates/targeting are per ad set.
 */
export function validateCampaignFieldsOneToMany(
  planCampaign: CampaignGroup,
  metaCampaign: MetaCampaignSnapshot,
  matchConfidence: number,
  lineItemMatches: Array<{ lineItemIndex: number; metaAdSetId: string }>,
): CampaignValidationResult {
  // Campaign-level: only objective
  const campaignFieldComparisons: FieldComparison[] = [
    compareObjective(planCampaign, metaCampaign),
  ];

  // Build ad set lookup
  const adSetMap = new Map(
    metaCampaign.adSets.map((as) => [as.metaAdSetId, as]),
  );

  // Per-line-item validation
  const lineItemResults: LineItemValidationResult[] = [];
  for (const lim of lineItemMatches) {
    const lineItem = planCampaign.lineItems[lim.lineItemIndex];
    const adSet = adSetMap.get(lim.metaAdSetId);
    if (!lineItem || !adSet) continue;

    lineItemResults.push(
      validateLineItemFields(lineItem, lim.lineItemIndex, adSet, planCampaign),
    );
  }

  // Aggregate: campaign-level + line-item-level
  const campaignFailCount = campaignFieldComparisons.filter((c) => c.status === "fail").length;
  const campaignWarnCount = campaignFieldComparisons.filter((c) => c.status === "warning").length;
  const lineItemFailCount = lineItemResults.filter((r) => r.overallStatus === "fail").length;
  const lineItemWarnCount = lineItemResults.filter((r) => r.overallStatus === "warning").length;

  const totalFailCount = campaignFailCount + lineItemFailCount;
  const totalWarnCount = campaignWarnCount + lineItemWarnCount;

  let overallStatus: CampaignValidationResult["overallStatus"];
  if (totalFailCount > 0) {
    overallStatus = "fail";
  } else if (totalWarnCount > 0) {
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
    fieldComparisons: campaignFieldComparisons,
    guardrailResults: [],
    overallStatus,
    failCount: totalFailCount,
    warnCount: totalWarnCount,
    lineItemResults,
  };
}
