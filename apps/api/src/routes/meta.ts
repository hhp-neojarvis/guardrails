import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";

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

export { meta, pendingAccounts };
