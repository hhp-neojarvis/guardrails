import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @guardrails/db
// ---------------------------------------------------------------------------
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();

function makeWhereResult(data: any[] = []) {
  const result = Promise.resolve(data) as any;
  result.orderBy = mockOrderBy;
  return result;
}

function resetDbChain() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockImplementation(() => makeWhereResult([]));
  mockOrderBy.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([{ id: "upload-123" }]);
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
}

vi.mock("@guardrails/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
  metaAdAccounts: {
    id: "id",
    companyId: "company_id",
    encryptedAccessToken: "encrypted_access_token",
    tokenIv: "token_iv",
    tokenStatus: "token_status",
  },
  excelUploads: {
    id: "id",
    companyId: "company_id",
    createdAt: "created_at",
  },
  campaignGroups: {
    id: "id",
    uploadId: "upload_id",
  },
  guardrails: {
    companyId: "company_id",
    active: "active",
  },
  guardrailOverrides: {
    uploadId: "upload_id",
    campaignGroupId: "campaign_group_id",
    ruleId: "rule_id",
  },
  eq: vi.fn((...args: any[]) => ({ op: "eq", args })),
  and: vi.fn((...args: any[]) => ({ op: "and", args })),
}));

// Mock crypto
vi.mock("../lib/crypto.js", () => ({
  encrypt: vi.fn(() => ({ ciphertext: "enc", iv: "iv" })),
  decrypt: vi.fn(() => "test-access-token"),
}));

// Mock auth middleware
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    const testAuth = c.req.header("x-test-auth");
    if (testAuth) {
      c.set("auth", JSON.parse(testAuth));
      return next();
    }
    return c.json({ error: "Unauthorized" }, 401);
  }),
  requireRole: () =>
    vi.fn(async (_c: any, next: any) => next()),
}));

// Mock services
vi.mock("../services/excel-parser.js", () => ({
  parseExcel: vi.fn(() => [
    { markets: "Delhi", channel: "Meta", campaignName: "Test", woa: "", targeting: "", buyType: "", asset: "", inventory: "", totalReach: "", avgFrequency: "", budget: "", startDate: "", endDate: "" },
  ]),
  groupIntoCampaigns: vi.fn(() => [
    {
      markets: "Delhi",
      channel: "Meta",
      campaignName: "Test",
      lineItems: [],
      geoIntents: [],
      resolvedGeoTargets: [],
      unresolvedIntents: [],
      status: "pending",
    },
  ]),
}));

vi.mock("../services/geo-interpreter.js", () => ({
  interpretGeoFromMarkets: vi.fn(() =>
    Promise.resolve([{ name: "Delhi", type: "city", countryCode: "IN" }]),
  ),
}));

vi.mock("../services/geo-resolver.js", () => ({
  resolveGeoTargets: vi.fn(() =>
    Promise.resolve({
      resolved: [{ key: "123", name: "Delhi", type: "city", countryCode: "IN", region: "Delhi", regionId: 1, supportsRegion: false, supportsCity: true }],
      unresolved: [],
    }),
  ),
}));

vi.mock("../services/guardrail-validator.js", () => ({
  validateGuardrails: vi.fn(() => ({
    totalRules: 0,
    totalCampaigns: 0,
    results: [],
    hasViolations: false,
  })),
}));

vi.mock("../services/guardrail-llm-validator.js", () => ({
  validateGuardrailsLLM: vi.fn(() =>
    Promise.resolve({
      totalRules: 0,
      totalCampaigns: 0,
      results: [],
      hasViolations: false,
    }),
  ),
}));

vi.mock("../services/column-interpreter.js", () => ({
  interpretLineItem: vi.fn(() => ({
    warnings: [],
  })),
  deriveCampaignBuyType: vi.fn(() => undefined),
}));

vi.mock("../services/excel-validator.js", () => ({
  validateRows: vi.fn(async () => ({
    valid: true,
    issues: [],
    totalRows: 1,
  })),
}));

const TEST_AUTH = JSON.stringify({
  userId: "user-1",
  companyId: "company-1",
  role: "executor",
  email: "test@example.com",
});

beforeEach(() => {
  resetDbChain();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Import app after mocks
const { app } = await import("../app");

describe("POST /api/upload", () => {
  it("returns 401 without auth", async () => {
    const formData = new FormData();
    formData.append("file", new File(["test"], "test.xlsx"));
    formData.append("metaAdAccountId", "acc-1");

    const res = await app.request("/api/upload", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(401);
  });

  it("returns 400 without file", async () => {
    const formData = new FormData();
    formData.append("metaAdAccountId", "acc-1");

    const res = await app.request("/api/upload", {
      method: "POST",
      body: formData,
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("File is required");
  });

  it("returns 400 without metaAdAccountId", async () => {
    const formData = new FormData();
    formData.append("file", new File(["test"], "test.xlsx"));

    const res = await app.request("/api/upload", {
      method: "POST",
      body: formData,
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("metaAdAccountId");
  });

  it("returns 400 for invalid file type", async () => {
    const formData = new FormData();
    formData.append("file", new File(["test"], "test.pdf"));
    formData.append("metaAdAccountId", "acc-1");

    const res = await app.request("/api/upload", {
      method: "POST",
      body: formData,
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain(".xlsx");
  });

  it("returns 404 for non-existent ad account", async () => {
    const formData = new FormData();
    formData.append("file", new File(["test"], "test.xlsx"));
    formData.append("metaAdAccountId", "acc-1");

    const res = await app.request("/api/upload", {
      method: "POST",
      body: formData,
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/uploads/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/uploads/upload-123");
    expect(res.status).toBe(401);
  });

  it("returns 404 when upload not found", async () => {
    mockWhere.mockImplementationOnce(() => makeWhereResult([]));

    const res = await app.request("/api/uploads/upload-123", {
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(404);
  });

  it("returns upload with groups when found", async () => {
    // Upload found
    mockWhere.mockImplementationOnce(() => makeWhereResult([{
      id: "upload-123",
      fileName: "test.xlsx",
      status: "completed",
      totalRows: 5,
      errorMessage: null,
      guardrailResults: null,
      createdAt: new Date("2024-01-01"),
    }]));

    // Campaign groups
    mockWhere.mockImplementationOnce(() => makeWhereResult([{
      id: "group-1",
      markets: "Delhi",
      channel: "Meta",
      campaignName: "Test",
      lineItems: [],
      geoIntents: [],
      resolvedGeoTargets: [],
      unresolvedIntents: [],
      status: "resolved",
    }]));

    // Overrides (empty)
    mockWhere.mockImplementationOnce(() => makeWhereResult([]));

    const res = await app.request("/api/uploads/upload-123", {
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; groups: any[]; overrides: any[] };
    expect(body.id).toBe("upload-123");
    expect(body.groups).toHaveLength(1);
    expect(body.overrides).toEqual([]);
  });
});

describe("GET /api/uploads", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/uploads");
    expect(res.status).toBe(401);
  });

  it("returns uploads list for company", async () => {
    const data = [{
      id: "upload-1",
      fileName: "plan.xlsx",
      status: "completed",
      totalRows: 10,
      errorMessage: null,
      guardrailResults: null,
      createdAt: new Date("2024-01-01"),
    }];
    mockOrderBy.mockResolvedValueOnce(data);
    mockWhere.mockImplementationOnce(() => makeWhereResult(data));

    const res = await app.request("/api/uploads", {
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { uploads: any[] };
    expect(body.uploads).toHaveLength(1);
    expect(body.uploads[0].id).toBe("upload-1");
  });
});

describe("POST /api/uploads/:id/override", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/uploads/upload-1/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignGroupId: "g1", ruleId: "r1", reason: "ok" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing fields", async () => {
    const res = await app.request("/api/uploads/upload-1/override", {
      method: "POST",
      headers: { "x-test-auth": TEST_AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ campaignGroupId: "g1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent upload", async () => {
    mockWhere.mockImplementationOnce(() => makeWhereResult([]));

    const res = await app.request("/api/uploads/upload-1/override", {
      method: "POST",
      headers: { "x-test-auth": TEST_AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ campaignGroupId: "g1", ruleId: "r1", reason: "ok" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when upload is not awaiting_review", async () => {
    mockWhere.mockImplementationOnce(() => makeWhereResult([{
      id: "upload-1",
      status: "completed",
      guardrailResults: null,
    }]));

    const res = await app.request("/api/uploads/upload-1/override", {
      method: "POST",
      headers: { "x-test-auth": TEST_AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ campaignGroupId: "g1", ruleId: "r1", reason: "ok" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("not awaiting review");
  });

  it("creates override record for valid violation", async () => {
    // Upload found with awaiting_review
    mockWhere.mockImplementationOnce(() => makeWhereResult([{
      id: "upload-1",
      status: "awaiting_review",
      guardrailResults: {
        totalRules: 1,
        totalCampaigns: 1,
        results: [{
          campaignGroupId: "g1",
          campaignName: "Test",
          violations: [{
            ruleId: "r1",
            ruleDescription: "Test rule",
            field: "budget",
            expected: null,
            actual: null,
            message: "budget is not set",
          }],
          status: "fail",
        }],
        hasViolations: true,
      },
    }]));

    // No existing override
    mockWhere.mockImplementationOnce(() => makeWhereResult([]));

    // Insert override
    mockReturning.mockResolvedValueOnce([{
      id: "override-1",
      campaignGroupId: "g1",
      ruleId: "r1",
      reason: "Intentional",
      createdAt: new Date("2024-01-01"),
    }]);

    const res = await app.request("/api/uploads/upload-1/override", {
      method: "POST",
      headers: { "x-test-auth": TEST_AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ campaignGroupId: "g1", ruleId: "r1", reason: "Intentional" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/uploads/:id/approve", () => {
  it("returns 404 for non-existent upload", async () => {
    mockWhere.mockImplementationOnce(() => makeWhereResult([]));

    const res = await app.request("/api/uploads/upload-1/approve", {
      method: "POST",
      headers: { "x-test-auth": TEST_AUTH },
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when not awaiting_review", async () => {
    mockWhere.mockImplementationOnce(() => makeWhereResult([{
      id: "upload-1",
      status: "completed",
    }]));

    const res = await app.request("/api/uploads/upload-1/approve", {
      method: "POST",
      headers: { "x-test-auth": TEST_AUTH },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when not all violations overridden", async () => {
    mockWhere.mockImplementationOnce(() => makeWhereResult([{
      id: "upload-1",
      status: "awaiting_review",
      guardrailResults: {
        totalRules: 1,
        totalCampaigns: 1,
        results: [{
          campaignGroupId: "g1",
          campaignName: "Test",
          violations: [{ ruleId: "r1" }, { ruleId: "r2" }],
          status: "fail",
        }],
        hasViolations: true,
      },
    }]));

    // Only 1 override exists
    mockWhere.mockImplementationOnce(() => makeWhereResult([{ id: "override-1" }]));

    const res = await app.request("/api/uploads/upload-1/approve", {
      method: "POST",
      headers: { "x-test-auth": TEST_AUTH },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("1/2");
  });

  it("approves when all violations overridden", async () => {
    mockWhere.mockImplementationOnce(() => makeWhereResult([{
      id: "upload-1",
      status: "awaiting_review",
      guardrailResults: {
        totalRules: 1,
        totalCampaigns: 1,
        results: [{
          campaignGroupId: "g1",
          campaignName: "Test",
          violations: [{ ruleId: "r1" }],
          status: "fail",
        }],
        hasViolations: true,
      },
    }]));

    // 1 override = 1 violation
    mockWhere.mockImplementationOnce(() => makeWhereResult([{ id: "override-1" }]));

    const res = await app.request("/api/uploads/upload-1/approve", {
      method: "POST",
      headers: { "x-test-auth": TEST_AUTH },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
