import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MetaCampaignSnapshot } from "@guardrails/shared";

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-09T12:00:00.000Z"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Must import after mocks
const { fetchMetaCampaigns } = await import("./meta-campaign-fetcher");

/** Helper: build a raw Meta API campaign response */
function buildRawCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "123456",
    name: "Test Campaign",
    status: "ACTIVE",
    objective: "CONVERSIONS",
    buying_type: "AUCTION",
    adsets: {
      data: [
        {
          id: "adset_1",
          name: "Test Ad Set",
          status: "ACTIVE",
          start_time: "2026-03-01T00:00:00+0000",
          end_time: "2026-03-31T00:00:00+0000",
          daily_budget: "5000",
          billing_event: "IMPRESSIONS",
          targeting: {
            geo_locations: {
              countries: ["IN"],
            },
            age_min: 18,
            age_max: 65,
            genders: [1, 2],
            publisher_platforms: ["facebook", "instagram"],
          },
          ads: {
            data: [
              {
                id: "ad_1",
                name: "Test Ad",
                status: "ACTIVE",
                creative: {
                  image_hash: "abc123",
                  object_story_spec: { page_id: "page_1" },
                },
              },
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}

/** Helper: wrap campaigns in a Meta API response body */
function buildApiResponse(
  campaigns: unknown[],
  nextPage?: string,
) {
  return {
    data: campaigns,
    paging: nextPage ? { next: nextPage } : {},
  };
}

describe("fetchMetaCampaigns", () => {
  it("maps a single page of results correctly", async () => {
    const raw = buildRawCampaign();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildApiResponse([raw])),
    });

    const result = await fetchMetaCampaigns({
      adAccountId: "act_12345",
      accessToken: "test-token",
    });

    expect(result).toHaveLength(1);

    const campaign = result[0];
    expect(campaign).not.toHaveProperty("id");
    expect(campaign).not.toHaveProperty("uploadId");
    expect(campaign.metaCampaignId).toBe("123456");
    expect(campaign.name).toBe("Test Campaign");
    expect(campaign.status).toBe("ACTIVE");
    expect(campaign.objective).toBe("CONVERSIONS");
    expect(campaign.buyingType).toBe("AUCTION");
    expect(campaign.fetchedAt).toBe("2026-03-09T12:00:00.000Z");

    // Ad set mapping
    expect(campaign.adSets).toHaveLength(1);
    const adSet = campaign.adSets[0];
    expect(adSet.metaAdSetId).toBe("adset_1");
    expect(adSet.name).toBe("Test Ad Set");
    expect(adSet.dailyBudget).toBe("5000");
    expect(adSet.billingEvent).toBe("IMPRESSIONS");
    expect(adSet.targeting.geoLocations.countries).toEqual(["IN"]);
    expect(adSet.targeting.ageMin).toBe(18);
    expect(adSet.targeting.ageMax).toBe(65);

    // Ad mapping
    expect(adSet.ads).toHaveLength(1);
    const ad = adSet.ads[0];
    expect(ad.metaAdId).toBe("ad_1");
    expect(ad.name).toBe("Test Ad");
    expect(ad.creative?.imageHash).toBe("abc123");
    expect(ad.creative?.objectStorySpec).toEqual({ page_id: "page_1" });

    // Verify URL includes act_ prefix and correct params
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("act_12345/campaigns");
    // access_token should NOT be in URL — it's in the Authorization header
    expect(calledUrl).not.toContain("access_token");
    const calledOptions = mockFetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(calledOptions.headers.Authorization).toBe("Bearer test-token");
  });

  it("prefixes adAccountId with act_ if missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildApiResponse([])),
    });

    await fetchMetaCampaigns({
      adAccountId: "99999",
      accessToken: "test-token",
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("act_99999/campaigns");
  });

  it("handles pagination (2 pages)", async () => {
    const campaign1 = buildRawCampaign({ id: "c1", name: "Campaign 1" });
    const campaign2 = buildRawCampaign({ id: "c2", name: "Campaign 2" });

    // First page with next URL
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve(
          buildApiResponse([campaign1], "https://graph.facebook.com/v21.0/next-page"),
        ),
    });

    // Second page without next URL
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildApiResponse([campaign2])),
    });

    const result = await fetchMetaCampaigns({
      adAccountId: "act_12345",
      accessToken: "test-token",
    });

    expect(result).toHaveLength(2);
    expect(result[0].metaCampaignId).toBe("c1");
    expect(result[0].name).toBe("Campaign 1");
    expect(result[1].metaCampaignId).toBe("c2");
    expect(result[1].name).toBe("Campaign 2");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should use the next page URL directly
    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://graph.facebook.com/v21.0/next-page",
    );
  });

  it("returns empty array for empty account", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildApiResponse([])),
    });

    const result = await fetchMetaCampaigns({
      adAccountId: "act_12345",
      accessToken: "test-token",
    });

    expect(result).toEqual([]);
  });

  it("throws on expired token (error code 190)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: {
            message: "Error validating access token",
            code: 190,
            error_subcode: 463,
          },
        }),
    });

    await expect(
      fetchMetaCampaigns({
        adAccountId: "act_12345",
        accessToken: "expired-token",
      }),
    ).rejects.toThrow("Meta access token has expired");
  });

  it("throws on rate limit (429)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          error: {
            message: "Too many calls",
            code: 32,
          },
        }),
    });

    await expect(
      fetchMetaCampaigns({
        adAccountId: "act_12345",
        accessToken: "test-token",
      }),
    ).rejects.toThrow("Meta API rate limit reached");
  });

  it("handles campaigns without ad sets", async () => {
    const rawNoAdSets = buildRawCampaign({
      id: "c_no_adsets",
      name: "No AdSets Campaign",
    });
    // Remove adsets entirely
    delete (rawNoAdSets as Record<string, unknown>).adsets;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildApiResponse([rawNoAdSets])),
    });

    const result = await fetchMetaCampaigns({
      adAccountId: "act_12345",
      accessToken: "test-token",
    });

    expect(result).toHaveLength(1);
    expect(result[0].metaCampaignId).toBe("c_no_adsets");
    expect(result[0].adSets).toEqual([]);
  });
});
