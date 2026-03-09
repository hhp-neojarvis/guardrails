import type { CampaignGroup } from "@guardrails/shared";
import type {
  MetaCampaignSnapshot,
  MatchSuggestion,
  MatchCandidate,
  MatchSignals,
} from "@guardrails/shared";

const SCORE_THRESHOLD = 0.2;
const NAME_WEIGHT = 0.4;
const GEO_WEIGHT = 0.35;
const DATE_WEIGHT = 0.25;

/**
 * Tokenize a string by splitting on whitespace, hyphens, underscores, and slashes,
 * lowercasing, and filtering tokens with length > 1.
 */
export function tokenize(s: string): string[] {
  return s
    .split(/[\s\-_\/]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}

/**
 * Compute Jaccard similarity between two sets: |intersection| / |union|.
 * Returns 0 if both sets are empty.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersectionSize = 0;
  for (const item of a) {
    if (b.has(item)) intersectionSize++;
  }
  const unionSize = a.size + b.size - intersectionSize;
  if (unionSize === 0) return 0;
  return intersectionSize / unionSize;
}

/**
 * Extract all geo keys from a Meta campaign's ad sets' targeting.geoLocations.
 * Collects country codes, region keys, and city keys into a flat set.
 */
export function extractMetaGeoKeys(
  metaCampaign: MetaCampaignSnapshot
): Set<string> {
  const keys = new Set<string>();
  for (const adSet of metaCampaign.adSets) {
    const geo = adSet.targeting.geoLocations;
    if (geo.countries) {
      for (const c of geo.countries) keys.add(c);
    }
    if (geo.regions) {
      for (const r of geo.regions) keys.add(r.key);
    }
    if (geo.cities) {
      for (const c of geo.cities) keys.add(c.key);
    }
  }
  return keys;
}

/**
 * Compute date overlap ratio between two date ranges.
 * Returns overlapDays / unionDays. Returns 0 if unionDays <= 0.
 */
export function computeDateOverlap(
  planStart: Date,
  planEnd: Date,
  metaStart: Date,
  metaEnd: Date
): number {
  const overlapMs = Math.max(
    0,
    Math.min(planEnd.getTime(), metaEnd.getTime()) -
      Math.max(planStart.getTime(), metaStart.getTime())
  );
  const unionMs =
    Math.max(planEnd.getTime(), metaEnd.getTime()) -
    Math.min(planStart.getTime(), metaStart.getTime());
  if (unionMs <= 0) return 0;
  const msPerDay = 86400000;
  return overlapMs / msPerDay / (unionMs / msPerDay);
}

function computeNameScore(planName: string, metaName: string): number {
  const planTokens = new Set(tokenize(planName));
  const metaTokens = new Set(tokenize(metaName));
  if (planTokens.size === 0 && metaTokens.size === 0) return 0;
  return jaccardSimilarity(planTokens, metaTokens);
}

function computeGeoScore(
  campaignGroup: CampaignGroup,
  metaCampaign: MetaCampaignSnapshot
): number {
  const planGeoKeys = new Set(
    campaignGroup.resolvedGeoTargets.map((g) => g.key)
  );
  const metaGeoKeys = extractMetaGeoKeys(metaCampaign);

  if (planGeoKeys.size === 0 && metaGeoKeys.size === 0) return 1.0;
  if (planGeoKeys.size === 0 || metaGeoKeys.size === 0) return 0;

  return jaccardSimilarity(planGeoKeys, metaGeoKeys);
}

function computeDateScore(
  campaignGroup: CampaignGroup,
  metaCampaign: MetaCampaignSnapshot
): number {
  // Plan range: earliest startDate and latest endDate from lineItems
  const planStarts: Date[] = [];
  const planEnds: Date[] = [];
  for (const item of campaignGroup.lineItems) {
    if (item.startDate) planStarts.push(new Date(item.startDate));
    if (item.endDate) planEnds.push(new Date(item.endDate));
  }
  if (planStarts.length === 0 || planEnds.length === 0) return 0;

  const planStart = new Date(
    Math.min(...planStarts.map((d) => d.getTime()))
  );
  const planEnd = new Date(Math.max(...planEnds.map((d) => d.getTime())));

  // Meta range: earliest startTime and latest endTime from adSets
  const metaStarts: Date[] = [];
  const metaEnds: Date[] = [];
  for (const adSet of metaCampaign.adSets) {
    if (adSet.startTime) metaStarts.push(new Date(adSet.startTime));
    if (adSet.endTime) metaEnds.push(new Date(adSet.endTime));
  }
  if (metaStarts.length === 0 || metaEnds.length === 0) return 0;

  const metaStart = new Date(
    Math.min(...metaStarts.map((d) => d.getTime()))
  );
  const metaEnd = new Date(Math.max(...metaEnds.map((d) => d.getTime())));

  return computeDateOverlap(planStart, planEnd, metaStart, metaEnd);
}

/**
 * Generate match suggestions between Excel campaign groups and fetched Meta campaigns.
 * Uses a weighted scoring algorithm with name, geo, and date signals.
 */
export function generateMatchSuggestions(
  campaignGroups: CampaignGroup[],
  metaCampaigns: MetaCampaignSnapshot[]
): MatchSuggestion[] {
  return campaignGroups.map((group) => {
    const candidates: MatchCandidate[] = [];

    for (const meta of metaCampaigns) {
      const nameScore = computeNameScore(group.campaignName, meta.name);
      const geoScore = computeGeoScore(group, meta);
      const dateScore = computeDateScore(group, meta);

      const score =
        nameScore * NAME_WEIGHT +
        geoScore * GEO_WEIGHT +
        dateScore * DATE_WEIGHT;

      if (score >= SCORE_THRESHOLD) {
        const signals: MatchSignals = { nameScore, geoScore, dateScore };
        candidates.push({
          metaCampaignId: meta.metaCampaignId,
          metaCampaignName: meta.name,
          score: Math.round(score * 1000) / 1000,
          signals,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    return {
      campaignGroupId: group.id ?? "",
      campaignGroupName: group.campaignName,
      candidates,
    };
  });
}
