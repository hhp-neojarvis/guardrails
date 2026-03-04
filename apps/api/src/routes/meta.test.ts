import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { app } from "../app";
import type { AuthEnv } from "../middleware/auth";

// ---------------------------------------------------------------------------
// Mock @guardrails/db — must be before any import that pulls it in
// ---------------------------------------------------------------------------
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLeftJoin = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();

function resetDbChain() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere, leftJoin: mockLeftJoin });
  mockLeftJoin.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockResolvedValue(undefined);
  mockDelete.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
}

vi.mock("@guardrails/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
    delete: (...args: any[]) => mockDelete(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
  metaAdAccounts: {
    id: "id",
    companyId: "company_id",
    connectedByUserId: "connected_by_user_id",
    metaUserId: "meta_user_id",
    metaAccountId: "meta_account_id",
    metaAccountName: "meta_account_name",
    encryptedAccessToken: "encrypted_access_token",
    tokenIv: "token_iv",
    tokenExpiresAt: "token_expires_at",
    tokenStatus: "token_status",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  companyUsers: {
    userId: "user_id",
    companyId: "company_id",
    email: "email",
    status: "status",
  },
  eq: vi.fn((...args: any[]) => ({ op: "eq", args })),
  and: vi.fn((...args: any[]) => ({ op: "and", args })),
  or: vi.fn(),
  lt: vi.fn(),
  sql: vi.fn(),
}));

// Mock crypto module
vi.mock("../lib/crypto.js", () => ({
  encrypt: vi.fn(() => ({ ciphertext: "encrypted-token", iv: "test-iv" })),
  decrypt: vi.fn(() => "decrypted-token"),
}));

// ---------------------------------------------------------------------------
// Set required env vars
// ---------------------------------------------------------------------------
beforeEach(() => {
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_OAUTH_REDIRECT_URI = "http://localhost:3001/api/meta/callback";
  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  resetDbChain();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: build a test app with meta routes + fake auth
// ---------------------------------------------------------------------------
function buildAuthenticatedApp() {
  // We need to import the meta routes fresh but they already have the real
  // authMiddleware baked in. Instead, we test against the real `app` export.
  // For authenticated tests, we cannot easily bypass the real auth middleware
  // on the main app. So we create a mini-app that mimics what `app` does but
  // with a fake auth middleware injected first.
  //
  // However, the meta routes use `authMiddleware` internally per-route, so
  // we must re-create a Hono with fake auth at the middleware level.
  //
  // Approach: import the `meta` sub-router and mount it with a pre-set auth
  // context. BUT `meta` already has `authMiddleware` on its routes. The
  // cleanest way is to mock the auth module so authMiddleware is a pass-through.
  return null; // We'll use a different approach — see below.
}

// ---------------------------------------------------------------------------
// We mock authMiddleware to be a passthrough that sets auth context
// ---------------------------------------------------------------------------
vi.mock("../middleware/auth.js", () => {
  const { createMiddleware } = require("hono/factory");
  return {
    authMiddleware: createMiddleware(async (c: any, next: any) => {
      // Check for a special header to simulate auth
      const authHeader = c.req.header("x-test-auth");
      if (authHeader) {
        const auth = JSON.parse(authHeader);
        c.set("auth", auth);
        await next();
      } else {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }),
    requireRole: (...roles: string[]) =>
      createMiddleware(async (c: any, next: any) => {
        await next();
      }),
  };
});

// Since we mocked the auth module, we need to re-import app after the mock.
// But vitest hoists vi.mock calls, so the import at the top already uses the mock.

const TEST_AUTH = JSON.stringify({
  userId: "user-1",
  companyId: "company-1",
  role: "admin",
  email: "test@example.com",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Meta routes", () => {
  // =========================================================================
  // GET /api/meta/auth-url
  // =========================================================================
  describe("GET /api/meta/auth-url", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.request("/api/meta/auth-url");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns a valid URL containing facebook.com/dialog/oauth when authenticated", async () => {
      const res = await app.request("/api/meta/auth-url", {
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.url).toContain("https://www.facebook.com/v21.0/dialog/oauth");
    });

    it("URL contains correct client_id, redirect_uri, scope params", async () => {
      const res = await app.request("/api/meta/auth-url", {
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const url = new URL(body.url);
      expect(url.searchParams.get("client_id")).toBe("test-app-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3001/api/meta/callback",
      );
      expect(url.searchParams.get("scope")).toBe(
        "ads_management,ads_read,business_management",
      );
      expect(url.searchParams.get("response_type")).toBe("code");
    });
  });

  // =========================================================================
  // GET /api/meta/callback
  // =========================================================================
  describe("GET /api/meta/callback", () => {
    it("returns error redirect when code and state are missing", async () => {
      const res = await app.request("/api/meta/callback", { redirect: "manual" });
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("status=error");
      expect(location).toContain("reason=missing_params");
    });

    it("returns error redirect when state is invalid/expired", async () => {
      const res = await app.request(
        "/api/meta/callback?code=test-code&state=bogus-state",
        { redirect: "manual" },
      );
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("status=error");
      expect(location).toContain("reason=invalid_state");
    });
  });

  // =========================================================================
  // GET /api/meta/accounts
  // =========================================================================
  describe("GET /api/meta/accounts", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.request("/api/meta/accounts");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns empty array when no accounts exist", async () => {
      // mockWhere already returns [] by default
      const res = await app.request("/api/meta/accounts", {
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ accounts: [] });
    });

    it("returns accounts when rows exist in db", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: "acc-1",
          metaAccountId: "12345",
          metaAccountName: "Test Account",
          connectedByEmail: "test@example.com",
          connectedAt: new Date("2025-01-01T00:00:00Z"),
          tokenStatus: "valid",
        },
      ]);

      const res = await app.request("/api/meta/accounts", {
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accounts).toHaveLength(1);
      expect(body.accounts[0].metaAccountId).toBe("12345");
      expect(body.accounts[0].metaAccountName).toBe("Test Account");
      expect(body.accounts[0].tokenStatus).toBe("valid");
    });
  });

  // =========================================================================
  // DELETE /api/meta/accounts/:id
  // =========================================================================
  describe("DELETE /api/meta/accounts/:id", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.request("/api/meta/accounts/some-id", {
        method: "DELETE",
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns 404 for non-existent account", async () => {
      // mockWhere returns [] by default — no matching row
      const res = await app.request(
        "/api/meta/accounts/nonexistent-id",
        {
          method: "DELETE",
          headers: { "x-test-auth": TEST_AUTH },
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "Account not found" });
    });

    it("returns success when account exists", async () => {
      mockWhere.mockResolvedValueOnce([{ id: "acc-1" }]);
      // The second .where() call is for the actual DELETE
      const deleteWhere = vi.fn().mockResolvedValue(undefined);
      mockDelete.mockReturnValue({ where: deleteWhere });

      const res = await app.request("/api/meta/accounts/acc-1", {
        method: "DELETE",
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });
    });
  });

  // =========================================================================
  // POST /api/meta/accounts/:id/refresh
  // =========================================================================
  describe("POST /api/meta/accounts/:id/refresh", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.request("/api/meta/accounts/some-id/refresh", {
        method: "POST",
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns 404 for non-existent account", async () => {
      // mockWhere returns [] by default
      const res = await app.request(
        "/api/meta/accounts/nonexistent-id/refresh",
        {
          method: "POST",
          headers: { "x-test-auth": TEST_AUTH },
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "Account not found" });
    });

    it("returns success when token refresh succeeds", async () => {
      // First .where() returns the account row
      mockWhere.mockResolvedValueOnce([
        {
          id: "acc-1",
          encryptedAccessToken: "encrypted",
          tokenIv: "iv-value",
          companyId: "company-1",
        },
      ]);

      // Mock fetch for the Meta API refresh call
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 5184000,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await app.request("/api/meta/accounts/acc-1/refresh", {
        method: "POST",
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, tokenStatus: "valid" });

      vi.unstubAllGlobals();
    });

    it("returns 502 when Meta API returns an error", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: "acc-1",
          encryptedAccessToken: "encrypted",
          tokenIv: "iv-value",
          companyId: "company-1",
        },
      ]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        text: async () => "Bad Request",
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await app.request("/api/meta/accounts/acc-1/refresh", {
        method: "POST",
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("Token refresh failed");
      expect(body.tokenStatus).toBe("error");

      vi.unstubAllGlobals();
    });
  });

  // =========================================================================
  // GET /api/meta/pending-accounts
  // =========================================================================
  describe("GET /api/meta/pending-accounts", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.request("/api/meta/pending-accounts?sessionId=abc");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns 400 when sessionId is missing", async () => {
      const res = await app.request("/api/meta/pending-accounts", {
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: "sessionId query param is required" });
    });

    it("returns 404 when session is not found", async () => {
      const res = await app.request(
        "/api/meta/pending-accounts?sessionId=nonexistent",
        { headers: { "x-test-auth": TEST_AUTH } },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "Session not found or expired" });
    });
  });

  // =========================================================================
  // POST /api/meta/accounts (connect selected accounts)
  // =========================================================================
  describe("POST /api/meta/accounts", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.request("/api/meta/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns 400 when sessionId or selectedAccountIds missing", async () => {
      const res = await app.request("/api/meta/accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({
        error: "sessionId and selectedAccountIds are required",
      });
    });
  });
});
