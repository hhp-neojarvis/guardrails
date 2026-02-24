import { Hono } from "hono";
import {
  authMiddleware,
  requireRole,
  type AuthEnv,
} from "../middleware/auth.js";
import { db, companyUsers, eq, and } from "@guardrails/db";

const users = new Hono<AuthEnv>();

// POST /invite
users.post(
  "/invite",
  authMiddleware,
  requireRole("super_admin"),
  async (c) => {
    const { email, role } = await c.req.json();

    if (!["super_admin", "executor"].includes(role)) {
      return c.json({ error: "Invalid role" }, 400);
    }

    const auth = c.get("auth");
    const [existing] = await db
      .select()
      .from(companyUsers)
      .where(
        and(
          eq(companyUsers.email, email),
          eq(companyUsers.companyId, auth.companyId),
        ),
      );

    if (existing) {
      return c.json({ error: "User already exists in this company" }, 409);
    }

    const inviteToken = crypto.randomUUID();
    const frontendUrl =
      process.env.FRONTEND_URL ?? "http://guardrails.localhost:1355";

    await db.insert(companyUsers).values({
      companyId: auth.companyId,
      email,
      role,
      status: "invited",
      inviteToken,
    });

    return c.json(
      { inviteLink: `${frontendUrl}/accept-invite?token=${inviteToken}` },
      201,
    );
  },
);

// GET /
users.get("/", authMiddleware, requireRole("super_admin"), async (c) => {
  const auth = c.get("auth");

  const usersList = await db
    .select({
      id: companyUsers.id,
      email: companyUsers.email,
      role: companyUsers.role,
      status: companyUsers.status,
      createdAt: companyUsers.createdAt,
    })
    .from(companyUsers)
    .where(eq(companyUsers.companyId, auth.companyId));

  return c.json({ users: usersList });
});

export { users };
