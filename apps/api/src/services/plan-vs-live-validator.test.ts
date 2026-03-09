import { describe, it, expect } from "vitest";
import {
  validateCampaignFields,
  extractMetaGeoKeys,
  parseDateOnly,
} from "./plan-vs-live-validator";
import type {
  CampaignGroup,
  MetaCampaignSnapshot,
  MetaAdSetSnapshot,
  ExcelRow,
} from "@guardrails/shared";

// ─── Factories ──────────────────────────────────────────────────────────────

function makeLineItem(overrides: Partial<ExcelRow> = {}): ExcelRow {
  return {
    markets: "US",
    channel: "Meta",
    woa: "4",
    targeting: "18-65 M+F",
    buyType: "Auction",
    asset: "Video",
    inventory: "Feeds",
    totalReach: "100000",
    avgFrequency: "3",
    budget: "10000",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    campaignName: "Test Campaign",
    ...overrides,
  };
}

function makeAdSet(overrides: Partial<MetaAdSetSnapshot> = {}): MetaAdSetSnapshot {
  return {
    metaAdSetId: "adset_1",
    name: "Ad Set 1",
    status: "ACTIVE",
    startTime: "2026-06-01T00:00:00Z",
    endTime: "2026-06-30T00:00:00Z",
    lifetimeBudget: "10000",
    billingEvent: "IMPRESSIONS",
    targeting: {
      geoLocations: {
        countries: ["US"],
      },
      ageMin: 18,
      ageMax: 65,
      genders: [1, 2],
      publisherPlatforms: ["facebook", "instagram"],
    },
    frequencyControlSpecs: [
      { event: "IMPRESSIONS", intervalDays: 7, maxFrequency: 3 },
    ],
    ads: [],
    ...overrides,
  };
}

function makePlanCampaign(
  overrides: Partial<CampaignGroup> = {},
): CampaignGroup {
  return {
    id: "group_1",
    markets: "US",
    channel: "Meta",
    campaignName: "Test Campaign",
    lineItems: [makeLineItem()],
    geoIntents: [],
    resolvedGeoTargets: [
      {
        key: "US",
        name: "United States",
        type: "country",
        countryCode: "US",
        region: "",
        regionId: 0,
        supportsRegion: true,
        supportsCity: true,
      },
    ],
    unresolvedIntents: [],
    lineItemConfigs: [
      {
        targeting: {
          ageMin: 18,
          ageMax: 65,
          genders: [1, 2],
          raw: "18-65 M+F",
        },
        buyType: {
          objective: "OUTCOME_AWARENESS",
          buyingType: "AUCTION",
          raw: "Auction",
        },
        inventory: {
          publisherPlatforms: ["facebook", "instagram"],
          raw: "Feeds",
        },
        warnings: [],
      },
    ],
    campaignBuyType: {
      objective: "OUTCOME_AWARENESS",
      buyingType: "AUCTION",
      raw: "Auction",
    },
    status: "resolved",
    ...overrides,
  };
}

function makeMetaCampaign(
  overrides: Partial<MetaCampaignSnapshot> = {},
): MetaCampaignSnapshot {
  return {
    id: "snap_1",
    uploadId: "upload_1",
    metaCampaignId: "meta_camp_1",
    name: "Test Campaign",
    status: "ACTIVE",
    objective: "OUTCOME_AWARENESS",
    buyingType: "AUCTION",
    adSets: [makeAdSet()],
    fetchedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

// ─── parseDateOnly ──────────────────────────────────────────────────────────

describe("parseDateOnly", () => {
  it("extracts YYYY-MM-DD from ISO string", () => {
    expect(parseDateOnly("2026-06-01T12:34:56Z")).toBe("2026-06-01");
  });

  it("extracts YYYY-MM-DD from date-only string", () => {
    expect(parseDateOnly("2026-06-01")).toBe("2026-06-01");
  });
});

// ─── extractMetaGeoKeys ─────────────────────────────────────────────────────

describe("extractMetaGeoKeys", () => {
  it("extracts countries, regions, and cities", () => {
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          targeting: {
            geoLocations: {
              countries: ["US"],
              regions: [{ key: "CA", name: "California" }],
              cities: [{ key: "SF", name: "San Francisco" }],
            },
            publisherPlatforms: [],
          },
        }),
      ],
    });
    const keys = extractMetaGeoKeys(meta);
    expect(keys).toEqual(new Set(["US", "CA", "SF"]));
  });
});

// ─── Budget ─────────────────────────────────────────────────────────────────

describe("budget comparison", () => {
  it("passes when within 5% tolerance", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ budget: "10000" })],
    });
    const meta = makeMetaCampaign({
      adSets: [makeAdSet({ lifetimeBudget: "10400" })],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const budget = result.fieldComparisons.find((c) => c.field === "budget")!;
    expect(budget.status).toBe("pass");
  });

  it("fails when over 5% tolerance", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ budget: "10000" })],
    });
    const meta = makeMetaCampaign({
      adSets: [makeAdSet({ lifetimeBudget: "15000" })],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const budget = result.fieldComparisons.find((c) => c.field === "budget")!;
    expect(budget.status).toBe("fail");
  });

  it("skips when plan budget is 0", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ budget: "0" })],
    });
    const meta = makeMetaCampaign();
    const result = validateCampaignFields(plan, meta, 0.9);
    const budget = result.fieldComparisons.find((c) => c.field === "budget")!;
    expect(budget.status).toBe("skipped");
  });

  it("skips when plan budget is missing", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ budget: "" })],
    });
    const meta = makeMetaCampaign();
    const result = validateCampaignFields(plan, meta, 0.9);
    const budget = result.fieldComparisons.find((c) => c.field === "budget")!;
    expect(budget.status).toBe("skipped");
  });

  it("calculates daily budget * days when no lifetime budget", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ budget: "30000" })],
    });
    // 30 days * 1000/day = 30000
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          lifetimeBudget: undefined,
          dailyBudget: "1000",
          startTime: "2026-06-01T00:00:00Z",
          endTime: "2026-07-01T00:00:00Z",
        }),
      ],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const budget = result.fieldComparisons.find((c) => c.field === "budget")!;
    expect(budget.status).toBe("pass");
  });
});

// ─── Start Date ─────────────────────────────────────────────────────────────

describe("start_date comparison", () => {
  it("passes when dates match", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ startDate: "2026-06-01" })],
    });
    const meta = makeMetaCampaign({
      adSets: [makeAdSet({ startTime: "2026-06-01T10:00:00Z" })],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "start_date",
    )!;
    expect(field.status).toBe("pass");
  });

  it("fails when dates mismatch", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ startDate: "2026-06-01" })],
    });
    const meta = makeMetaCampaign({
      adSets: [makeAdSet({ startTime: "2026-06-05T00:00:00Z" })],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "start_date",
    )!;
    expect(field.status).toBe("fail");
  });
});

// ─── End Date ───────────────────────────────────────────────────────────────

describe("end_date comparison", () => {
  it("passes when dates match", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ endDate: "2026-06-30" })],
    });
    const meta = makeMetaCampaign({
      adSets: [makeAdSet({ endTime: "2026-06-30T23:59:00Z" })],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "end_date",
    )!;
    expect(field.status).toBe("pass");
  });

  it("fails when dates mismatch", () => {
    const plan = makePlanCampaign({
      lineItems: [makeLineItem({ endDate: "2026-06-30" })],
    });
    const meta = makeMetaCampaign({
      adSets: [makeAdSet({ endTime: "2026-07-15T00:00:00Z" })],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "end_date",
    )!;
    expect(field.status).toBe("fail");
  });
});

// ─── Geo Targeting ──────────────────────────────────────────────────────────

describe("geo_targeting comparison", () => {
  it("passes when plan is subset of meta", () => {
    const plan = makePlanCampaign({
      resolvedGeoTargets: [
        {
          key: "US",
          name: "United States",
          type: "country",
          countryCode: "US",
          region: "",
          regionId: 0,
          supportsRegion: true,
          supportsCity: true,
        },
      ],
    });
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          targeting: {
            geoLocations: { countries: ["US"] },
            publisherPlatforms: ["facebook"],
          },
        }),
      ],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "geo_targeting",
    )!;
    expect(field.status).toBe("pass");
  });

  it("fails when plan keys missing from meta", () => {
    const plan = makePlanCampaign({
      resolvedGeoTargets: [
        {
          key: "US",
          name: "United States",
          type: "country",
          countryCode: "US",
          region: "",
          regionId: 0,
          supportsRegion: true,
          supportsCity: true,
        },
        {
          key: "CA",
          name: "Canada",
          type: "country",
          countryCode: "CA",
          region: "",
          regionId: 0,
          supportsRegion: true,
          supportsCity: true,
        },
      ],
    });
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          targeting: {
            geoLocations: { countries: ["US"] },
            publisherPlatforms: ["facebook"],
          },
        }),
      ],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "geo_targeting",
    )!;
    expect(field.status).toBe("fail");
  });

  it("warns when meta has extra keys", () => {
    const plan = makePlanCampaign({
      resolvedGeoTargets: [
        {
          key: "US",
          name: "United States",
          type: "country",
          countryCode: "US",
          region: "",
          regionId: 0,
          supportsRegion: true,
          supportsCity: true,
        },
      ],
    });
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          targeting: {
            geoLocations: { countries: ["US", "GB"] },
            publisherPlatforms: ["facebook"],
          },
        }),
      ],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "geo_targeting",
    )!;
    expect(field.status).toBe("warning");
  });
});

// ─── Age Range ──────────────────────────────────────────────────────────────

describe("age_range comparison", () => {
  it("passes when age range matches", () => {
    const result = validateCampaignFields(
      makePlanCampaign(),
      makeMetaCampaign(),
      0.9,
    );
    const field = result.fieldComparisons.find(
      (c) => c.field === "age_range",
    )!;
    expect(field.status).toBe("pass");
  });

  it("fails when age range mismatches", () => {
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          targeting: {
            geoLocations: { countries: ["US"] },
            ageMin: 25,
            ageMax: 45,
            genders: [1, 2],
            publisherPlatforms: ["facebook", "instagram"],
          },
        }),
      ],
    });
    const result = validateCampaignFields(makePlanCampaign(), meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "age_range",
    )!;
    expect(field.status).toBe("fail");
  });

  it("skips when no plan targeting config", () => {
    const plan = makePlanCampaign({ lineItemConfigs: [{ warnings: [] }] });
    const result = validateCampaignFields(plan, makeMetaCampaign(), 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "age_range",
    )!;
    expect(field.status).toBe("skipped");
  });
});

// ─── Genders ────────────────────────────────────────────────────────────────

describe("genders comparison", () => {
  it("passes when genders match", () => {
    const result = validateCampaignFields(
      makePlanCampaign(),
      makeMetaCampaign(),
      0.9,
    );
    const field = result.fieldComparisons.find(
      (c) => c.field === "genders",
    )!;
    expect(field.status).toBe("pass");
  });

  it("fails when genders mismatch", () => {
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          targeting: {
            geoLocations: { countries: ["US"] },
            ageMin: 18,
            ageMax: 65,
            genders: [1],
            publisherPlatforms: ["facebook", "instagram"],
          },
        }),
      ],
    });
    const result = validateCampaignFields(makePlanCampaign(), meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "genders",
    )!;
    expect(field.status).toBe("fail");
  });
});

// ─── Frequency Cap ──────────────────────────────────────────────────────────

describe("frequency_cap comparison", () => {
  it("passes when frequency matches", () => {
    const result = validateCampaignFields(
      makePlanCampaign(),
      makeMetaCampaign(),
      0.9,
    );
    const field = result.fieldComparisons.find(
      (c) => c.field === "frequency_cap",
    )!;
    expect(field.status).toBe("pass");
  });

  it("fails when frequency mismatches", () => {
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          frequencyControlSpecs: [
            { event: "IMPRESSIONS", intervalDays: 7, maxFrequency: 5 },
          ],
        }),
      ],
    });
    const result = validateCampaignFields(makePlanCampaign(), meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "frequency_cap",
    )!;
    expect(field.status).toBe("fail");
  });
});

// ─── Placements ─────────────────────────────────────────────────────────────

describe("placements comparison", () => {
  it("passes when all plan platforms present in meta", () => {
    const result = validateCampaignFields(
      makePlanCampaign(),
      makeMetaCampaign(),
      0.9,
    );
    const field = result.fieldComparisons.find(
      (c) => c.field === "placements",
    )!;
    expect(field.status).toBe("pass");
  });

  it("fails when plan platform missing from meta", () => {
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          targeting: {
            geoLocations: { countries: ["US"] },
            ageMin: 18,
            ageMax: 65,
            genders: [1, 2],
            publisherPlatforms: ["facebook"],
          },
        }),
      ],
    });
    const result = validateCampaignFields(makePlanCampaign(), meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "placements",
    )!;
    expect(field.status).toBe("fail");
  });
});

// ─── Objective ──────────────────────────────────────────────────────────────

describe("objective comparison", () => {
  it("passes when objective matches (case-insensitive)", () => {
    const meta = makeMetaCampaign({ objective: "outcome_awareness" });
    const result = validateCampaignFields(makePlanCampaign(), meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "objective",
    )!;
    expect(field.status).toBe("pass");
  });

  it("fails when objective mismatches", () => {
    const meta = makeMetaCampaign({ objective: "CONVERSIONS" });
    const result = validateCampaignFields(makePlanCampaign(), meta, 0.9);
    const field = result.fieldComparisons.find(
      (c) => c.field === "objective",
    )!;
    expect(field.status).toBe("fail");
  });
});

// ─── Overall Status Aggregation ─────────────────────────────────────────────

describe("overall status aggregation", () => {
  it("returns pass when all fields pass or are skipped", () => {
    const result = validateCampaignFields(
      makePlanCampaign(),
      makeMetaCampaign(),
      0.9,
    );
    expect(result.overallStatus).toBe("pass");
    expect(result.failCount).toBe(0);
    expect(result.warnCount).toBe(0);
    expect(result.guardrailResults).toEqual([]);
  });

  it("returns fail when any field fails", () => {
    const meta = makeMetaCampaign({
      adSets: [makeAdSet({ lifetimeBudget: "99999" })],
    });
    const result = validateCampaignFields(makePlanCampaign(), meta, 0.9);
    expect(result.overallStatus).toBe("fail");
    expect(result.failCount).toBeGreaterThan(0);
  });

  it("returns warning when any field warns but none fail", () => {
    // Plan has US only, Meta has US + GB → warning on geo, all else matches
    const plan = makePlanCampaign({
      resolvedGeoTargets: [
        {
          key: "US",
          name: "United States",
          type: "country",
          countryCode: "US",
          region: "",
          regionId: 0,
          supportsRegion: true,
          supportsCity: true,
        },
      ],
    });
    const meta = makeMetaCampaign({
      adSets: [
        makeAdSet({
          targeting: {
            geoLocations: { countries: ["US", "GB"] },
            ageMin: 18,
            ageMax: 65,
            genders: [1, 2],
            publisherPlatforms: ["facebook", "instagram"],
          },
        }),
      ],
    });
    const result = validateCampaignFields(plan, meta, 0.9);
    expect(result.overallStatus).toBe("warning");
    expect(result.warnCount).toBeGreaterThan(0);
    expect(result.failCount).toBe(0);
  });

  it("includes matchConfidence and campaign identifiers", () => {
    const result = validateCampaignFields(
      makePlanCampaign(),
      makeMetaCampaign(),
      0.85,
    );
    expect(result.matchConfidence).toBe(0.85);
    expect(result.campaignGroupId).toBe("group_1");
    expect(result.metaCampaignId).toBe("meta_camp_1");
  });
});
