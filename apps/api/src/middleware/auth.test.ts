import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { app } from "../app";
import { requireRole, type AuthEnv } from "./auth";

describe("Auth middleware", () => {
  describe("GET /api/me", () => {
    it("returns 401 when no session cookie is provided", async () => {
      const res = await app.request("/api/me");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns 401 with an invalid cookie", async () => {
      const res = await app.request("/api/me", {
        headers: {
          Cookie: "better-auth.session_token=invalid-token-value",
        },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns JSON content type on 401", async () => {
      const res = await app.request("/api/me");
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
    });
  });
});

describe("requireRole", () => {
  function buildApp(allowedRoles: string[], userRole: string) {
    const testApp = new Hono<AuthEnv>();

    // Manually set auth context (simulating what authMiddleware would do)
    testApp.use("*", async (c, next) => {
      c.set("auth", {
        userId: "user-1",
        companyId: "company-1",
        role: userRole,
        email: "test@example.com",
      });
      await next();
    });

    testApp.get("/protected", requireRole(...allowedRoles), (c) => {
      return c.json({ ok: true });
    });

    return testApp;
  }

  it("allows access when role matches", async () => {
    const testApp = buildApp(["admin", "editor"], "admin");
    const res = await testApp.request("/protected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 403 when role does not match", async () => {
    const testApp = buildApp(["admin"], "viewer");
    const res = await testApp.request("/protected");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Forbidden" });
  });

  it("returns 403 when auth context is missing", async () => {
    const testApp = new Hono<AuthEnv>();
    testApp.get("/protected", requireRole("admin"), (c) => {
      return c.json({ ok: true });
    });

    const res = await testApp.request("/protected");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Forbidden" });
  });
});
