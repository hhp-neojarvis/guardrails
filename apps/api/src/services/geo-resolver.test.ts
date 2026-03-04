import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GeoIntent } from "@guardrails/shared";

// Mock @guardrails/db
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();

function resetDbChain() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockResolvedValue(undefined);
}

vi.mock("@guardrails/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
  },
  geoCache: {
    query: "query",
    locationType: "location_type",
    countryCode: "country_code",
    metaKey: "meta_key",
    metaName: "meta_name",
    metaType: "meta_type",
    metaRegion: "meta_region",
    metaRegionId: "meta_region_id",
    metaCountryCode: "meta_country_code",
  },
  eq: vi.fn((...args: any[]) => ({ op: "eq", args })),
  and: vi.fn((...args: any[]) => ({ op: "and", args })),
}));

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  resetDbChain();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Must import after mocks
const { resolveGeoTargets, deriveCountryCode } = await import("./geo-resolver");

describe("deriveCountryCode", () => {
  it("returns countryCode from intent", () => {
    expect(deriveCountryCode({ name: "Delhi", type: "city", countryCode: "IN" })).toBe("IN");
  });

  it("defaults to IN when countryCode is empty", () => {
    expect(deriveCountryCode({ name: "Delhi", type: "city", countryCode: "" })).toBe("IN");
  });
});

describe("resolveGeoTargets", () => {
  const cityIntent: GeoIntent = {
    name: "Delhi",
    type: "city",
    countryCode: "IN",
  };

  it("returns cached result without calling API", async () => {
    // Simulate cache hit
    mockWhere.mockResolvedValueOnce([
      {
        metaKey: "123",
        metaName: "Delhi",
        metaType: "city",
        metaCountryCode: "IN",
        metaRegion: "Delhi",
        metaRegionId: 456,
      },
    ]);

    const result = await resolveGeoTargets([cityIntent], "test-token");

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].key).toBe("123");
    expect(result.resolved[0].name).toBe("Delhi");
    expect(result.unresolved).toHaveLength(0);
    // Should NOT have called fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls Meta API on cache miss and caches result", async () => {
    // Cache miss
    mockWhere.mockResolvedValueOnce([]);

    // Meta API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              key: "789",
              name: "Delhi",
              type: "city",
              country_code: "IN",
              country_name: "India",
              region: "Delhi",
              region_id: 456,
              supports_region: false,
              supports_city: true,
            },
          ],
        }),
    });

    const result = await resolveGeoTargets([cityIntent], "test-token");

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].key).toBe("789");
    expect(result.resolved[0].name).toBe("Delhi");
    // Should have called fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Should have cached
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("marks intent as unresolved when API returns no results", async () => {
    mockWhere.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    const result = await resolveGeoTargets([cityIntent], "test-token");

    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].intent.name).toBe("Delhi");
    expect(result.unresolved[0].reason).toContain("No results found");
  });

  it("catches API errors and marks as unresolved", async () => {
    mockWhere.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const result = await resolveGeoTargets([cityIntent], "test-token");

    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toContain("API error");
  });

  it("handles multiple intents", async () => {
    const intents: GeoIntent[] = [
      { name: "Delhi", type: "city", countryCode: "IN" },
      { name: "Mumbai", type: "city", countryCode: "IN" },
    ];

    // Both cache miss
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([]);

    // Both API responses
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ key: "1", name: "Delhi", type: "city", country_code: "IN", region: "Delhi", region_id: 1, supports_region: false, supports_city: true }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ key: "2", name: "Mumbai", type: "city", country_code: "IN", region: "Maharashtra", region_id: 2, supports_region: false, supports_city: true }],
          }),
      });

    const result = await resolveGeoTargets(intents, "test-token");

    expect(result.resolved).toHaveLength(2);
    expect(result.unresolved).toHaveLength(0);
  });
});
