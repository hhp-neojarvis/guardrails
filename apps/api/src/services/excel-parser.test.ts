import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseExcel, groupIntoCampaigns } from "./excel-parser";

function makeExcelBuffer(rows: Record<string, unknown>[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return buf;
}

describe("parseExcel", () => {
  it("parses valid rows with standard headers", () => {
    const buffer = makeExcelBuffer([
      {
        Markets: "Maharashtra (Amravati)",
        Channel: "Meta - Pre-launch",
        WOA: "4",
        Targeting: "18-24 M+F",
        "Buy Type": "Auction",
        Asset: "Video",
        Inventory: "Feeds",
        "Total Reach": "100000",
        "Avg Frequency": "3",
        Budget: "50000",
        "Start Date": "2024-01-01",
        "End Date": "2024-01-31",
        "Campaign Name": "Test Campaign",
      },
    ]);

    const rows = parseExcel(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].markets).toBe("Maharashtra (Amravati)");
    expect(rows[0].channel).toBe("Meta - Pre-launch");
    expect(rows[0].buyType).toBe("Auction");
    expect(rows[0].campaignName).toBe("Test Campaign");
  });

  it("parses multiple rows", () => {
    const buffer = makeExcelBuffer([
      { Markets: "Delhi", Channel: "Meta", Budget: "10000" },
      { Markets: "Mumbai", Channel: "YouTube", Budget: "20000" },
    ]);

    const rows = parseExcel(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].markets).toBe("Delhi");
    expect(rows[1].markets).toBe("Mumbai");
  });

  it("throws on empty Markets column", () => {
    const buffer = makeExcelBuffer([
      { Markets: "", Channel: "Meta" },
    ]);

    expect(() => parseExcel(buffer)).toThrow("Row 2: Markets column is empty");
  });

  it("throws on empty Channel column", () => {
    const buffer = makeExcelBuffer([
      { Markets: "Delhi", Channel: "" },
    ]);

    expect(() => parseExcel(buffer)).toThrow("Row 2: Channel column is empty");
  });

  it("throws on empty sheet", () => {
    const ws = XLSX.utils.aoa_to_sheet([]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    expect(() => parseExcel(buf)).toThrow("empty");
  });

  it("handles case-insensitive headers", () => {
    const buffer = makeExcelBuffer([
      { markets: "Delhi", channel: "Meta", "buy type": "RNF" },
    ]);

    const rows = parseExcel(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].markets).toBe("Delhi");
    expect(rows[0].buyType).toBe("RNF");
  });
});

describe("groupIntoCampaigns", () => {
  it("groups rows by Markets + Channel", () => {
    const rows = [
      { markets: "Delhi", channel: "Meta", campaignName: "Camp1", woa: "", targeting: "", buyType: "", asset: "", inventory: "", totalReach: "", avgFrequency: "", budget: "", startDate: "", endDate: "" },
      { markets: "Delhi", channel: "Meta", campaignName: "Camp2", woa: "", targeting: "", buyType: "", asset: "", inventory: "", totalReach: "", avgFrequency: "", budget: "", startDate: "", endDate: "" },
      { markets: "Mumbai", channel: "YouTube", campaignName: "Camp3", woa: "", targeting: "", buyType: "", asset: "", inventory: "", totalReach: "", avgFrequency: "", budget: "", startDate: "", endDate: "" },
    ];

    const groups = groupIntoCampaigns(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].markets).toBe("Delhi");
    expect(groups[0].channel).toBe("Meta");
    expect(groups[0].lineItems).toHaveLength(2);
    expect(groups[0].campaignName).toBe("Camp1"); // takes first row's name
    expect(groups[1].markets).toBe("Mumbai");
    expect(groups[1].lineItems).toHaveLength(1);
  });

  it("groups case-insensitively", () => {
    const rows = [
      { markets: "Delhi", channel: "Meta", campaignName: "A", woa: "", targeting: "", buyType: "", asset: "", inventory: "", totalReach: "", avgFrequency: "", budget: "", startDate: "", endDate: "" },
      { markets: "delhi", channel: "meta", campaignName: "B", woa: "", targeting: "", buyType: "", asset: "", inventory: "", totalReach: "", avgFrequency: "", budget: "", startDate: "", endDate: "" },
    ];

    const groups = groupIntoCampaigns(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].lineItems).toHaveLength(2);
  });

  it("generates campaign name from Markets + Channel when missing", () => {
    const rows = [
      { markets: "Delhi", channel: "Meta", campaignName: "", woa: "", targeting: "", buyType: "", asset: "", inventory: "", totalReach: "", avgFrequency: "", budget: "", startDate: "", endDate: "" },
    ];

    const groups = groupIntoCampaigns(rows);
    expect(groups[0].campaignName).toBe("Delhi - Meta");
  });

  it("initializes groups with correct defaults", () => {
    const rows = [
      { markets: "Delhi", channel: "Meta", campaignName: "Test", woa: "", targeting: "", buyType: "", asset: "", inventory: "", totalReach: "", avgFrequency: "", budget: "", startDate: "", endDate: "" },
    ];

    const groups = groupIntoCampaigns(rows);
    expect(groups[0].geoIntents).toEqual([]);
    expect(groups[0].resolvedGeoTargets).toEqual([]);
    expect(groups[0].unresolvedIntents).toEqual([]);
    expect(groups[0].status).toBe("pending");
  });
});
