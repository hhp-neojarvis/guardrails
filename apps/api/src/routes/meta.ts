import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { db, metaAdAccounts, companyUsers, eq, and } from "@guardrails/db";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------
function env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// ---------------------------------------------------------------------------
// In-memory OAuth state store (10-minute TTL)
// ---------------------------------------------------------------------------
const oauthStates = new Map<
  string,
  { userId: string; companyId: string; createdAt: number }
>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStates) {
    if (now - val.createdAt > 10 * 60 * 1000) oauthStates.delete(key);
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Pending accounts store (10-minute TTL)
// ---------------------------------------------------------------------------
interface PendingEntry {
  accounts: Array<{
    account_id: string;
    name: string;
    account_status: number;
  }>;
  accessToken: string;
  expiresIn: number;
  userId: string;
  companyId: string;
  metaUserId: string;
  createdAt: number;
}

const pendingAccounts = new Map<string, PendingEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingAccounts) {
    if (now - val.createdAt > 10 * 60 * 1000) pendingAccounts.delete(key);
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const meta = new Hono<AuthEnv>();

// GET /auth-url — protected
meta.get("/auth-url", authMiddleware, (c) => {
  const { userId, companyId } = c.get("auth");

  const state = crypto.randomUUID();
  oauthStates.set(state, { userId, companyId, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: env("META_APP_ID"),
    redirect_uri: env("META_OAUTH_REDIRECT_URI"),
    state,
    scope: "ads_management,ads_read,business_management",
    response_type: "code",
  });

  const url = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  return c.json({ url });
});

// GET /callback — public (no auth middleware)
meta.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const frontendUrl =
    process.env.FRONTEND_URL ?? "http://guardrails.localhost:1355";

  if (!code || !state) {
    return c.redirect(
      `${frontendUrl}/settings/meta-accounts?status=error&reason=missing_params`,
    );
  }

  const stateEntry = oauthStates.get(state);
  if (!stateEntry) {
    return c.redirect(
      `${frontendUrl}/settings/meta-accounts?status=error&reason=invalid_state`,
    );
  }

  const { userId, companyId } = stateEntry;
  oauthStates.delete(state);

  const appId = env("META_APP_ID");
  const appSecret = env("META_APP_SECRET");
  const redirectUri = env("META_OAUTH_REDIRECT_URI");

  try {
    // 1. Exchange code for short-lived token
    const shortParams = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      client_secret: appSecret,
      code,
    });

    const shortRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${shortParams.toString()}`,
    );
    if (!shortRes.ok) {
      const err = await shortRes.text();
      console.error("Short-lived token exchange failed:", err);
      return c.redirect(
        `${frontendUrl}/settings/meta-accounts?status=error&reason=token_exchange`,
      );
    }
    const shortData = (await shortRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    // 2. Exchange short-lived for long-lived token
    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortData.access_token,
    });

    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${longParams.toString()}`,
    );
    if (!longRes.ok) {
      const err = await longRes.text();
      console.error("Long-lived token exchange failed:", err);
      return c.redirect(
        `${frontendUrl}/settings/meta-accounts?status=error&reason=token_exchange`,
      );
    }
    const longData = (await longRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    // 3. Fetch ad accounts
    const accountsParams = new URLSearchParams({
      access_token: longData.access_token,
      fields: "account_id,name,account_status",
    });

    const accountsRes = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?${accountsParams.toString()}`,
    );
    if (!accountsRes.ok) {
      const err = await accountsRes.text();
      console.error("Ad accounts fetch failed:", err);
      return c.redirect(
        `${frontendUrl}/settings/meta-accounts?status=error&reason=accounts_fetch`,
      );
    }
    const accountsData = (await accountsRes.json()) as {
      data: Array<{
        account_id: string;
        name: string;
        account_status: number;
      }>;
    };

    // 4. Fetch Meta user ID
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?access_token=${longData.access_token}`,
    );
    const meData = (await meRes.json()) as { id: string };

    // 5. Store in pending accounts
    const sessionId = crypto.randomUUID();
    pendingAccounts.set(sessionId, {
      accounts: accountsData.data,
      accessToken: longData.access_token,
      expiresIn: longData.expires_in,
      userId,
      companyId,
      metaUserId: meData.id,
      createdAt: Date.now(),
    });

    return c.redirect(
      `${frontendUrl}/settings/meta-accounts?status=select&session=${sessionId}`,
    );
  } catch (err) {
    console.error("Meta OAuth callback error:", err);
    return c.redirect(
      `${frontendUrl}/settings/meta-accounts?status=error&reason=unknown`,
    );
  }
});

// GET /pending-accounts — protected
meta.get("/pending-accounts", authMiddleware, async (c) => {
  const sessionId = c.req.query("sessionId");
  if (!sessionId) {
    return c.json({ error: "sessionId query param is required" }, 400);
  }

  const entry = pendingAccounts.get(sessionId);
  if (!entry) {
    return c.json({ error: "Session not found or expired" }, 404);
  }

  // Validate that the requesting user is the one who initiated OAuth
  const authCtx = c.get("auth");
  if (entry.userId !== authCtx.userId) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json({
    accounts: entry.accounts,
    metaUserId: entry.metaUserId,
    sessionId,
  });
});

// POST /accounts — connect selected ad accounts
meta.post("/accounts", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const { metaUserId, selectedAccountIds, sessionId } = await c.req.json<{
    metaUserId: string;
    selectedAccountIds: string[];
    sessionId: string;
  }>();

  if (!sessionId || !selectedAccountIds?.length) {
    return c.json({ error: "sessionId and selectedAccountIds are required" }, 400);
  }

  const entry = pendingAccounts.get(sessionId);
  if (!entry) {
    return c.json({ error: "Session not found or expired" }, 404);
  }

  // Validate user matches
  if (entry.userId !== auth.userId) {
    return c.json({ error: "Forbidden" }, 403);
  }

  let connected = 0;
  let skipped = 0;

  for (const accountId of selectedAccountIds) {
    const account = entry.accounts.find((a) => a.account_id === accountId);
    if (!account) continue;

    const { ciphertext, iv } = encrypt(entry.accessToken);
    const tokenExpiresAt = new Date(Date.now() + entry.expiresIn * 1000);

    try {
      await db.insert(metaAdAccounts).values({
        companyId: auth.companyId,
        connectedByUserId: auth.userId,
        metaUserId: entry.metaUserId,
        metaAccountId: account.account_id,
        metaAccountName: account.name,
        encryptedAccessToken: ciphertext,
        tokenIv: iv,
        tokenExpiresAt,
        tokenStatus: "valid",
      });
      connected++;
    } catch (err: any) {
      // Unique constraint violation — account already connected for this company
      if (err?.code === "23505") {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  // Clear the pending session
  pendingAccounts.delete(sessionId);

  return c.json({ connected, skipped });
});

// GET /accounts — list connected accounts for the company
meta.get("/accounts", authMiddleware, async (c) => {
  const auth = c.get("auth");

  const rows = await db
    .select({
      id: metaAdAccounts.id,
      metaAccountId: metaAdAccounts.metaAccountId,
      metaAccountName: metaAdAccounts.metaAccountName,
      connectedByEmail: companyUsers.email,
      connectedAt: metaAdAccounts.createdAt,
      tokenStatus: metaAdAccounts.tokenStatus,
    })
    .from(metaAdAccounts)
    .leftJoin(
      companyUsers,
      and(
        eq(companyUsers.userId, metaAdAccounts.connectedByUserId),
        eq(companyUsers.companyId, metaAdAccounts.companyId),
      ),
    )
    .where(eq(metaAdAccounts.companyId, auth.companyId));

  const accounts = rows.map((r) => ({
    id: r.id,
    metaAccountId: r.metaAccountId,
    metaAccountName: r.metaAccountName,
    connectedByEmail: r.connectedByEmail ?? "unknown",
    connectedAt: r.connectedAt?.toISOString() ?? "",
    tokenStatus: r.tokenStatus as "valid" | "expired" | "error",
  }));

  return c.json({ accounts });
});

// DELETE /accounts/:id — disconnect an ad account
meta.delete("/accounts/:id", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const accountId = c.req.param("id");

  const [existing] = await db
    .select({ id: metaAdAccounts.id })
    .from(metaAdAccounts)
    .where(
      and(
        eq(metaAdAccounts.id, accountId),
        eq(metaAdAccounts.companyId, auth.companyId),
      ),
    );

  if (!existing) {
    return c.json({ error: "Account not found" }, 404);
  }

  await db
    .delete(metaAdAccounts)
    .where(eq(metaAdAccounts.id, accountId));

  return c.json({ success: true });
});

// POST /accounts/:id/refresh — manually refresh a token
meta.post("/accounts/:id/refresh", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const accountId = c.req.param("id");

  const [account] = await db
    .select()
    .from(metaAdAccounts)
    .where(
      and(
        eq(metaAdAccounts.id, accountId),
        eq(metaAdAccounts.companyId, auth.companyId),
      ),
    );

  if (!account) {
    return c.json({ error: "Account not found" }, 404);
  }

  try {
    const currentToken = decrypt(account.encryptedAccessToken, account.tokenIv);

    const response = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${env("META_APP_ID")}&` +
      `client_secret=${env("META_APP_SECRET")}&` +
      `fb_exchange_token=${currentToken}`
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Token refresh failed:", errBody);

      await db
        .update(metaAdAccounts)
        .set({ tokenStatus: "error", updatedAt: new Date() })
        .where(eq(metaAdAccounts.id, accountId));

      return c.json({ error: "Token refresh failed", tokenStatus: "error" }, 502);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };

    const { ciphertext, iv } = encrypt(data.access_token);
    const tokenExpiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await db
      .update(metaAdAccounts)
      .set({
        encryptedAccessToken: ciphertext,
        tokenIv: iv,
        tokenExpiresAt,
        tokenStatus: "valid",
        updatedAt: new Date(),
      })
      .where(eq(metaAdAccounts.id, accountId));

    return c.json({ success: true, tokenStatus: "valid" });
  } catch (error) {
    console.error("Token refresh error:", error);

    await db
      .update(metaAdAccounts)
      .set({ tokenStatus: "error", updatedAt: new Date() })
      .where(eq(metaAdAccounts.id, accountId));

    return c.json({ error: "Token refresh failed", tokenStatus: "error" }, 500);
  }
});

export { meta, pendingAccounts };
