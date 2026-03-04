import { describe, it, expect } from "vitest";
import {
  parseTargeting,
  parseBuyType,
  parseAsset,
  parseInventory,
  interpretLineItem,
  deriveCampaignBuyType,
} from "./column-interpreter.js";
import type { ExcelRow, LineItemConfig } from "@guardrails/shared";

// ─── parseTargeting ──────────────────────────────────────────────────────────

describe("parseTargeting", () => {
  it("parses standard age range with M+F", () => {
    const result = parseTargeting("18-24 M+F");
    expect(result).toEqual({
      ageMin: 18,
      ageMax: 24,
      genders: [1, 2],
      raw: "18-24 M+F",
    });
  });

  it("parses age range with en-dash", () => {
    const result = parseTargeting("25–34 Males");
    expect(result).toEqual({
      ageMin: 25,
      ageMax: 34,
      genders: [1],
      raw: "25–34 Males",
    });
  });

  it("parses female only", () => {
    const result = parseTargeting("18-65 F");
    expect(result).toEqual({
      ageMin: 18,
      ageMax: 65,
      genders: [2],
      raw: "18-65 F",
    });
  });

  it("parses Females keyword", () => {
    const result = parseTargeting("18-35 Females");
    expect(result).toEqual({
      ageMin: 18,
      ageMax: 35,
      genders: [2],
      raw: "18-35 Females",
    });
  });

  it("defaults to both genders when not specified", () => {
    const result = parseTargeting("13-65");
    expect(result).toEqual({
      ageMin: 13,
      ageMax: 65,
      genders: [1, 2],
      raw: "13-65",
    });
  });

  it("clamps age to 13-65 range", () => {
    const result = parseTargeting("10-70 M+F");
    expect(result).toEqual({
      ageMin: 13,
      ageMax: 65,
      genders: [1, 2],
      raw: "10-70 M+F",
    });
  });

  it("parses 'All' as both genders", () => {
    const result = parseTargeting("18-44 All");
    expect(result).toEqual({
      ageMin: 18,
      ageMax: 44,
      genders: [1, 2],
      raw: "18-44 All",
    });
  });

  it("returns null for empty string", () => {
    expect(parseTargeting("")).toBeNull();
    expect(parseTargeting("  ")).toBeNull();
  });

  it("returns null for unrecognized format", () => {
    expect(parseTargeting("broad audience")).toBeNull();
  });
});

// ─── parseBuyType ────────────────────────────────────────────────────────────

describe("parseBuyType", () => {
  it("parses RNF", () => {
    const result = parseBuyType("RNF");
    expect(result).toEqual({
      objective: "OUTCOME_AWARENESS",
      buyingType: "REACH_AND_FREQUENCY",
      raw: "RNF",
    });
  });

  it("parses R&F (case-insensitive)", () => {
    const result = parseBuyType("r&f");
    expect(result).toEqual({
      objective: "OUTCOME_AWARENESS",
      buyingType: "REACH_AND_FREQUENCY",
      raw: "r&f",
    });
  });

  it("parses Auction", () => {
    const result = parseBuyType("Auction");
    expect(result).toEqual({
      objective: "OUTCOME_AWARENESS",
      buyingType: "AUCTION",
      raw: "Auction",
    });
  });

  it("parses Fixed as Reserved", () => {
    const result = parseBuyType("Fixed");
    expect(result).toEqual({
      objective: "REACH",
      buyingType: "RESERVED",
      raw: "Fixed",
    });
  });

  it("parses Reserved", () => {
    const result = parseBuyType("Reserved");
    expect(result).toEqual({
      objective: "REACH",
      buyingType: "RESERVED",
      raw: "Reserved",
    });
  });

  it("returns null for empty string", () => {
    expect(parseBuyType("")).toBeNull();
  });

  it("returns null for unrecognized value", () => {
    expect(parseBuyType("CPM")).toBeNull();
  });
});

// ─── parseAsset ──────────────────────────────────────────────────────────────

describe("parseAsset", () => {
  it("parses video with duration", () => {
    const result = parseAsset("6 sec Video");
    expect(result).toEqual({
      format: "VIDEO",
      videoDurationSeconds: 6,
      raw: "6 sec Video",
    });
  });

  it("parses video with s suffix", () => {
    const result = parseAsset("15s Video");
    expect(result).toEqual({
      format: "VIDEO",
      videoDurationSeconds: 15,
      raw: "15s Video",
    });
  });

  it("parses video without duration", () => {
    const result = parseAsset("Video");
    expect(result).toEqual({
      format: "VIDEO",
      videoDurationSeconds: undefined,
      raw: "Video",
    });
  });

  it("parses image", () => {
    const result = parseAsset("Image");
    expect(result).toEqual({
      format: "IMAGE",
      videoDurationSeconds: undefined,
      raw: "Image",
    });
  });

  it("parses static as image", () => {
    const result = parseAsset("Static");
    expect(result).toEqual({
      format: "IMAGE",
      videoDurationSeconds: undefined,
      raw: "Static",
    });
  });

  it("parses carousel", () => {
    const result = parseAsset("Carousel");
    expect(result).toEqual({
      format: "CAROUSEL",
      videoDurationSeconds: undefined,
      raw: "Carousel",
    });
  });

  it("returns null for empty string", () => {
    expect(parseAsset("")).toBeNull();
  });

  it("returns null for unrecognized value", () => {
    expect(parseAsset("GIF")).toBeNull();
  });
});

// ─── parseInventory ──────────────────────────────────────────────────────────

describe("parseInventory", () => {
  it("parses Feeds + Stories", () => {
    const result = parseInventory("Feeds + Stories");
    expect(result).toEqual({
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed", "story"],
      instagramPositions: ["stream", "story"],
      raw: "Feeds + Stories",
    });
  });

  it("parses Reels only", () => {
    const result = parseInventory("Reels");
    expect(result).toEqual({
      publisherPlatforms: ["instagram"],
      facebookPositions: undefined,
      instagramPositions: ["reels"],
      raw: "Reels",
    });
  });

  it("parses Feeds only", () => {
    const result = parseInventory("Feeds");
    expect(result).toEqual({
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed"],
      instagramPositions: ["stream"],
      raw: "Feeds",
    });
  });

  it("parses comma-separated tokens", () => {
    const result = parseInventory("Feed, Stories, Reels");
    expect(result).toEqual({
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed", "story"],
      instagramPositions: ["stream", "story", "reels"],
      raw: "Feed, Stories, Reels",
    });
  });

  it("parses in-stream", () => {
    const result = parseInventory("In-Stream");
    expect(result).toEqual({
      publisherPlatforms: ["facebook"],
      facebookPositions: ["instream_video"],
      instagramPositions: undefined,
      raw: "In-Stream",
    });
  });

  it("returns null for empty string", () => {
    expect(parseInventory("")).toBeNull();
  });

  it("returns null for unrecognized value", () => {
    expect(parseInventory("TikTok")).toBeNull();
  });
});

// ─── interpretLineItem ───────────────────────────────────────────────────────

describe("interpretLineItem", () => {
  const baseRow: ExcelRow = {
    markets: "Delhi",
    channel: "Meta",
    woa: "",
    targeting: "18-24 M+F",
    buyType: "RNF",
    asset: "6 sec Video",
    inventory: "Feeds + Stories",
    totalReach: "1000000",
    avgFrequency: "3",
    budget: "50000",
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    campaignName: "Test Campaign",
  };

  it("interprets all fields successfully", () => {
    const result = interpretLineItem(baseRow);
    expect(result.targeting).toBeTruthy();
    expect(result.buyType).toBeTruthy();
    expect(result.asset).toBeTruthy();
    expect(result.inventory).toBeTruthy();
    expect(result.warnings).toEqual([]);
  });

  it("collects warnings for unrecognized values", () => {
    const row: ExcelRow = {
      ...baseRow,
      targeting: "broad audience",
      buyType: "CPM",
      asset: "GIF",
      inventory: "TikTok",
    };

    const result = interpretLineItem(row);
    expect(result.targeting).toBeUndefined();
    expect(result.buyType).toBeUndefined();
    expect(result.asset).toBeUndefined();
    expect(result.inventory).toBeUndefined();
    expect(result.warnings).toHaveLength(4);
  });

  it("handles empty fields without warnings", () => {
    const row: ExcelRow = {
      ...baseRow,
      targeting: "",
      buyType: "",
      asset: "",
      inventory: "",
    };

    const result = interpretLineItem(row);
    expect(result.warnings).toEqual([]);
  });
});

// ─── deriveCampaignBuyType ───────────────────────────────────────────────────

describe("deriveCampaignBuyType", () => {
  it("returns first non-null buyType", () => {
    const configs: LineItemConfig[] = [
      { warnings: [] },
      {
        buyType: {
          objective: "OUTCOME_AWARENESS",
          buyingType: "REACH_AND_FREQUENCY",
          raw: "RNF",
        },
        warnings: [],
      },
    ];

    const result = deriveCampaignBuyType(configs);
    expect(result?.buyingType).toBe("REACH_AND_FREQUENCY");
  });

  it("returns undefined when no buyType found", () => {
    const configs: LineItemConfig[] = [{ warnings: [] }, { warnings: [] }];
    expect(deriveCampaignBuyType(configs)).toBeUndefined();
  });
});
