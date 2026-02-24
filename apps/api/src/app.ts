import { Hono } from "hono";
import { cors } from "hono/cors";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://guardrails.localhost:1355"],
    credentials: true,
  }),
);

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});
