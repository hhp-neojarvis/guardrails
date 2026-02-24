import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./lib/auth.js";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://guardrails.localhost:1355"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});
