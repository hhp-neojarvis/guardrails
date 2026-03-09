import type {
  MetaCampaignSnapshot,
  MetaAdSetSnapshot,
  MetaAdSnapshot,
} from "@guardrails/shared";

const META_API_BASE = "https://graph.facebook.com/v21.0";

const CAMPAIGN_FIELDS = [
  "id",
  "name",
  "status",
  "objective",
  "buying_type",
  "adsets{id,name,status,start_time,end_time,daily_budget,lifetime_budget,billing_event,targeting,frequency_control_specs,ads{id,name,status,creative{image_hash,video_id,object_story_spec}}}",
].join(",");

/** Ensure adAccountId starts with "act_" */
function normalizeAdAccountId(adAccountId: string): string {
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

/** Map a raw Meta ad to our camelCase snapshot type */
function mapAd(raw: Record<string, unknown>): MetaAdSnapshot {
  const creative = raw.creative as Record<string, unknown> | undefined;
  return {
    metaAdId: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    status: String(raw.status ?? ""),
    creative: creative
      ? {
          imageHash: creative.image_hash
            ? String(creative.image_hash)
            : undefined,
          videoId: creative.video_id ? String(creative.video_id) : undefined,
          objectStorySpec: creative.object_story_spec
            ? (creative.object_story_spec as Record<string, unknown>)
            : undefined,
        }
      : undefined,
  };
}

/** Map raw targeting to our camelCase targeting type */
function mapTargeting(
  raw: Record<string, unknown> | undefined,
): MetaAdSetSnapshot["targeting"] {
  if (!raw) {
    return { geoLocations: {} };
  }

  const geoRaw = (raw.geo_locations ?? {}) as Record<string, unknown>;

  return {
    geoLocations: {
      countries: geoRaw.countries as string[] | undefined,
      regions: geoRaw.regions as
        | Array<{ key: string; name: string }>
        | undefined,
      cities: geoRaw.cities as
        | Array<{ key: string; name: string }>
        | undefined,
    },
    ageMin: raw.age_min as number | undefined,
    ageMax: raw.age_max as number | undefined,
    genders: raw.genders as number[] | undefined,
    publisherPlatforms: raw.publisher_platforms as string[] | undefined,
    facebookPositions: raw.facebook_positions as string[] | undefined,
    instagramPositions: raw.instagram_positions as string[] | undefined,
  };
}

/** Map raw frequency control specs */
function mapFrequencyControlSpecs(
  raw: unknown[] | undefined,
): MetaAdSetSnapshot["frequencyControlSpecs"] {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((spec) => {
    const s = spec as Record<string, unknown>;
    return {
      event: String(s.event ?? ""),
      intervalDays: Number(s.interval_days ?? 0),
      maxFrequency: Number(s.max_frequency ?? 0),
    };
  });
}

/** Map a raw Meta ad set to our camelCase snapshot type */
function mapAdSet(raw: Record<string, unknown>): MetaAdSetSnapshot {
  const adsData = raw.ads as { data?: unknown[] } | undefined;
  const ads: MetaAdSnapshot[] = (adsData?.data ?? []).map((ad) =>
    mapAd(ad as Record<string, unknown>),
  );

  return {
    metaAdSetId: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    status: String(raw.status ?? ""),
    startTime: String(raw.start_time ?? ""),
    endTime: String(raw.end_time ?? ""),
    dailyBudget: raw.daily_budget ? String(raw.daily_budget) : undefined,
    lifetimeBudget: raw.lifetime_budget
      ? String(raw.lifetime_budget)
      : undefined,
    billingEvent: String(raw.billing_event ?? ""),
    targeting: mapTargeting(raw.targeting as Record<string, unknown> | undefined),
    frequencyControlSpecs: mapFrequencyControlSpecs(
      raw.frequency_control_specs as unknown[] | undefined,
    ),
    ads,
  };
}

/** Map a raw Meta campaign to our MetaCampaignSnapshot type */
function mapCampaign(
  raw: Record<string, unknown>,
  fetchedAt: string,
): MetaCampaignSnapshot {
  const adSetsData = raw.adsets as { data?: unknown[] } | undefined;
  const adSets: MetaAdSetSnapshot[] = (adSetsData?.data ?? []).map((adSet) =>
    mapAdSet(adSet as Record<string, unknown>),
  );

  return {
    id: "",
    uploadId: "",
    metaCampaignId: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    status: raw.status as "ACTIVE" | "PAUSED",
    objective: String(raw.objective ?? ""),
    buyingType: String(raw.buying_type ?? ""),
    adSets,
    fetchedAt,
  };
}

/** Parse Meta API error response and throw appropriate error */
async function handleErrorResponse(response: Response): Promise<never> {
  let errorMessage = `Meta API error (${response.status})`;

  try {
    const body = (await response.json()) as {
      error?: { message?: string; code?: number; error_subcode?: number };
    };

    if (body.error) {
      // Token expired
      if (body.error.code === 190) {
        throw new Error("Meta access token has expired");
      }

      errorMessage = body.error.message ?? errorMessage;
    }
  } catch (err) {
    // If it's our own thrown error, re-throw it
    if (err instanceof Error && err.message === "Meta access token has expired") {
      throw err;
    }
    // Otherwise fall through to generic error
  }

  // Rate limited
  if (response.status === 429) {
    throw new Error("Meta API rate limit reached");
  }

  throw new Error(errorMessage);
}

/**
 * Fetch the full campaign hierarchy (campaigns → ad sets → ads + creatives)
 * from a Meta ad account using the Graph API v21.0.
 */
export async function fetchMetaCampaigns(params: {
  adAccountId: string;
  accessToken: string;
}): Promise<MetaCampaignSnapshot[]> {
  const adAccountId = normalizeAdAccountId(params.adAccountId);
  const fetchedAt = new Date().toISOString();
  const allCampaigns: MetaCampaignSnapshot[] = [];

  const filtering = JSON.stringify([
    {
      field: "effective_status",
      operator: "IN",
      value: ["ACTIVE", "PAUSED"],
    },
  ]);

  const queryParams = new URLSearchParams({
    fields: CAMPAIGN_FIELDS,
    filtering,
    limit: "100",
    access_token: params.accessToken,
  });

  let url: string | null =
    `${META_API_BASE}/${adAccountId}/campaigns?${queryParams.toString()}`;

  while (url) {
    const response = await fetch(url);

    if (!response.ok) {
      await handleErrorResponse(response);
    }

    const body = (await response.json()) as {
      data?: unknown[];
      paging?: { next?: string };
    };

    const campaigns = (body.data ?? []).map((raw) =>
      mapCampaign(raw as Record<string, unknown>, fetchedAt),
    );

    allCampaigns.push(...campaigns);

    // Follow cursor-based pagination
    url = body.paging?.next ?? null;
  }

  return allCampaigns;
}
