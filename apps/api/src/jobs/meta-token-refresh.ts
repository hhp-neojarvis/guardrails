// Token refresh job for Meta access tokens
// Refreshes tokens expiring within 7 days

import { db, metaAdAccounts, eq, sql } from '@guardrails/db';
import { encrypt, decrypt } from '../lib/crypto.js';

export async function refreshExpiringTokens(): Promise<{ refreshed: number; failed: number }> {
  // Query tokens expiring within 7 days that are still valid
  const expiring = await db
    .select()
    .from(metaAdAccounts)
    .where(
      sql`${metaAdAccounts.tokenStatus} = 'valid' AND ${metaAdAccounts.tokenExpiresAt} < NOW() + INTERVAL '7 days'`
    );

  let refreshed = 0;
  let failed = 0;

  for (const account of expiring) {
    try {
      const currentToken = decrypt(account.encryptedAccessToken, account.tokenIv);

      // Exchange for new long-lived token
      const response = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token?` +
        `grant_type=fb_exchange_token&` +
        `client_id=${process.env.META_APP_ID}&` +
        `client_secret=${process.env.META_APP_SECRET}&` +
        `fb_exchange_token=${currentToken}`
      );

      if (!response.ok) {
        throw new Error(`Meta API error: ${response.status}`);
      }

      const data = await response.json() as { access_token: string; expires_in?: number };
      const { ciphertext, iv } = encrypt(data.access_token);

      const tokenExpiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;

      await db
        .update(metaAdAccounts)
        .set({
          encryptedAccessToken: ciphertext,
          tokenIv: iv,
          tokenExpiresAt: tokenExpiresAt,
          tokenStatus: 'valid',
          updatedAt: new Date(),
        })
        .where(eq(metaAdAccounts.id, account.id));

      refreshed++;
    } catch (error) {
      console.error(`Failed to refresh token for account ${account.metaAccountId}:`, error);

      await db
        .update(metaAdAccounts)
        .set({
          tokenStatus: 'error',
          updatedAt: new Date(),
        })
        .where(eq(metaAdAccounts.id, account.id));

      failed++;
    }
  }

  return { refreshed, failed };
}

// Start the periodic refresh (every 12 hours)
let intervalId: NodeJS.Timeout | null = null;

export function startTokenRefreshJob() {
  // Run once on startup
  refreshExpiringTokens().then(result => {
    console.log(`Token refresh startup: ${result.refreshed} refreshed, ${result.failed} failed`);
  }).catch(err => {
    console.error('Token refresh startup error:', err);
  });

  // Run every 12 hours
  intervalId = setInterval(() => {
    refreshExpiringTokens().then(result => {
      if (result.refreshed > 0 || result.failed > 0) {
        console.log(`Token refresh: ${result.refreshed} refreshed, ${result.failed} failed`);
      }
    }).catch(err => {
      console.error('Token refresh error:', err);
    });
  }, 12 * 60 * 60 * 1000);
}

export function stopTokenRefreshJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
