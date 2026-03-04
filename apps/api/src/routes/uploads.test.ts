import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @guardrails/db
// ---------------------------------------------------------------------------
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();

function resetDbChain() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue([]);
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
  },
  campaignGroups: {
    uploadId: "upload_id",
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
    // mockWhere already returns [] (no account found)
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
    mockWhere.mockResolvedValueOnce([]); // no upload found

    const res = await app.request("/api/uploads/upload-123", {
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(404);
  });

  it("returns upload with groups when found", async () => {
    // Upload found
    mockWhere.mockResolvedValueOnce([
      {
        id: "upload-123",
        fileName: "test.xlsx",
        status: "completed",
        totalRows: 5,
        errorMessage: null,
        createdAt: new Date("2024-01-01"),
      },
    ]);

    // Campaign groups
    mockWhere.mockResolvedValueOnce([
      {
        id: "group-1",
        markets: "Delhi",
        channel: "Meta",
        campaignName: "Test",
        lineItems: [],
        geoIntents: [],
        resolvedGeoTargets: [],
        unresolvedIntents: [],
        status: "resolved",
      },
    ]);

    const res = await app.request("/api/uploads/upload-123", {
      headers: { "x-test-auth": TEST_AUTH },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; groups: any[] };
    expect(body.id).toBe("upload-123");
    expect(body.groups).toHaveLength(1);
  });
});
