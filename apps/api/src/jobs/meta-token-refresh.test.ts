import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @guardrails/db
// ---------------------------------------------------------------------------
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();

function resetDbChain() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue([]);
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
}

vi.mock("@guardrails/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
  metaAdAccounts: {
    id: "id",
    tokenStatus: "token_status",
    tokenExpiresAt: "token_expires_at",
    encryptedAccessToken: "encrypted_access_token",
    tokenIv: "token_iv",
  },
  eq: vi.fn((...args: any[]) => ({ op: "eq", args })),
  and: vi.fn((...args: any[]) => ({ op: "and", args })),
  lt: vi.fn((...args: any[]) => ({ op: "lt", args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: any[]) => ({
    sql: strings.join("?"),
    values,
  })),
}));

// Mock crypto module
vi.mock("../lib/crypto.js", () => ({
  encrypt: vi.fn(() => ({ ciphertext: "new-encrypted-token", iv: "new-iv" })),
  decrypt: vi.fn(() => "decrypted-token"),
}));

// ---------------------------------------------------------------------------
// Set required env vars
// ---------------------------------------------------------------------------
beforeEach(() => {
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  resetDbChain();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("meta-token-refresh", () => {
  describe("refreshExpiringTokens", () => {
    it("returns { refreshed: 0, failed: 0 } when no tokens are expiring", async () => {
      // mockWhere returns [] by default — no expiring tokens
      const { refreshExpiringTokens } = await import(
        "../jobs/meta-token-refresh.js"
      );
      const result = await refreshExpiringTokens();
      expect(result).toEqual({ refreshed: 0, failed: 0 });
    });

    it("refreshes an expiring token successfully", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: "acc-1",
          metaAccountId: "12345",
          encryptedAccessToken: "old-encrypted",
          tokenIv: "old-iv",
          tokenStatus: "valid",
          tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
        },
      ]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new-long-lived-token",
          expires_in: 5184000,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { refreshExpiringTokens } = await import(
        "../jobs/meta-token-refresh.js"
      );
      const result = await refreshExpiringTokens();
      expect(result).toEqual({ refreshed: 1, failed: 0 });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("marks token as error when Meta API returns an error", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: "acc-2",
          metaAccountId: "67890",
          encryptedAccessToken: "encrypted",
          tokenIv: "iv",
          tokenStatus: "valid",
          tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
      ]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });
      vi.stubGlobal("fetch", mockFetch);

      const { refreshExpiringTokens } = await import(
        "../jobs/meta-token-refresh.js"
      );
      const result = await refreshExpiringTokens();
      expect(result).toEqual({ refreshed: 0, failed: 1 });
      // The update should have been called to set tokenStatus to 'error'
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("handles fetch throwing a network error", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: "acc-3",
          metaAccountId: "99999",
          encryptedAccessToken: "encrypted",
          tokenIv: "iv",
          tokenStatus: "valid",
          tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
      ]);

      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", mockFetch);

      const { refreshExpiringTokens } = await import(
        "../jobs/meta-token-refresh.js"
      );
      const result = await refreshExpiringTokens();
      expect(result).toEqual({ refreshed: 0, failed: 1 });
    });
  });

  describe("startTokenRefreshJob / stopTokenRefreshJob", () => {
    it("startTokenRefreshJob and stopTokenRefreshJob can be called without error", async () => {
      const { startTokenRefreshJob, stopTokenRefreshJob } = await import(
        "../jobs/meta-token-refresh.js"
      );
      // startTokenRefreshJob triggers an immediate refresh + setInterval
      // We just verify it doesn't throw
      startTokenRefreshJob();
      // Clean up immediately
      stopTokenRefreshJob();
    });
  });
});
