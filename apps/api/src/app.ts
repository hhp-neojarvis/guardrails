import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./lib/auth.js";
import { authMiddleware, type AuthEnv } from "./middleware/auth.js";
import { acceptInvite } from "./routes/accept-invite.js";
import { users } from "./routes/users.js";

export const app = new Hono<AuthEnv>();

app.use(
  "*",
  cors({
    origin: ["http://guardrails.localhost:1355"],
    credentials: true,
  }),
);

app.route("/api/auth", acceptInvite);

app.on(["POST", "GET"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/users", users);

app.get("/api/me", authMiddleware, (c) => {
  const authCtx = c.get("auth");
  return c.json(authCtx);
});
