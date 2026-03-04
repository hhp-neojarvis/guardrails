import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateRows } from "./excel-validator";
import type { ExcelRow } from "@guardrails/shared";

function makeRow(overrides: Partial<ExcelRow> = {}): ExcelRow {
  return {
    markets: "Delhi",
    channel: "Meta",
    woa: "4",
    targeting: "18-24 M+F",
    buyType: "Auction",
    asset: "Video",
    inventory: "Feeds",
    totalReach: "100000",
    avgFrequency: "3",
    budget: "50000",
    startDate: "2030-06-01",
    endDate: "2030-06-30",
    campaignName: "Test Campaign",
    ...overrides,
  };
}

describe("excel-validator date validations", () => {
  beforeEach(() => {
    // Fix "today" to 2026-03-04 for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T00:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes when start date is today", async () => {
    const rows = [makeRow({ startDate: "2026-03-04", endDate: "2026-03-10" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(true);
  });

  it("passes when start date is in the future", async () => {
    const rows = [makeRow({ startDate: "2026-04-01", endDate: "2026-04-30" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(true);
  });

  it("fails when start date is in the past", async () => {
    const rows = [makeRow({ startDate: "2026-03-01", endDate: "2026-03-10" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.field === "startDate" && i.message.includes("past"));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });

  it("fails when end date equals start date", async () => {
    const rows = [makeRow({ startDate: "2026-04-01", endDate: "2026-04-01" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.field === "endDate" && i.message.includes("after start"));
    expect(issue).toBeDefined();
  });

  it("fails when end date is before start date", async () => {
    const rows = [makeRow({ startDate: "2026-04-15", endDate: "2026-04-10" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.field === "endDate");
    expect(issue).toBeDefined();
  });

  it("passes when end date is after start date", async () => {
    const rows = [makeRow({ startDate: "2026-04-01", endDate: "2026-04-02" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(true);
  });

  it("reports invalid date format as error", async () => {
    const rows = [makeRow({ startDate: "not-a-date" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.field === "startDate" && i.message.includes("not a valid date"))).toBeDefined();
  });
});

describe("excel-validator channel validations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T00:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes for Meta channel", async () => {
    const rows = [makeRow({ channel: "Meta - Pre-launch" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(true);
  });

  it("passes for meta (case-insensitive)", async () => {
    const rows = [makeRow({ channel: "meta" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(true);
  });

  it("warns for YouTube channel but still passes", async () => {
    const rows = [makeRow({ channel: "YouTube - During" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(true);
    const issue = result.issues.find((i) => i.field === "channel" && i.message.includes("not supported"));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
  });

  it("warns for WhatsApp channel but still passes", async () => {
    const rows = [makeRow({ channel: "WhatsApp" })];
    const result = await validateRows(rows);
    expect(result.valid).toBe(true);
    const issue = result.issues.find((i) => i.field === "channel" && i.message.includes("not supported"));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
  });
});
