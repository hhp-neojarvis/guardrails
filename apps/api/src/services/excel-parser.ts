import * as XLSX from "xlsx";
import type { ExcelRow, CampaignGroup } from "@guardrails/shared";

// Fixed column header mapping (case-insensitive, supports common variants)
const COLUMN_MAP: Record<string, keyof ExcelRow> = {
  markets: "markets",
  market: "markets",
  channel: "channel",
  woa: "woa",
  "weeks of activity": "woa",
  targeting: "targeting",
  "buy type": "buyType",
  buytype: "buyType",
  asset: "asset",
  inventory: "inventory",
  "total reach": "totalReach",
  totalreach: "totalReach",
  "total reach (%)": "totalReach",
  "avg frequency": "avgFrequency",
  avgfrequency: "avgFrequency",
  "average frequency": "avgFrequency",
  budget: "budget",
  "audience sizing": "budget",
  "audience size": "budget",
  "total impressions": "totalReach",
  "start date": "startDate",
  startdate: "startDate",
  "end date": "endDate",
  enddate: "endDate",
  "campaign name": "campaignName",
  campaignname: "campaignName",
};

/**
 * Fill merged cells in a sheet so every cell in a merge range
 * has the same value as the top-left cell. Without this, xlsx
 * only populates the top-left cell and leaves the rest empty.
 */
function fillMergedCells(sheet: XLSX.WorkSheet): void {
  const merges = sheet["!merges"];
  if (!merges || merges.length === 0) return;

  for (const merge of merges) {
    const topLeftRef = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
    const topLeftCell = sheet[topLeftRef];
    if (!topLeftCell) continue;

    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r === merge.s.r && c === merge.s.c) continue;
        const cellRef = XLSX.utils.encode_cell({ r, c });
        sheet[cellRef] = { t: topLeftCell.t, v: topLeftCell.v, w: topLeftCell.w };
      }
    }
  }
}

/**
 * Detect the header row index by scanning for a row whose cells
 * match known column names. Returns 0 if no match found (default).
 */
function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const knownHeaders = new Set(Object.keys(COLUMN_MAP));

  for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
    let matchCount = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v != null) {
        const val = String(cell.v).trim().toLowerCase();
        if (knownHeaders.has(val)) matchCount++;
      }
    }
    // If we match at least 2 known headers, this is our header row
    if (matchCount >= 2) return r;
  }

  return range.s.r;
}

/**
 * Parse an Excel buffer into structured rows using fixed header mapping.
 * Handles merged cells and auto-detects the header row.
 * Does NOT validate row data — that's handled by excel-validator.
 */
export function parseExcel(buffer: ArrayBuffer): ExcelRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });

  if (workbook.SheetNames.length === 0) {
    throw new Error("Excel file contains no sheets");
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // Fill merged cells before conversion so every row has values
  fillMergedCells(sheet);

  // Detect the actual header row (may not be row 0 if there's a title row)
  const headerRowIndex = findHeaderRow(sheet);

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    range: headerRowIndex,
  });

  if (rawRows.length === 0) {
    throw new Error("Excel sheet is empty — no data rows found");
  }

  // Build header → field mapping from first row's keys
  const firstRowKeys = Object.keys(rawRows[0]);
  const headerMap = new Map<string, keyof ExcelRow>();

  for (const key of firstRowKeys) {
    const normalized = key.trim().toLowerCase();
    const field = COLUMN_MAP[normalized];
    if (field) {
      headerMap.set(key, field);
    }
  }

  const rows: ExcelRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const row: ExcelRow = {
      markets: "",
      channel: "",
      woa: "",
      targeting: "",
      buyType: "",
      asset: "",
      inventory: "",
      totalReach: "",
      avgFrequency: "",
      budget: "",
      startDate: "",
      endDate: "",
      campaignName: "",
    };

    for (const [originalKey, field] of headerMap) {
      const val = raw[originalKey];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (row as any)[field] = val != null ? String(val).trim() : "";
    }

    rows.push(row);
  }

  // Forward-fill Markets column for any remaining gaps
  // (belt-and-suspenders — fillMergedCells should handle most cases,
  // but some files may have visual-only merges without !merges metadata)
  let lastMarkets = "";
  for (const row of rows) {
    if (row.markets) {
      lastMarkets = row.markets;
    } else if (lastMarkets) {
      row.markets = lastMarkets;
    }
  }

  return rows;
}

/**
 * Group rows by Markets + Channel (case-insensitive).
 * Campaign name comes from the first row in each group.
 */
export function groupIntoCampaigns(rows: ExcelRow[]): CampaignGroup[] {
  const groupMap = new Map<string, CampaignGroup>();

  for (const row of rows) {
    const key = `${row.markets.toLowerCase()}||${row.channel.toLowerCase()}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        markets: row.markets,
        channel: row.channel,
        campaignName: row.campaignName || `${row.markets} - ${row.channel}`,
        lineItems: [],
        geoIntents: [],
        resolvedGeoTargets: [],
        unresolvedIntents: [],
        status: "pending",
      });
    }

    groupMap.get(key)!.lineItems.push(row);
  }

  return Array.from(groupMap.values());
}
