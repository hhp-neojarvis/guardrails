import type { CampaignGroup } from "@guardrails/shared";
import type {
  MetaCampaignSnapshot,
  MetaAdSetSnapshot,
  MatchSuggestion,
  MatchCandidate,
  MatchSignals,
  LineItemMatchSuggestion,
  AdSetMatchCandidate,
  OneToManyMatchSuggestion,
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
 * Score a single CampaignGroup against all MetaCampaigns and return sorted candidates.
 * Shared helper used by both generateMatchSuggestions and generateOneToManyMatchSuggestions.
 */
function scoreCampaignGroupCandidates(
  group: CampaignGroup,
  metaCampaigns: MetaCampaignSnapshot[],
): MatchCandidate[] {
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
  return candidates;
}

/**
 * Generate match suggestions between Excel campaign groups and fetched Meta campaigns.
 * Uses a weighted scoring algorithm with name, geo, and date signals.
 */
export function generateMatchSuggestions(
  campaignGroups: CampaignGroup[],
  metaCampaigns: MetaCampaignSnapshot[]
): MatchSuggestion[] {
  return campaignGroups.map((group) => ({
    campaignGroupId: group.id ?? "",
    campaignGroupName: group.campaignName,
    candidates: scoreCampaignGroupCandidates(group, metaCampaigns),
  }));
}

// ─── 1:N (One Campaign) Strategy ──────────────────────────────────────────

const LINE_ITEM_SCORE_THRESHOLD = 0.15;
const LINE_ITEM_NAME_WEIGHT = 0.5;
const LINE_ITEM_DATE_WEIGHT = 0.3;
const LINE_ITEM_BUDGET_WEIGHT = 0.2;

/**
 * Compute name similarity between a line item campaign name and an ad set name.
 */
function computeLineItemNameScore(lineItemName: string, adSetName: string): number {
  const planTokens = new Set(tokenize(lineItemName));
  const metaTokens = new Set(tokenize(adSetName));
  if (planTokens.size === 0 && metaTokens.size === 0) return 0;
  return jaccardSimilarity(planTokens, metaTokens);
}

/**
 * Compute date overlap between a line item's date range and an ad set's date range.
 */
function computeLineItemDateScore(
  lineItemStartDate: string | undefined,
  lineItemEndDate: string | undefined,
  adSet: MetaAdSetSnapshot,
): number {
  if (!lineItemStartDate || !lineItemEndDate) return 0;
  if (!adSet.startTime || !adSet.endTime) return 0;

  const planStart = new Date(lineItemStartDate);
  const planEnd = new Date(lineItemEndDate);
  const metaStart = new Date(adSet.startTime);
  const metaEnd = new Date(adSet.endTime);

  return computeDateOverlap(planStart, planEnd, metaStart, metaEnd);
}

/**
 * Compute budget proximity between a line item budget and an ad set budget.
 * Returns 1.0 for exact match, decreasing linearly. Returns 0 if either is missing.
 */
function computeLineItemBudgetScore(
  lineItemBudget: string | undefined,
  adSet: MetaAdSetSnapshot,
): number {
  const planBudget = lineItemBudget ? parseFloat(lineItemBudget) : NaN;
  if (isNaN(planBudget) || planBudget === 0) return 0;

  let metaBudget = 0;
  if (adSet.lifetimeBudget) {
    metaBudget = parseFloat(adSet.lifetimeBudget);
  } else if (adSet.dailyBudget && adSet.startTime && adSet.endTime) {
    const start = new Date(adSet.startTime).getTime();
    const end = new Date(adSet.endTime).getTime();
    const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    metaBudget = parseFloat(adSet.dailyBudget) * days;
  }

  if (metaBudget === 0) return 0;

  const diff = Math.abs(planBudget - metaBudget) / Math.max(planBudget, metaBudget);
  return Math.max(0, 1 - diff);
}

/**
 * Generate line item → ad set match suggestions within a single campaign.
 * Each line item in the group is matched against ad sets in the given Meta campaign.
 */
export function generateLineItemMatchSuggestions(
  group: CampaignGroup,
  metaCampaign: MetaCampaignSnapshot,
): LineItemMatchSuggestion[] {
  return group.lineItems.map((lineItem, lineItemIndex) => {
    const candidates: AdSetMatchCandidate[] = [];

    for (const adSet of metaCampaign.adSets) {
      const nameScore = computeLineItemNameScore(lineItem.campaignName, adSet.name);
      const dateScore = computeLineItemDateScore(lineItem.startDate, lineItem.endDate, adSet);
      const budgetScore = computeLineItemBudgetScore(lineItem.budget, adSet);

      const score =
        nameScore * LINE_ITEM_NAME_WEIGHT +
        dateScore * LINE_ITEM_DATE_WEIGHT +
        budgetScore * LINE_ITEM_BUDGET_WEIGHT;

      if (score >= LINE_ITEM_SCORE_THRESHOLD) {
        // geoScore is not used for ad-set-level matching (geo targeting is
        // compared at the campaign level). Set to 0 to reflect that it is not
        // scored, while reusing the shared MatchSignals type.
        const signals: MatchSignals = {
          nameScore,
          geoScore: 0,
          dateScore,
        };
        candidates.push({
          metaAdSetId: adSet.metaAdSetId,
          metaAdSetName: adSet.name,
          parentMetaCampaignId: metaCampaign.metaCampaignId,
          score: Math.round(score * 1000) / 1000,
          signals,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    return {
      lineItemIndex,
      lineItemName: lineItem.campaignName,
      candidates,
    };
  });
}

/**
 * Generate 1:N match suggestions: match each group to campaign candidates.
 * Line item suggestions are NOT pre-computed — fetch them on-demand via
 * generateLineItemMatchSuggestions when the user selects a campaign.
 */
export function generateOneToManyMatchSuggestions(
  campaignGroups: CampaignGroup[],
  metaCampaigns: MetaCampaignSnapshot[],
): OneToManyMatchSuggestion[] {
  return campaignGroups.map((group) => ({
    campaignGroupId: group.id ?? "",
    campaignGroupName: group.campaignName,
    metaCampaignCandidates: scoreCampaignGroupCandidates(group, metaCampaigns),
    lineItemSuggestions: [],
  }));
}
