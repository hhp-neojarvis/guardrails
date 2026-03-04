import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateGuardrailRules } from "./guardrail-generator";
import { _setOpenAIClient } from "../lib/llm.js";

// Mock the DB module so getLLMConfig doesn't hit a real database
vi.mock("@guardrails/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => [] }) }) },
  llmConfigs: {},
  eq: () => {},
  and: () => {},
  isNull: () => {},
}));

// Mock OpenAI client
function createMockClient(response: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: response,
              },
            },
          ],
        }),
      },
    },
  } as any;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  _setOpenAIClient(null);
  vi.restoreAllMocks();
});

describe("generateGuardrailRules", () => {
  it("returns valid generated rules", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "Budget must be at least 10000",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "gte",
              value: 10000,
            },
          },
          {
            description: "All geo targets must be within India",
            check: {
              scope: "campaign",
              field: "geo_targets",
              operator: "all_within",
              value: { country: "IN" },
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const rules = await generateGuardrailRules(
      "Budget should be at least 10000 and target India",
    );

    expect(rules).toHaveLength(2);
    expect(rules[0].description).toBe("Budget must be at least 10000");
    expect(rules[0].check!.field).toBe("budget");
    expect(rules[0].check!.operator).toBe("gte");
    expect(rules[0].check!.value).toBe(10000);
    expect(rules[1].check!.field).toBe("geo_targets");
  });

  it("throws on empty LLM response", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: null } }],
          }),
        },
      },
    } as any;
    _setOpenAIClient(mockClient);

    await expect(generateGuardrailRules("test")).rejects.toThrow(
      "empty response",
    );
  });

  it("throws on malformed JSON", async () => {
    const mockClient = createMockClient("not json");
    _setOpenAIClient(mockClient);

    await expect(generateGuardrailRules("test")).rejects.toThrow(
      "invalid JSON",
    );
  });

  it("throws on unexpected structure", async () => {
    const mockClient = createMockClient(JSON.stringify({ items: [] }));
    _setOpenAIClient(mockClient);

    await expect(generateGuardrailRules("test")).rejects.toThrow(
      "unexpected structure",
    );
  });

  it("handles duplicate rules in response", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "Budget must be at least 10000",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "gte",
              value: 10000,
            },
          },
          {
            description: "Budget must be at least 10000 (duplicate)",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "gte",
              value: 10000,
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const rules = await generateGuardrailRules("test");
    expect(rules).toHaveLength(2);
  });

  it("filters out rules with wrong operator", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "Bad operator",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "contains",
              value: "test",
            },
          },
          {
            description: "Good rule",
            check: {
              scope: "campaign",
              field: "frequency_cap",
              operator: "is_set",
              value: null,
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const rules = await generateGuardrailRules("test");
    expect(rules).toHaveLength(1);
    expect(rules[0].description).toBe("Good rule");
  });

  it("calls OpenAI with correct parameters", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "Budget must be at least 10000",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "gte",
              value: 10000,
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    await generateGuardrailRules("test prompt");

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        response_format: { type: "json_object" },
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "test prompt" }),
        ]),
      }),
    );
  });

  it("filters out rules with no description", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "is_set",
              value: null,
            },
          },
          {
            description: "Valid rule",
            check: {
              scope: "campaign",
              field: "buy_type",
              operator: "equals",
              value: "Auction",
            },
          },
          {
            description: "No check rule",
          },
          {
            description: "Another valid rule",
            check: {
              scope: "campaign",
              field: "targeting",
              operator: "not_empty",
              value: null,
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const rules = await generateGuardrailRules("test");
    expect(rules).toHaveLength(3);
    expect(rules[0].description).toBe("Valid rule");
    expect(rules[1].description).toBe("No check rule");
    expect(rules[2].description).toBe("Another valid rule");
  });

  it("accepts description-only rules without check", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "All campaigns must have reasonable budgets for their target market",
          },
          {
            description: "Budget must be at least 10000",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "gte",
              value: 10000,
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const rules = await generateGuardrailRules("test");
    expect(rules).toHaveLength(2);
    expect(rules[0].check).toBeUndefined();
    expect(rules[1].check).toBeDefined();
  });
});
