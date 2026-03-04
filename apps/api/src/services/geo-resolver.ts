import type { GeoIntent, ResolvedGeoTarget, GeoResolutionResult } from "@guardrails/shared";
import { db, geoCache, eq, and } from "@guardrails/db";

/** Map GeoIntent type to Meta location_types parameter */
function metaLocationTypes(type: GeoIntent["type"]): string[] {
  switch (type) {
    case "city":
      return ["city"];
    case "region":
      return ["region"];
    case "country":
      return ["country"];
  }
}

/** Default country code for V1 — India */
export function deriveCountryCode(intent: GeoIntent): string {
  return intent.countryCode || "IN";
}

/**
 * Check the geo_cache table for a cached result.
 */
async function checkCache(
  query: string,
  locationType: string,
  countryCode: string,
): Promise<ResolvedGeoTarget | null> {
  const rows = await db
    .select()
    .from(geoCache)
    .where(
      and(
        eq(geoCache.query, query.toLowerCase()),
        eq(geoCache.locationType, locationType),
        eq(geoCache.countryCode, countryCode),
      ),
    );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    key: row.metaKey,
    name: row.metaName,
    type: row.metaType,
    countryCode: row.metaCountryCode ?? countryCode,
    region: row.metaRegion ?? "",
    regionId: row.metaRegionId ?? 0,
    supportsRegion: row.metaType === "region",
    supportsCity: row.metaType === "city",
  };
}

/**
 * Cache a resolved geo target in the geo_cache table.
 */
async function cacheResult(
  query: string,
  locationType: string,
  countryCode: string,
  target: ResolvedGeoTarget,
): Promise<void> {
  try {
    await db.insert(geoCache).values({
      query: query.toLowerCase(),
      locationType,
      countryCode,
      metaKey: target.key,
      metaName: target.name,
      metaType: target.type,
      metaRegion: target.region || null,
      metaRegionId: target.regionId || null,
      metaCountryCode: target.countryCode || null,
    });
  } catch (err: unknown) {
    // Unique constraint violation — already cached (race condition)
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return;
    }
    throw err;
  }
}

/**
 * Call Meta's geo search API to resolve a location name.
 */
async function searchMetaGeo(
  name: string,
  locationTypes: string[],
  countryCode: string,
  accessToken: string,
): Promise<ResolvedGeoTarget | null> {
  const params = new URLSearchParams({
    type: "adgeolocation",
    q: name,
    location_types: JSON.stringify(locationTypes),
    country_code: countryCode,
    access_token: accessToken,
  });

  const response = await fetch(
    `https://graph.facebook.com/v21.0/search?${params.toString()}`,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta geo search failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    data: Array<{
      key: string;
      name: string;
      type: string;
      country_code: string;
      country_name?: string;
      region: string;
      region_id: number;
      supports_region: boolean;
      supports_city: boolean;
    }>;
  };

  if (!data.data || data.data.length === 0) {
    return null;
  }

  // Take the first (best) match
  const match = data.data[0];
  return {
    key: match.key,
    name: match.name,
    type: match.type,
    countryCode: match.country_code,
    countryName: match.country_name,
    region: match.region,
    regionId: match.region_id,
    supportsRegion: match.supports_region,
    supportsCity: match.supports_city,
  };
}

/**
 * Resolve an array of GeoIntents against Meta's geo search API.
 * Uses cache-first strategy: checks geo_cache before making API calls.
 * Unresolvable intents are collected (don't fail the pipeline).
 */
export async function resolveGeoTargets(
  intents: GeoIntent[],
  accessToken: string,
): Promise<GeoResolutionResult> {
  const resolved: ResolvedGeoTarget[] = [];
  const unresolved: GeoResolutionResult["unresolved"] = [];

  for (const intent of intents) {
    const countryCode = deriveCountryCode(intent);
    const locationTypes = metaLocationTypes(intent.type);
    const locationType = locationTypes[0];

    try {
      // 1. Check cache first
      const cached = await checkCache(intent.name, locationType, countryCode);
      if (cached) {
        resolved.push(cached);
        continue;
      }

      // 2. Call Meta API
      const result = await searchMetaGeo(
        intent.name,
        locationTypes,
        countryCode,
        accessToken,
      );

      if (!result) {
        unresolved.push({
          intent,
          reason: `No results found for "${intent.name}" (${intent.type}) in ${countryCode}`,
        });
        continue;
      }

      // 3. Cache the result
      await cacheResult(intent.name, locationType, countryCode, result);

      resolved.push(result);
    } catch (err) {
      unresolved.push({
        intent,
        reason: `API error resolving "${intent.name}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { resolved, unresolved };
}
