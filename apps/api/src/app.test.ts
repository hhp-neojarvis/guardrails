import { describe, it, expect } from "vitest";
import { app } from "./app";

describe("API", () => {
  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok" });
    });

    it("returns JSON content type", async () => {
      const res = await app.request("/health");
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
    });
  });

  describe("CORS", () => {
    it("includes CORS headers for allowed origin", async () => {
      const res = await app.request("/health", {
        headers: { Origin: "http://localhost:5173" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:5173",
      );
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });

    it("handles preflight OPTIONS request", async () => {
      const res = await app.request("/health", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:5173",
      );
    });
  });

  describe("Auth routes (Better Auth)", () => {
    // Better Auth routes require a real DB connection to respond with non-404.
    // Without a DB, auth.handler returns 404 even though the route is mounted.
    // These tests are skipped until integration tests with a real DB are set up.
    it.skip("POST /api/auth/sign-up/email is mounted (needs real DB)", async () => {
      const res = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).not.toBe(404);
    });

    it.skip("POST /api/auth/sign-in/email is mounted (needs real DB)", async () => {
      const res = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).not.toBe(404);
    });

    it.skip("GET /api/auth/get-session is mounted (needs real DB)", async () => {
      const res = await app.request("/api/auth/get-session");
      expect(res.status).not.toBe(404);
    });
  });

  describe("POST /api/auth/accept-invite", () => {
    it("route is mounted (not 404)", async () => {
      const res = await app.request("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).not.toBe(404);
    });

    it("returns 400 with missing body fields", async () => {
      const res = await app.request("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: "Token and password are required" });
    });

    it("returns 400 when token is empty", async () => {
      const res = await app.request("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "", password: "test123" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: "Token and password are required" });
    });
  });

  describe("POST /api/users/invite", () => {
    it("returns 401 without auth session", async () => {
      const res = await app.request("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", role: "executor" }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });
  });

  describe("GET /api/users", () => {
    it("returns 401 without auth session", async () => {
      const res = await app.request("/api/users");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });
  });

  describe("404", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await app.request("/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
