import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { db, companyUsers, eq, and } from "@guardrails/db";
import { auth } from "../lib/auth.js";

export type AuthContext = {
  userId: string;
  companyId: string;
  role: string;
  email: string;
};

export type AuthEnv = {
  Variables: {
    auth: AuthContext;
  };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rows = await db
    .select()
    .from(companyUsers)
    .where(
      and(
        eq(companyUsers.userId, session.user.id),
        eq(companyUsers.status, "active"),
      ),
    );

  if (rows.length === 0) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const companyUser = rows[0];

  c.set("auth", {
    userId: session.user.id,
    companyId: companyUser.companyId,
    role: companyUser.role,
    email: companyUser.email,
  });

  await next();
});

export function requireRole(...roles: string[]) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const authCtx = c.get("auth");
    if (!authCtx || !roles.includes(authCtx.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });
}
