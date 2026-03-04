import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { interpretGeoFromMarkets, _setOpenAIClient } from "./geo-interpreter";

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

describe("interpretGeoFromMarkets", () => {
  it("parses cities in region format", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        geoIntents: [
          { name: "Amravati", type: "city", parentRegion: "Maharashtra", countryCode: "IN" },
          { name: "Bhiwandi", type: "city", parentRegion: "Maharashtra", countryCode: "IN" },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const intents = await interpretGeoFromMarkets("Maharashtra (Amravati, Bhiwandi)");

    expect(intents).toHaveLength(2);
    expect(intents[0].name).toBe("Amravati");
    expect(intents[0].type).toBe("city");
    expect(intents[0].parentRegion).toBe("Maharashtra");
    expect(intents[0].countryCode).toBe("IN");
    expect(intents[1].name).toBe("Bhiwandi");
  });

  it("parses Pan India as country intent", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        geoIntents: [
          { name: "India", type: "country", countryCode: "IN" },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    const intents = await interpretGeoFromMarkets("Pan India");

    expect(intents).toHaveLength(1);
    expect(intents[0].name).toBe("India");
    expect(intents[0].type).toBe("country");
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

    await expect(interpretGeoFromMarkets("Delhi")).rejects.toThrow(
      "empty response",
    );
  });

  it("throws on malformed JSON response", async () => {
    const mockClient = createMockClient("not json");
    _setOpenAIClient(mockClient);

    await expect(interpretGeoFromMarkets("Delhi")).rejects.toThrow(
      "invalid JSON",
    );
  });

  it("throws on unexpected structure (no geoIntents key)", async () => {
    const mockClient = createMockClient(JSON.stringify({ locations: [] }));
    _setOpenAIClient(mockClient);

    await expect(interpretGeoFromMarkets("Delhi")).rejects.toThrow(
      "unexpected structure",
    );
  });

  it("throws on malformed intent (bad type)", async () => {
    const mockClient = createMockClient(
      JSON.stringify({
        geoIntents: [
          { name: "Delhi", type: "planet", countryCode: "IN" },
        ],
      }),
    );
    _setOpenAIClient(mockClient);

    await expect(interpretGeoFromMarkets("Delhi")).rejects.toThrow(
      "malformed geo intent",
    );
  });

  it("calls OpenAI with correct parameters", async () => {
    const mockClient = createMockClient(
      JSON.stringify({ geoIntents: [{ name: "Delhi", type: "city", countryCode: "IN" }] }),
    );
    _setOpenAIClient(mockClient);

    await interpretGeoFromMarkets("Delhi");

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Delhi" }),
        ]),
      }),
    );
  });
});
