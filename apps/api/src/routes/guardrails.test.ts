import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "../app";

// ---------------------------------------------------------------------------
// Mock @guardrails/db
// ---------------------------------------------------------------------------
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();

function resetDbChain() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([]);
  mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
}

vi.mock("@guardrails/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
    delete: (...args: any[]) => mockDelete(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
  guardrails: {
    id: "id",
    companyId: "company_id",
    description: "description",
    check: "check",
    active: "active",
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
}));

// Mock auth middleware
vi.mock("../middleware/auth.js", () => {
  const { createMiddleware } = require("hono/factory");
  return {
    authMiddleware: createMiddleware(async (c: any, next: any) => {
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

// Mock LLM service
const mockGenerateGuardrailRules = vi.fn();
vi.mock("../services/guardrail-generator.js", () => ({
  generateGuardrailRules: (...args: any[]) => mockGenerateGuardrailRules(...args),
}));

// Mock crypto (imported by other routes)
vi.mock("../lib/crypto.js", () => ({
  encrypt: vi.fn(() => ({ ciphertext: "encrypted", iv: "iv" })),
  decrypt: vi.fn(() => "decrypted"),
}));

const TEST_AUTH = JSON.stringify({
  userId: "user-1",
  companyId: "company-1",
  role: "admin",
  email: "test@example.com",
});

const SAMPLE_CHECK = {
  scope: "campaign" as const,
  field: "budget" as const,
  operator: "gte" as const,
  value: 10000,
};

const SAMPLE_ROW = {
  id: "rule-1",
  companyId: "company-1",
  description: "Budget must be at least 10000",
  check: SAMPLE_CHECK,
  active: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

beforeEach(() => {
  resetDbChain();
  mockGenerateGuardrailRules.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Guardrail routes", () => {
  // ── GET /api/guardrails ──
  describe("GET /api/guardrails", () => {
    it("returns 401 without auth", async () => {
      const res = await app.request("/api/guardrails");
      expect(res.status).toBe(401);
    });

    it("returns empty array when no guardrails exist", async () => {
      mockWhere.mockResolvedValue([]);

      const res = await app.request("/api/guardrails", {
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { guardrails: unknown[] };
      expect(body.guardrails).toEqual([]);
    });

    it("returns guardrails after create", async () => {
      mockWhere.mockResolvedValue([SAMPLE_ROW]);

      const res = await app.request("/api/guardrails", {
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { guardrails: any[] };
      expect(body.guardrails).toHaveLength(1);
      expect(body.guardrails[0].description).toBe("Budget must be at least 10000");
      expect(body.guardrails[0].check).toEqual(SAMPLE_CHECK);
    });
  });

  // ── POST /api/guardrails ──
  describe("POST /api/guardrails", () => {
    it("creates a rule and returns 201", async () => {
      mockReturning.mockResolvedValue([SAMPLE_ROW]);

      const res = await app.request("/api/guardrails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({
          description: "Budget must be at least 10000",
          check: SAMPLE_CHECK,
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.description).toBe("Budget must be at least 10000");
    });

    it("returns 400 for missing fields", async () => {
      const res = await app.request("/api/guardrails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/guardrails/batch ──
  describe("POST /api/guardrails/batch", () => {
    it("creates multiple rules and returns 201", async () => {
      mockReturning.mockResolvedValue([SAMPLE_ROW, { ...SAMPLE_ROW, id: "rule-2" }]);

      const res = await app.request("/api/guardrails/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({
          rules: [
            { description: "Rule 1", check: SAMPLE_CHECK },
            { description: "Rule 2", check: SAMPLE_CHECK },
          ],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { guardrails: any[] };
      expect(body.guardrails).toHaveLength(2);
    });

    it("returns 400 for empty array", async () => {
      const res = await app.request("/api/guardrails/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({ rules: [] }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── PATCH /api/guardrails/:id ──
  describe("PATCH /api/guardrails/:id", () => {
    it("updates description", async () => {
      // First call: select to verify ownership
      mockWhere.mockResolvedValueOnce([SAMPLE_ROW]);
      // Second call: update returning
      const updated = { ...SAMPLE_ROW, description: "Updated" };
      mockReturning.mockResolvedValue([updated]);

      const res = await app.request("/api/guardrails/rule-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({ description: "Updated" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.description).toBe("Updated");
    });

    it("updates active status", async () => {
      mockWhere.mockResolvedValueOnce([SAMPLE_ROW]);
      const updated = { ...SAMPLE_ROW, active: false };
      mockReturning.mockResolvedValue([updated]);

      const res = await app.request("/api/guardrails/rule-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({ active: false }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.active).toBe(false);
    });

    it("returns 404 for wrong company", async () => {
      mockWhere.mockResolvedValueOnce([]); // not found

      const res = await app.request("/api/guardrails/rule-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({ description: "Updated" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/guardrails/:id ──
  describe("DELETE /api/guardrails/:id", () => {
    it("deletes a rule", async () => {
      mockWhere.mockResolvedValueOnce([SAMPLE_ROW]);

      const res = await app.request("/api/guardrails/rule-1", {
        method: "DELETE",
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
    });

    it("returns 404 for wrong company", async () => {
      mockWhere.mockResolvedValueOnce([]);

      const res = await app.request("/api/guardrails/rule-1", {
        method: "DELETE",
        headers: { "x-test-auth": TEST_AUTH },
      });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/guardrails/generate ──
  describe("POST /api/guardrails/generate", () => {
    it("returns 400 for empty prompt", async () => {
      const res = await app.request("/api/guardrails/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({ prompt: "" }),
      });
      expect(res.status).toBe(400);
    });

    it("streams SSE events with generating/rule/complete", async () => {
      const generatedRules = [
        {
          description: "Budget >= 10000",
          check: SAMPLE_CHECK,
        },
      ];
      mockGenerateGuardrailRules.mockResolvedValue(generatedRules);

      const res = await app.request("/api/guardrails/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({ prompt: "Budget should be at least 10000" }),
      });
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('"type":"generating"');
      expect(text).toContain('"type":"rule"');
      expect(text).toContain('"type":"complete"');
      expect(text).toContain("Budget >= 10000");
    });

    it("streams error event on LLM failure", async () => {
      mockGenerateGuardrailRules.mockRejectedValue(new Error("LLM failed"));

      const res = await app.request("/api/guardrails/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-auth": TEST_AUTH,
        },
        body: JSON.stringify({ prompt: "some prompt" }),
      });
      expect(res.status).toBe(200); // SSE always starts 200

      const text = await res.text();
      expect(text).toContain('"type":"error"');
      expect(text).toContain("LLM failed");
    });
  });
});
