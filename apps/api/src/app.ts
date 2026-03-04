import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./lib/auth.js";
import { authMiddleware, type AuthEnv } from "./middleware/auth.js";
import { acceptInvite } from "./routes/accept-invite.js";
import { resetPassword } from "./routes/reset-password.js";
import { users } from "./routes/users.js";
import { meta } from "./routes/meta.js";
import { uploads } from "./routes/uploads.js";
import { guardrailRoutes } from "./routes/guardrails.js";

export const app = new Hono<AuthEnv>();

app.use(
  "*",
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
    credentials: true,
  }),
);

app.route("/api/auth", acceptInvite);
app.route("/api/auth", resetPassword);

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/users", users);
app.route("/api/meta", meta);
app.route("/api", uploads);
app.route("/api/guardrails", guardrailRoutes);

app.get("/api/me", authMiddleware, (c) => {
  const authCtx = c.get("auth");
  return c.json(authCtx);
});
