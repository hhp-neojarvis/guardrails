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
        headers: { Origin: "http://guardrails.localhost:1355" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "http://guardrails.localhost:1355",
      );
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });

    it("handles preflight OPTIONS request", async () => {
      const res = await app.request("/health", {
        method: "OPTIONS",
        headers: {
          Origin: "http://guardrails.localhost:1355",
          "Access-Control-Request-Method": "GET",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "http://guardrails.localhost:1355",
      );
    });
  });

  describe("404", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await app.request("/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
