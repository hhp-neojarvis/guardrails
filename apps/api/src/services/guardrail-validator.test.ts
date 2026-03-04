import { describe, it, expect } from "vitest";
import { validateGuardrails } from "./guardrail-validator.js";
import type { GuardrailRule, CampaignGroup } from "@guardrails/shared";

function makeRule(overrides: Partial<GuardrailRule> & { check: GuardrailRule["check"] }): GuardrailRule {
  return {
    id: "rule-1",
    companyId: "company-1",
    description: "Test rule",
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGroup(overrides: Partial<CampaignGroup> = {}): CampaignGroup {
  return {
    id: "group-1",
    markets: "India",
    channel: "Meta - Launch",
    campaignName: "Test Campaign",
    lineItems: [
      {
        markets: "India",
        channel: "Meta - Launch",
        woa: "4",
        targeting: "18-24 M+F",
        buyType: "RNF",
        asset: "Video",
        inventory: "Feeds",
        totalReach: "1000000",
        avgFrequency: "3",
        budget: "50000",
        startDate: "2025-01-01",
        endDate: "2025-01-28",
        campaignName: "Test Campaign",
      },
    ],
    geoIntents: [],
    resolvedGeoTargets: [
      {
        key: "123",
        name: "Mumbai",
        type: "city",
        countryCode: "IN",
        region: "Maharashtra",
        regionId: 456,
        supportsRegion: true,
        supportsCity: true,
      },
    ],
    unresolvedIntents: [],
    status: "resolved",
    ...overrides,
  };
}

describe("guardrail-validator", () => {
  describe("is_set operator", () => {
    it("passes when budget is set", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "budget", operator: "is_set", value: null },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(false);
      expect(result.results[0].status).toBe("pass");
    });

    it("fails when frequency_cap is not set", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "frequency_cap", operator: "is_set", value: null },
      });
      const group = makeGroup({ frequencyCap: undefined });
      const result = validateGuardrails([group], [rule]);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations).toHaveLength(1);
      expect(result.results[0].violations[0].message).toContain("frequency_cap is not set");
    });
  });

  describe("not_empty operator", () => {
    it("passes when geo_targets has resolved targets", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "geo_targets", operator: "not_empty", value: null },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(false);
    });

    it("fails when geo_targets is empty array", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "geo_targets", operator: "not_empty", value: null },
      });
      const group = makeGroup({ resolvedGeoTargets: [] });
      const result = validateGuardrails([group], [rule]);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations[0].message).toContain("geo_targets is empty");
    });
  });

  describe("all_within operator", () => {
    it("passes when all geo targets are within specified country", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "geo_targets", operator: "all_within", value: { country: "IN" } },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(false);
    });

    it("fails when geo targets are outside specified country", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "geo_targets", operator: "all_within", value: { country: "US" } },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations[0].message).toContain("Geo targets outside US");
      expect(result.results[0].violations[0].message).toContain("Mumbai (IN)");
    });

    it("fails when no geo targets resolved", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "geo_targets", operator: "all_within", value: { country: "IN" } },
      });
      const group = makeGroup({ resolvedGeoTargets: [] });
      const result = validateGuardrails([group], [rule]);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations[0].message).toContain("No geo targets resolved");
    });

    it("passes when all geo targets are within specified state", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "geo_targets", operator: "all_within", value: { country: "IN", state: "Maharashtra" } },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(false);
    });

    it("fails when geo targets are outside specified state but within country", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "geo_targets", operator: "all_within", value: { country: "IN", state: "Maharashtra" } },
      });
      const group = makeGroup({
        resolvedGeoTargets: [
          { key: "100", name: "Erode", type: "city", countryCode: "IN", region: "Tamil Nadu", regionId: 500, supportsRegion: true, supportsCity: true },
          { key: "101", name: "Tirunelveli", type: "city", countryCode: "IN", region: "Tamil Nadu", regionId: 500, supportsRegion: true, supportsCity: true },
        ],
      });
      const result = validateGuardrails([group], [rule]);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations[0].message).toContain("Geo targets outside Maharashtra");
      expect(result.results[0].violations[0].message).toContain("Erode");
    });
  });

  describe("gte operator", () => {
    it("passes when budget is above threshold", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "budget", operator: "gte", value: 10000 },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(false);
    });

    it("fails when budget is below threshold", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "budget", operator: "gte", value: 100000 },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations[0].message).toContain("below minimum 100000");
    });
  });

  describe("lte operator", () => {
    it("passes when budget is below threshold", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "budget", operator: "lte", value: 100000 },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(false);
    });

    it("fails when budget exceeds threshold", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "budget", operator: "lte", value: 10000 },
      });
      const result = validateGuardrails([makeGroup()], [rule]);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations[0].message).toContain("exceeds maximum 10000");
    });
  });

  describe("equals operator", () => {
    it("passes when buy_type matches", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "buy_type", operator: "equals", value: "REACH_AND_FREQUENCY" },
      });
      const group = makeGroup({
        campaignBuyType: { objective: "OUTCOME_AWARENESS", buyingType: "REACH_AND_FREQUENCY", raw: "RNF" },
      });
      const result = validateGuardrails([group], [rule]);
      expect(result.hasViolations).toBe(false);
    });

    it("fails when buy_type does not match", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "buy_type", operator: "equals", value: "AUCTION" },
      });
      const group = makeGroup({
        campaignBuyType: { objective: "OUTCOME_AWARENESS", buyingType: "REACH_AND_FREQUENCY", raw: "RNF" },
      });
      const result = validateGuardrails([group], [rule]);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations[0].message).toContain("expected 'AUCTION'");
    });
  });

  describe("multiple rules and campaigns", () => {
    it("returns all violations from multiple rules against one campaign", () => {
      const rules = [
        makeRule({
          id: "rule-1",
          check: { scope: "campaign", field: "frequency_cap", operator: "is_set", value: null },
        }),
        makeRule({
          id: "rule-2",
          check: { scope: "campaign", field: "geo_targets", operator: "all_within", value: { country: "US" } },
        }),
      ];
      const group = makeGroup({ frequencyCap: undefined });
      const result = validateGuardrails([group], rules);
      expect(result.hasViolations).toBe(true);
      expect(result.results[0].violations).toHaveLength(2);
    });

    it("validates each campaign independently", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "geo_targets", operator: "all_within", value: { country: "IN" } },
      });
      const group1 = makeGroup({ id: "g1", campaignName: "Campaign 1" });
      const group2 = makeGroup({
        id: "g2",
        campaignName: "Campaign 2",
        resolvedGeoTargets: [
          { key: "789", name: "New York", type: "city", countryCode: "US", region: "New York", regionId: 100, supportsRegion: true, supportsCity: true },
        ],
      });
      const result = validateGuardrails([group1, group2], [rule]);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe("pass");
      expect(result.results[1].status).toBe("fail");
    });
  });

  describe("edge cases", () => {
    it("skips inactive rules", () => {
      const rule = makeRule({
        active: false,
        check: { scope: "campaign", field: "frequency_cap", operator: "is_set", value: null },
      });
      const group = makeGroup({ frequencyCap: undefined });
      const result = validateGuardrails([group], [rule]);
      expect(result.hasViolations).toBe(false);
      expect(result.totalRules).toBe(0);
    });

    it("skips unsupported campaign groups", () => {
      const rule = makeRule({
        check: { scope: "campaign", field: "frequency_cap", operator: "is_set", value: null },
      });
      const group = makeGroup({ status: "unsupported", frequencyCap: undefined });
      const result = validateGuardrails([group], [rule]);
      expect(result.results).toHaveLength(0);
      expect(result.totalCampaigns).toBe(0);
    });

    it("returns clean result when no rules", () => {
      const result = validateGuardrails([makeGroup()], []);
      expect(result.totalRules).toBe(0);
      expect(result.hasViolations).toBe(false);
      expect(result.results[0].status).toBe("pass");
    });
  });
});
