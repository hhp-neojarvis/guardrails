import { Hono } from "hono";
import { db, companyUsers, eq, and } from "@guardrails/db";
import { auth } from "../lib/auth.js";

const acceptInvite = new Hono();

acceptInvite.post("/accept-invite", async (c) => {
  const { token, password } = await c.req.json();

  if (!token || !password) {
    return c.json({ error: "Token and password are required" }, 400);
  }

  const [invite] = await db
    .select()
    .from(companyUsers)
    .where(and(eq(companyUsers.inviteToken, token), eq(companyUsers.status, "invited")));

  if (!invite) {
    return c.json({ error: "Invalid or expired invitation" }, 400);
  }

  const result = await auth.api.signUpEmail({
    body: { name: invite.email, email: invite.email, password },
  });

  if (!result.user) {
    return c.json({ error: "Failed to create account" }, 500);
  }

  await db
    .update(companyUsers)
    .set({ userId: result.user.id, status: "active", inviteToken: null })
    .where(eq(companyUsers.id, invite.id));

  return c.json({ success: true });
});

export { acceptInvite };
