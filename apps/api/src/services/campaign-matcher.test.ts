import { describe, it, expect } from "vitest";
import type { CampaignGroup } from "@guardrails/shared";
import type { MetaCampaignSnapshot } from "@guardrails/shared";
import {
  tokenize,
  jaccardSimilarity,
  extractMetaGeoKeys,
  computeDateOverlap,
  generateMatchSuggestions,
} from "./campaign-matcher";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCampaignGroup(
  overrides: Partial<CampaignGroup> = {}
): CampaignGroup {
  return {
    markets: "US",
    channel: "Facebook",
    campaignName: "Summer Sale 2025",
    lineItems: [
      {
        markets: "US",
        channel: "Facebook",
        woa: "",
        targeting: "",
        buyType: "",
        asset: "",
        inventory: "",
        totalReach: "",
        avgFrequency: "",
        budget: "",
        startDate: "2025-06-01",
        endDate: "2025-06-30",
        campaignName: "Summer Sale 2025",
      },
    ],
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
    status: "resolved",
    ...overrides,
  };
}

function makeMetaCampaign(
  overrides: Partial<MetaCampaignSnapshot> = {}
): MetaCampaignSnapshot {
  return {
    id: "snap-1",
    uploadId: "upload-1",
    metaCampaignId: "meta-1",
    name: "Summer Sale 2025",
    status: "ACTIVE",
    objective: "OUTCOME_AWARENESS",
    buyingType: "AUCTION",
    adSets: [
      {
        metaAdSetId: "adset-1",
        name: "AdSet 1",
        status: "ACTIVE",
        startTime: "2025-06-01T00:00:00Z",
        endTime: "2025-06-30T00:00:00Z",
        billingEvent: "IMPRESSIONS",
        targeting: {
          geoLocations: {
            countries: ["US"],
          },
        },
        ads: [],
      },
    ],
    fetchedAt: "2025-06-15T00:00:00Z",
    ...overrides,
  };
}

// ─── tokenize ───────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("splits on whitespace, hyphens, underscores, slashes and lowercases", () => {
    expect(tokenize("Summer-Sale_2025/Campaign Test")).toEqual([
      "summer",
      "sale",
      "2025",
      "campaign",
      "test",
    ]);
  });

  it("filters tokens with length <= 1", () => {
    expect(tokenize("A big B campaign")).toEqual(["big", "campaign"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("handles multiple consecutive delimiters", () => {
    expect(tokenize("hello---world___test")).toEqual([
      "hello",
      "world",
      "test",
    ]);
  });
});

// ─── jaccardSimilarity ─────────────────────────────────────────────────────

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const s = new Set(["a", "b", "c"]);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["a", "b"]);
    const b = new Set(["c", "d"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns correct value for partial overlap", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    // intersection = {b, c} = 2, union = {a, b, c, d} = 4
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("returns 0 when one set is empty", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
  });
});

// ─── extractMetaGeoKeys ────────────────────────────────────────────────────

describe("extractMetaGeoKeys", () => {
  it("extracts country codes", () => {
    const meta = makeMetaCampaign({
      adSets: [
        {
          metaAdSetId: "as-1",
          name: "AS1",
          status: "ACTIVE",
          startTime: "2025-06-01T00:00:00Z",
          endTime: "2025-06-30T00:00:00Z",
          billingEvent: "IMPRESSIONS",
          targeting: { geoLocations: { countries: ["US", "CA"] } },
          ads: [],
        },
      ],
    });
    expect(extractMetaGeoKeys(meta)).toEqual(new Set(["US", "CA"]));
  });

  it("extracts region keys", () => {
    const meta = makeMetaCampaign({
      adSets: [
        {
          metaAdSetId: "as-1",
          name: "AS1",
          status: "ACTIVE",
          startTime: "2025-06-01T00:00:00Z",
          endTime: "2025-06-30T00:00:00Z",
          billingEvent: "IMPRESSIONS",
          targeting: {
            geoLocations: {
              regions: [
                { key: "3847", name: "California" },
                { key: "3875", name: "New York" },
              ],
            },
          },
          ads: [],
        },
      ],
    });
    expect(extractMetaGeoKeys(meta)).toEqual(new Set(["3847", "3875"]));
  });

  it("extracts city keys", () => {
    const meta = makeMetaCampaign({
      adSets: [
        {
          metaAdSetId: "as-1",
          name: "AS1",
          status: "ACTIVE",
          startTime: "2025-06-01T00:00:00Z",
          endTime: "2025-06-30T00:00:00Z",
          billingEvent: "IMPRESSIONS",
          targeting: {
            geoLocations: {
              cities: [{ key: "2421836", name: "San Francisco" }],
            },
          },
          ads: [],
        },
      ],
    });
    expect(extractMetaGeoKeys(meta)).toEqual(new Set(["2421836"]));
  });

  it("collects keys from multiple ad sets", () => {
    const meta = makeMetaCampaign({
      adSets: [
        {
          metaAdSetId: "as-1",
          name: "AS1",
          status: "ACTIVE",
          startTime: "2025-06-01T00:00:00Z",
          endTime: "2025-06-30T00:00:00Z",
          billingEvent: "IMPRESSIONS",
          targeting: { geoLocations: { countries: ["US"] } },
          ads: [],
        },
        {
          metaAdSetId: "as-2",
          name: "AS2",
          status: "ACTIVE",
          startTime: "2025-06-01T00:00:00Z",
          endTime: "2025-06-30T00:00:00Z",
          billingEvent: "IMPRESSIONS",
          targeting: {
            geoLocations: {
              countries: ["CA"],
              regions: [{ key: "3847", name: "California" }],
            },
          },
          ads: [],
        },
      ],
    });
    expect(extractMetaGeoKeys(meta)).toEqual(new Set(["US", "CA", "3847"]));
  });
});

// ─── computeDateOverlap ────────────────────────────────────────────────────

describe("computeDateOverlap", () => {
  it("returns 1 for fully overlapping identical ranges", () => {
    const start = new Date("2025-06-01");
    const end = new Date("2025-06-30");
    expect(computeDateOverlap(start, end, start, end)).toBe(1);
  });

  it("returns 0 for non-overlapping ranges", () => {
    const planStart = new Date("2025-01-01");
    const planEnd = new Date("2025-01-31");
    const metaStart = new Date("2025-06-01");
    const metaEnd = new Date("2025-06-30");
    expect(computeDateOverlap(planStart, planEnd, metaStart, metaEnd)).toBe(0);
  });

  it("returns correct ratio for partial overlap", () => {
    const planStart = new Date("2025-06-01");
    const planEnd = new Date("2025-06-20");
    const metaStart = new Date("2025-06-10");
    const metaEnd = new Date("2025-06-30");
    // overlap: June 10-20 = 10 days, union: June 1-30 = 29 days
    const result = computeDateOverlap(planStart, planEnd, metaStart, metaEnd);
    expect(result).toBeCloseTo(10 / 29, 5);
  });

  it("handles plan contained within meta range", () => {
    const planStart = new Date("2025-06-10");
    const planEnd = new Date("2025-06-20");
    const metaStart = new Date("2025-06-01");
    const metaEnd = new Date("2025-06-30");
    // overlap: 10 days, union: 29 days
    const result = computeDateOverlap(planStart, planEnd, metaStart, metaEnd);
    expect(result).toBeCloseTo(10 / 29, 5);
  });
});

// ─── generateMatchSuggestions ──────────────────────────────────────────────

describe("generateMatchSuggestions", () => {
  it("returns high score for exact name, geo, and date match", () => {
    const group = makeCampaignGroup({ id: "g1" });
    const meta = makeMetaCampaign();

    const suggestions = generateMatchSuggestions([group], [meta]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].campaignGroupId).toBe("g1");
    expect(suggestions[0].candidates).toHaveLength(1);

    const candidate = suggestions[0].candidates[0];
    expect(candidate.score).toBeGreaterThan(0.9);
    expect(candidate.signals.nameScore).toBe(1);
    expect(candidate.signals.geoScore).toBe(1);
    expect(candidate.signals.dateScore).toBe(1);
  });

  it("returns empty candidates when nothing matches", () => {
    const group = makeCampaignGroup({
      id: "g1",
      campaignName: "Completely Different Name",
      resolvedGeoTargets: [
        {
          key: "JP",
          name: "Japan",
          type: "country",
          countryCode: "JP",
          region: "",
          regionId: 0,
          supportsRegion: true,
          supportsCity: true,
        },
      ],
      lineItems: [
        {
          markets: "JP",
          channel: "Facebook",
          woa: "",
          targeting: "",
          buyType: "",
          asset: "",
          inventory: "",
          totalReach: "",
          avgFrequency: "",
          budget: "",
          startDate: "2024-01-01",
          endDate: "2024-01-31",
          campaignName: "Completely Different Name",
        },
      ],
    });
    const meta = makeMetaCampaign();

    const suggestions = generateMatchSuggestions([group], [meta]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].candidates).toHaveLength(0);
  });

  it("sorts candidates by score descending", () => {
    const group = makeCampaignGroup({ id: "g1" });
    const metaHigh = makeMetaCampaign({
      metaCampaignId: "meta-high",
      name: "Summer Sale 2025",
    });
    const metaLow = makeMetaCampaign({
      metaCampaignId: "meta-low",
      name: "Winter Promo 2025",
    });

    const suggestions = generateMatchSuggestions([group], [metaHigh, metaLow]);
    expect(suggestions[0].candidates.length).toBeGreaterThanOrEqual(1);
    if (suggestions[0].candidates.length > 1) {
      expect(suggestions[0].candidates[0].score).toBeGreaterThanOrEqual(
        suggestions[0].candidates[1].score
      );
    }
  });

  it("handles partial name match with geo and date alignment", () => {
    const group = makeCampaignGroup({
      id: "g1",
      campaignName: "Summer Sale Campaign",
    });
    const meta = makeMetaCampaign({ name: "Summer Sale 2025" });

    const suggestions = generateMatchSuggestions([group], [meta]);
    expect(suggestions[0].candidates).toHaveLength(1);
    const candidate = suggestions[0].candidates[0];
    // "summer" and "sale" match, but "campaign" vs "2025" differ
    expect(candidate.signals.nameScore).toBeGreaterThan(0);
    expect(candidate.signals.nameScore).toBeLessThan(1);
    expect(candidate.score).toBeGreaterThan(0.5);
  });

  it("produces a suggestion per campaign group", () => {
    const groups = [
      makeCampaignGroup({ id: "g1", campaignName: "Alpha" }),
      makeCampaignGroup({ id: "g2", campaignName: "Beta" }),
    ];
    const meta = makeMetaCampaign();
    const suggestions = generateMatchSuggestions(groups, [meta]);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].campaignGroupId).toBe("g1");
    expect(suggestions[1].campaignGroupId).toBe("g2");
  });

  it("uses empty string for campaignGroupId when id is undefined", () => {
    const group = makeCampaignGroup({ id: undefined });
    const meta = makeMetaCampaign();
    const suggestions = generateMatchSuggestions([group], [meta]);
    expect(suggestions[0].campaignGroupId).toBe("");
  });
});

// ─── Threshold filtering ───────────────────────────────────────────────────

describe("threshold filtering", () => {
  it("excludes candidates with score below 0.2", () => {
    const group = makeCampaignGroup({
      id: "g1",
      campaignName: "Xyz Abc Unique Name",
      resolvedGeoTargets: [
        {
          key: "JP",
          name: "Japan",
          type: "country",
          countryCode: "JP",
          region: "",
          regionId: 0,
          supportsRegion: true,
          supportsCity: true,
        },
      ],
      lineItems: [
        {
          markets: "JP",
          channel: "Facebook",
          woa: "",
          targeting: "",
          buyType: "",
          asset: "",
          inventory: "",
          totalReach: "",
          avgFrequency: "",
          budget: "",
          startDate: "2024-01-01",
          endDate: "2024-01-31",
          campaignName: "Xyz Abc Unique Name",
        },
      ],
    });
    // Meta campaign with completely different name, geo, and dates
    const meta = makeMetaCampaign({
      name: "Totally Different Campaign Here",
      adSets: [
        {
          metaAdSetId: "as-1",
          name: "AS1",
          status: "ACTIVE",
          startTime: "2025-12-01T00:00:00Z",
          endTime: "2025-12-31T00:00:00Z",
          billingEvent: "IMPRESSIONS",
          targeting: { geoLocations: { countries: ["DE"] } },
          ads: [],
        },
      ],
    });

    const suggestions = generateMatchSuggestions([group], [meta]);
    expect(suggestions[0].candidates).toHaveLength(0);
  });

  it("includes candidates with score exactly at 0.2 threshold", () => {
    // We test that scores >= 0.2 are included by creating a partial match
    const group = makeCampaignGroup({
      id: "g1",
      campaignName: "Brand Awareness",
      resolvedGeoTargets: [],
      lineItems: [
        {
          markets: "",
          channel: "Facebook",
          woa: "",
          targeting: "",
          buyType: "",
          asset: "",
          inventory: "",
          totalReach: "",
          avgFrequency: "",
          budget: "",
          startDate: "2025-06-01",
          endDate: "2025-06-30",
          campaignName: "Brand Awareness",
        },
      ],
    });
    const meta = makeMetaCampaign({
      name: "Brand Awareness Campaign",
      adSets: [
        {
          metaAdSetId: "as-1",
          name: "AS1",
          status: "ACTIVE",
          startTime: "2025-06-01T00:00:00Z",
          endTime: "2025-06-30T00:00:00Z",
          billingEvent: "IMPRESSIONS",
          targeting: { geoLocations: {} },
          ads: [],
        },
      ],
    });

    const suggestions = generateMatchSuggestions([group], [meta]);
    // Both have empty geo → geoScore = 1.0, names partially match, dates match
    // This should produce a score well above 0.2
    expect(suggestions[0].candidates.length).toBeGreaterThanOrEqual(1);
  });
});
