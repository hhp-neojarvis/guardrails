import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateGuardrailRules,
  _setOpenAIClient,
} from "./guardrail-generator";

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
  process.env.OPENAI_MODEL = "gpt-4o-mini";
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
    expect(rules[0].check.field).toBe("budget");
    expect(rules[0].check.operator).toBe("gte");
    expect(rules[0].check.value).toBe(10000);
    expect(rules[1].check.field).toBe("geo_targets");
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

    await expect(
      generateGuardrailRules("some prompt"),
    ).rejects.toThrow("empty response");
  });

  it("throws on invalid JSON", async () => {
    const mockClient = createMockClient("not valid json");
    _setOpenAIClient(mockClient);

    await expect(
      generateGuardrailRules("some prompt"),
    ).rejects.toThrow("invalid JSON");
  });

  it("throws on missing rules array", async () => {
    const mockClient = createMockClient(
      JSON.stringify({ checks: [] }),
    );
    _setOpenAIClient(mockClient);

    await expect(
      generateGuardrailRules("some prompt"),
    ).rejects.toThrow("unexpected structure");
  });

  it("filters out malformed rules (wrong field) and returns valid ones", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "Valid rule",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "gte",
              value: 5000,
            },
          },
          {
            description: "Invalid field",
            check: {
              scope: "campaign",
              field: "invalid_field",
              operator: "gte",
              value: 100,
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const rules = await generateGuardrailRules("some prompt");

    expect(rules).toHaveLength(1);
    expect(rules[0].description).toBe("Valid rule");
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
              value: "abc",
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

    const rules = await generateGuardrailRules("some prompt");

    expect(rules).toHaveLength(1);
    expect(rules[0].description).toBe("Good rule");
  });

  it("filters out rules with wrong scope", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "Wrong scope",
            check: {
              scope: "line_item",
              field: "budget",
              operator: "gte",
              value: 1000,
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const rules = await generateGuardrailRules("some prompt");

    expect(rules).toHaveLength(0);
  });

  it("returns all valid rules with valid structure", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "End date must be set",
            check: {
              scope: "campaign",
              field: "end_date",
              operator: "is_set",
              value: null,
            },
          },
          {
            description: "Buy type must be Auction",
            check: {
              scope: "campaign",
              field: "buy_type",
              operator: "equals",
              value: "Auction",
            },
          },
          {
            description: "Targeting must not be empty",
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

    const rules = await generateGuardrailRules("some prompt");

    expect(rules).toHaveLength(3);
  });

  it("calls OpenAI with correct parameters", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        rules: [
          {
            description: "Test",
            check: {
              scope: "campaign",
              field: "budget",
              operator: "gte",
              value: 1000,
            },
          },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    await generateGuardrailRules("budget rules");

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "budget rules" }),
        ]),
      }),
    );
  });
});
