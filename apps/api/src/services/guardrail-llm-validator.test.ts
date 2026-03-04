import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateGuardrailsLLM } from "./guardrail-llm-validator.js";
import { _setOpenAIClient } from "../lib/llm.js";
import type { CampaignGroup, GuardrailRule } from "@guardrails/shared";

// Mock the DB module so getLLMConfig doesn't hit a real database
vi.mock("@guardrails/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => [] }) }) },
  llmConfigs: {},
  eq: () => {},
  and: () => {},
  isNull: () => {},
}));

function createMockClient(response: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: response } }],
        }),
      },
    },
  } as any;
}

const baseRule: GuardrailRule = {
  id: "rule-1",
  companyId: "company-1",
  description: "All geo targets must be within Maharashtra",
  active: true,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

const baseGroup = {
  id: "group-1",
  campaignName: "Test Campaign",
  markets: "Maharashtra",
  channel: "Meta",
  status: "resolved",
  lineItems: [],
  geoIntents: [],
  resolvedGeoTargets: [
    { key: "123", name: "Mumbai", type: "city", countryCode: "IN", region: "Maharashtra", regionId: 1, supportsRegion: false, supportsCity: true },
  ],
  unresolvedIntents: [],
} as CampaignGroup;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  _setOpenAIClient(null);
  vi.restoreAllMocks();
});

describe("validateGuardrailsLLM", () => {
  it("returns pass for all campaigns when no active rules", async () => {
    const result = await validateGuardrailsLLM(
      [baseGroup],
      [{ ...baseRule, active: false }],
      "company-1",
    );

    expect(result.hasViolations).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("pass");
    expect(result.results[0].violations).toHaveLength(0);
  });

  it("returns pass for all campaigns when no supported groups", async () => {
    const result = await validateGuardrailsLLM(
      [{ ...baseGroup, status: "unsupported" }],
      [baseRule],
      "company-1",
    );

    expect(result.hasViolations).toBe(false);
    expect(result.totalCampaigns).toBe(0);
  });

  it("detects violations from LLM response", async () => {
    const llmResponse = {
      results: [
        {
          campaignGroupId: "group-1",
          campaignName: "Test Campaign",
          violations: [
            {
              ruleId: "rule-1",
              ruleDescription: "All geo targets must be within Maharashtra",
              field: "geo_targets",
              expected: "Maharashtra only",
              actual: "Tamil Nadu cities found",
              message: "Campaign targets cities outside Maharashtra",
            },
          ],
        },
      ],
    };

    const mockClient = createMockClient(JSON.stringify(llmResponse));
    _setOpenAIClient(mockClient);

    const result = await validateGuardrailsLLM(
      [baseGroup],
      [baseRule],
      "company-1",
    );

    expect(result.hasViolations).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("fail");
    expect(result.results[0].violations).toHaveLength(1);
    expect(result.results[0].violations[0].ruleId).toBe("rule-1");
    expect(result.results[0].violations[0].message).toBe(
      "Campaign targets cities outside Maharashtra",
    );
  });

  it("returns pass when LLM finds no violations", async () => {
    const llmResponse = {
      results: [
        {
          campaignGroupId: "group-1",
          campaignName: "Test Campaign",
          violations: [],
        },
      ],
    };

    const mockClient = createMockClient(JSON.stringify(llmResponse));
    _setOpenAIClient(mockClient);

    const result = await validateGuardrailsLLM(
      [baseGroup],
      [baseRule],
      "company-1",
    );

    expect(result.hasViolations).toBe(false);
    expect(result.results[0].status).toBe("pass");
  });

  it("fills missing campaigns as pass", async () => {
    const groups: CampaignGroup[] = [
      { ...baseGroup, id: "group-1" },
      { ...baseGroup, id: "group-2", campaignName: "Campaign 2" },
    ];

    // LLM only returns results for group-1
    const llmResponse = {
      results: [
        {
          campaignGroupId: "group-1",
          violations: [],
        },
      ],
    };

    const mockClient = createMockClient(JSON.stringify(llmResponse));
    _setOpenAIClient(mockClient);

    const result = await validateGuardrailsLLM(
      groups,
      [baseRule],
      "company-1",
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[1].campaignGroupId).toBe("group-2");
    expect(result.results[1].status).toBe("pass");
  });

  it("skips unknown campaign IDs from LLM response", async () => {
    const llmResponse = {
      results: [
        {
          campaignGroupId: "unknown-id",
          violations: [
            {
              ruleId: "rule-1",
              message: "Some violation",
            },
          ],
        },
        {
          campaignGroupId: "group-1",
          violations: [],
        },
      ],
    };

    const mockClient = createMockClient(JSON.stringify(llmResponse));
    _setOpenAIClient(mockClient);

    const result = await validateGuardrailsLLM(
      [baseGroup],
      [baseRule],
      "company-1",
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].campaignGroupId).toBe("group-1");
  });

  it("fills ruleDescription from rule map when LLM omits it", async () => {
    const llmResponse = {
      results: [
        {
          campaignGroupId: "group-1",
          violations: [
            {
              ruleId: "rule-1",
              message: "Violation found",
            },
          ],
        },
      ],
    };

    const mockClient = createMockClient(JSON.stringify(llmResponse));
    _setOpenAIClient(mockClient);

    const result = await validateGuardrailsLLM(
      [baseGroup],
      [baseRule],
      "company-1",
    );

    expect(result.results[0].violations[0].ruleDescription).toBe(
      "All geo targets must be within Maharashtra",
    );
  });

  it("throws on invalid LLM response structure", async () => {
    const mockClient = createMockClient(JSON.stringify({ invalid: true }));
    _setOpenAIClient(mockClient);

    await expect(
      validateGuardrailsLLM([baseGroup], [baseRule], "company-1"),
    ).rejects.toThrow("LLM returned unexpected structure");
  });

  it("handles multiple campaigns with mixed results", async () => {
    const groups: CampaignGroup[] = [
      { ...baseGroup, id: "group-1" },
      { ...baseGroup, id: "group-2", campaignName: "Campaign 2" },
      { ...baseGroup, id: "group-3", campaignName: "Campaign 3" },
    ];

    const llmResponse = {
      results: [
        { campaignGroupId: "group-1", violations: [] },
        {
          campaignGroupId: "group-2",
          violations: [
            { ruleId: "rule-1", message: "Violation in campaign 2" },
          ],
        },
        { campaignGroupId: "group-3", violations: [] },
      ],
    };

    const mockClient = createMockClient(JSON.stringify(llmResponse));
    _setOpenAIClient(mockClient);

    const result = await validateGuardrailsLLM(
      groups,
      [baseRule],
      "company-1",
    );

    expect(result.totalCampaigns).toBe(3);
    expect(result.totalRules).toBe(1);
    expect(result.hasViolations).toBe(true);
    expect(result.results[0].status).toBe("pass");
    expect(result.results[1].status).toBe("fail");
    expect(result.results[2].status).toBe("pass");
  });

  it("filters out violations without ruleId or message", async () => {
    const llmResponse = {
      results: [
        {
          campaignGroupId: "group-1",
          violations: [
            { ruleId: "rule-1", message: "Valid violation" },
            { ruleId: "", message: "Missing ruleId" },
            { ruleId: "rule-1", message: "" },
            { message: "No ruleId at all" },
          ],
        },
      ],
    };

    const mockClient = createMockClient(JSON.stringify(llmResponse));
    _setOpenAIClient(mockClient);

    const result = await validateGuardrailsLLM(
      [baseGroup],
      [baseRule],
      "company-1",
    );

    expect(result.results[0].violations).toHaveLength(1);
    expect(result.results[0].violations[0].message).toBe("Valid violation");
  });
});
