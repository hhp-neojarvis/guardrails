import type {
  ExcelRow,
  TargetingConfig,
  BuyTypeConfig,
  AssetConfig,
  InventoryConfig,
  LineItemConfig,
} from "@guardrails/shared";

// ─── Targeting Parser ────────────────────────────────────────────────────────

export function parseTargeting(raw: string): TargetingConfig | null {
  if (!raw || !raw.trim()) return null;

  const normalized = raw.trim();

  // Extract age range: "18-24", "18–65", "25 - 34"
  const ageMatch = normalized.match(/(\d+)\s*[-–]\s*(\d+)/);
  let ageMin = 18;
  let ageMax = 65;

  if (ageMatch) {
    ageMin = Math.max(13, Math.min(65, parseInt(ageMatch[1], 10)));
    ageMax = Math.max(13, Math.min(65, parseInt(ageMatch[2], 10)));
  } else {
    // No age range found — can't parse
    return null;
  }

  // Extract gender
  const upper = normalized.toUpperCase();
  let genders: number[];

  if (/\bM\s*\+\s*F\b/i.test(normalized) || /\bALL\b/i.test(normalized) || /\bBOTH\b/i.test(normalized) || (/\bMALES?\b/i.test(normalized) && /\bFEMALES?\b/i.test(normalized))) {
    genders = [1, 2];
  } else if (/\bF\b/.test(normalized) || /\bFEMALES?\b/i.test(normalized)) {
    genders = [2];
  } else if (/\bM\b/.test(normalized) || /\bMALES?\b/i.test(normalized)) {
    genders = [1];
  } else {
    // Default to all genders if not specified
    genders = [1, 2];
  }

  return { ageMin, ageMax, genders, raw };
}

// ─── Buy Type Parser ─────────────────────────────────────────────────────────

const BUY_TYPE_MAP: Record<string, { objective: string; buyingType: string }> = {
  "rnf": { objective: "OUTCOME_AWARENESS", buyingType: "REACH_AND_FREQUENCY" },
  "r&f": { objective: "OUTCOME_AWARENESS", buyingType: "REACH_AND_FREQUENCY" },
  "reach and frequency": { objective: "OUTCOME_AWARENESS", buyingType: "REACH_AND_FREQUENCY" },
  "reach & frequency": { objective: "OUTCOME_AWARENESS", buyingType: "REACH_AND_FREQUENCY" },
  "auction": { objective: "OUTCOME_AWARENESS", buyingType: "AUCTION" },
  "fixed": { objective: "REACH", buyingType: "RESERVED" },
  "reserved": { objective: "REACH", buyingType: "RESERVED" },
};

export function parseBuyType(raw: string): BuyTypeConfig | null {
  if (!raw || !raw.trim()) return null;

  const key = raw.trim().toLowerCase();
  const match = BUY_TYPE_MAP[key];

  if (!match) return null;

  return { objective: match.objective, buyingType: match.buyingType, raw };
}

// ─── Asset Parser ────────────────────────────────────────────────────────────

export function parseAsset(raw: string): AssetConfig | null {
  if (!raw || !raw.trim()) return null;

  const normalized = raw.trim();
  const upper = normalized.toUpperCase();

  // Detect format
  let format: string | null = null;
  if (/\bVIDEO\b/i.test(normalized)) {
    format = "VIDEO";
  } else if (/\bIMAGE\b/i.test(normalized) || /\bSTATIC\b/i.test(normalized) || /\bPHOTO\b/i.test(normalized)) {
    format = "IMAGE";
  } else if (/\bCAROUSEL\b/i.test(normalized)) {
    format = "CAROUSEL";
  }

  if (!format) return null;

  // Extract duration for video: "6s", "6 sec", "15s", "6 second"
  let videoDurationSeconds: number | undefined;
  if (format === "VIDEO") {
    const durationMatch = normalized.match(/(\d+)\s*s(?:ec(?:ond)?s?)?/i);
    if (durationMatch) {
      videoDurationSeconds = parseInt(durationMatch[1], 10);
    }
  }

  return { format, videoDurationSeconds, raw };
}

// ─── Inventory Parser ────────────────────────────────────────────────────────

interface PositionMapping {
  platform: "facebook" | "instagram";
  position: string;
}

const INVENTORY_TOKEN_MAP: Record<string, PositionMapping[]> = {
  "feeds": [
    { platform: "facebook", position: "feed" },
    { platform: "instagram", position: "stream" },
  ],
  "feed": [
    { platform: "facebook", position: "feed" },
    { platform: "instagram", position: "stream" },
  ],
  "stories": [
    { platform: "facebook", position: "story" },
    { platform: "instagram", position: "story" },
  ],
  "story": [
    { platform: "facebook", position: "story" },
    { platform: "instagram", position: "story" },
  ],
  "reels": [
    { platform: "instagram", position: "reels" },
  ],
  "reel": [
    { platform: "instagram", position: "reels" },
  ],
  "in-stream": [
    { platform: "facebook", position: "instream_video" },
  ],
  "instream": [
    { platform: "facebook", position: "instream_video" },
  ],
};

export function parseInventory(raw: string): InventoryConfig | null {
  if (!raw || !raw.trim()) return null;

  // Split on +, &, comma
  const tokens = raw.split(/[+,&]/).map((t) => t.trim().toLowerCase()).filter(Boolean);

  const platforms = new Set<string>();
  const fbPositions: string[] = [];
  const igPositions: string[] = [];

  let anyMatched = false;
  for (const token of tokens) {
    const mappings = INVENTORY_TOKEN_MAP[token];
    if (mappings) {
      anyMatched = true;
      for (const m of mappings) {
        platforms.add(m.platform);
        if (m.platform === "facebook" && !fbPositions.includes(m.position)) {
          fbPositions.push(m.position);
        }
        if (m.platform === "instagram" && !igPositions.includes(m.position)) {
          igPositions.push(m.position);
        }
      }
    }
  }

  if (!anyMatched) return null;

  return {
    publisherPlatforms: [...platforms].sort(),
    facebookPositions: fbPositions.length > 0 ? fbPositions : undefined,
    instagramPositions: igPositions.length > 0 ? igPositions : undefined,
    raw,
  };
}

// ─── Line Item Interpreter ───────────────────────────────────────────────────

export function interpretLineItem(row: ExcelRow): LineItemConfig {
  const warnings: string[] = [];

  const targeting = parseTargeting(row.targeting);
  if (!targeting && row.targeting?.trim()) {
    warnings.push(`Unrecognized targeting: "${row.targeting}"`);
  }

  const buyType = parseBuyType(row.buyType);
  if (!buyType && row.buyType?.trim()) {
    warnings.push(`Unrecognized buy type: "${row.buyType}"`);
  }

  const asset = parseAsset(row.asset);
  if (!asset && row.asset?.trim()) {
    warnings.push(`Unrecognized asset: "${row.asset}"`);
  }

  const inventory = parseInventory(row.inventory);
  if (!inventory && row.inventory?.trim()) {
    warnings.push(`Unrecognized inventory: "${row.inventory}"`);
  }

  return {
    targeting: targeting ?? undefined,
    buyType: buyType ?? undefined,
    asset: asset ?? undefined,
    inventory: inventory ?? undefined,
    warnings,
  };
}

// ─── Campaign-level Buy Type ─────────────────────────────────────────────────

export function deriveCampaignBuyType(configs: LineItemConfig[]): BuyTypeConfig | undefined {
  for (const config of configs) {
    if (config.buyType) {
      return config.buyType;
    }
  }
  return undefined;
}
