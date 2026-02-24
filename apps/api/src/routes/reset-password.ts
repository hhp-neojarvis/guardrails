import { Hono } from "hono";
import { db, companyUsers, account, eq, and } from "@guardrails/db";
import bcrypt from "bcryptjs";

const resetPassword = new Hono();

resetPassword.post("/reset-password", async (c) => {
  const { token, password } = await c.req.json();

  if (!token || !password) {
    return c.json({ error: "Token and password are required" }, 400);
  }

  const [record] = await db
    .select()
    .from(companyUsers)
    .where(
      and(
        eq(companyUsers.resetToken, token),
        eq(companyUsers.status, "active"),
      ),
    );

  if (!record) {
    return c.json({ error: "Invalid or expired reset link" }, 400);
  }

  if (
    !record.resetTokenExpiresAt ||
    record.resetTokenExpiresAt < new Date()
  ) {
    return c.json({ error: "Reset link has expired" }, 400);
  }

  if (!record.userId) {
    return c.json({ error: "User account not found" }, 400);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await db
    .update(account)
    .set({ password: hashedPassword })
    .where(
      and(
        eq(account.userId, record.userId),
        eq(account.providerId, "credential"),
      ),
    );

  await db
    .update(companyUsers)
    .set({ resetToken: null, resetTokenExpiresAt: null })
    .where(eq(companyUsers.id, record.id));

  return c.json({ success: true });
});

export { resetPassword };
