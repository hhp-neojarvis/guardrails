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
  "adsets{id,name,status,start_time,end_time,daily_budget,lifetime_budget,billing_event,targeting,ads{id,name,status,creative{image_hash,video_id,object_story_spec}}}",
].join(",");

/** Fields to fetch separately for ad sets (frequency_control_specs gets silently dropped in nested campaign expansions) */
const ADSET_FIELDS = "id,frequency_control_specs,rf_prediction_id";

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

/** Map raw frequency control specs — handles both direct array and { data: [...] } wrapper */
function mapFrequencyControlSpecs(
  raw: unknown,
): MetaAdSetSnapshot["frequencyControlSpecs"] {
  if (!raw) return undefined;

  // Meta may return as { data: [...] } or as a direct array
  let specs: unknown[];
  if (Array.isArray(raw)) {
    specs = raw;
  } else if (typeof raw === "object" && raw !== null && "data" in raw) {
    specs = (raw as { data: unknown[] }).data ?? [];
  } else {
    return undefined;
  }

  if (specs.length === 0) return undefined;

  return specs.map((spec) => {
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
      raw.frequency_control_specs,
    ),
    ads,
  };
}

/** Map a raw Meta campaign to our MetaCampaignSnapshot type (without id/uploadId, filled by caller) */
function mapCampaign(
  raw: Record<string, unknown>,
  fetchedAt: string,
): Omit<MetaCampaignSnapshot, "id" | "uploadId"> {
  const adSetsData = raw.adsets as { data?: unknown[] } | undefined;
  const adSets: MetaAdSetSnapshot[] = (adSetsData?.data ?? []).map((adSet) =>
    mapAdSet(adSet as Record<string, unknown>),
  );

  return {
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
 * Fetch frequency_control_specs for all ad sets in an ad account.
 * Done as a separate call because Meta silently drops this field
 * from nested campaign→adsets field expansions.
 */
interface AdSetFrequencyData {
  frequencyControlSpecs?: MetaAdSetSnapshot["frequencyControlSpecs"];
  insightsFrequency?: number;
}

async function fetchAdSetFrequencyData(
  adAccountId: string,
  headers: Record<string, string>,
): Promise<Map<string, AdSetFrequencyData>> {
  const dataByAdSetId = new Map<string, AdSetFrequencyData>();
  const rfPredictionAdSets: Array<{ id: string; predictionId: string }> = [];

  const queryParams = new URLSearchParams({
    fields: ADSET_FIELDS,
    limit: "500",
  });

  let url: string | null =
    `${META_API_BASE}/${adAccountId}/adsets?${queryParams.toString()}`;

  while (url) {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.warn("Failed to fetch ad set frequency data separately");
      break;
    }

    const body = (await response.json()) as {
      data?: unknown[];
      paging?: { next?: string };
    };

    for (const raw of body.data ?? []) {
      const r = raw as Record<string, unknown>;
      const id = String(r.id ?? "");
      const specs = mapFrequencyControlSpecs(r.frequency_control_specs);
      if (id && specs) {
        dataByAdSetId.set(id, { frequencyControlSpecs: specs });
      } else if (id && r.rf_prediction_id) {
        rfPredictionAdSets.push({
          id,
          predictionId: String(r.rf_prediction_id),
        });
      }
    }

    url = body.paging?.next ?? null;
  }

  // Fetch R&F prediction frequency caps in parallel
  if (rfPredictionAdSets.length > 0) {
    const results = await Promise.allSettled(
      rfPredictionAdSets.map(async ({ id, predictionId }) => {
        const avgFreq = await fetchRfPredictionAvgFrequency(predictionId, headers);
        return { id, avgFreq };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.avgFreq != null) {
        dataByAdSetId.set(result.value.id, {
          insightsFrequency: result.value.avgFreq,
        });
      }
    }
  }

  return dataByAdSetId;
}

/**
 * Fetch a ReachFrequencyPrediction by ID and calculate the estimated
 * average frequency (impression / reach) — this matches the "Average
 * frequency" shown in Meta's Reservation Estimates panel.
 */
async function fetchRfPredictionAvgFrequency(
  predictionId: string,
  headers: Record<string, string>,
): Promise<number | undefined> {
  const url = `${META_API_BASE}/${predictionId}?fields=external_reach,external_impression`;
  const response = await fetch(url, { headers });
  if (!response.ok) return undefined;

  const body = (await response.json()) as {
    external_reach?: number;
    external_impression?: number;
  };
  if (!body.external_reach || !body.external_impression || body.external_reach === 0) return undefined;
  return body.external_impression / body.external_reach;
}

/**
 * Fetch the full campaign hierarchy (campaigns → ad sets → ads + creatives)
 * from a Meta ad account using the Graph API v21.0.
 */
export async function fetchMetaCampaigns(params: {
  adAccountId: string;
  accessToken: string;
}): Promise<Omit<MetaCampaignSnapshot, "id" | "uploadId">[]> {
  const adAccountId = normalizeAdAccountId(params.adAccountId);
  const fetchedAt = new Date().toISOString();
  const allCampaigns: Omit<MetaCampaignSnapshot, "id" | "uploadId">[] = [];

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
  });

  const headers = { Authorization: `Bearer ${params.accessToken}` };

  let url: string | null =
    `${META_API_BASE}/${adAccountId}/campaigns?${queryParams.toString()}`;

  while (url) {
    const response = await fetch(url, { headers });

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

  // Fetch frequency data separately (dropped from nested expansions)
  const freqData = await fetchAdSetFrequencyData(adAccountId, headers);

  // Merge frequency data into ad sets
  for (const campaign of allCampaigns) {
    for (const adSet of campaign.adSets) {
      const data = freqData.get(adSet.metaAdSetId);
      if (data?.frequencyControlSpecs && !adSet.frequencyControlSpecs) {
        adSet.frequencyControlSpecs = data.frequencyControlSpecs;
      }
      if (data?.insightsFrequency != null) {
        adSet.insightsFrequency = data.insightsFrequency;
      }
    }
  }

  return allCampaigns;
}
