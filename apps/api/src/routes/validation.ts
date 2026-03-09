import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import {
  db,
  excelUploads,
  metaAdAccounts,
  campaignGroups,
  metaCampaignSnapshots,
  campaignMatches,
  validationReports,
  validationFlags,
  eq,
  and,
  desc,
  inArray,
} from "@guardrails/db";
import { decrypt } from "../lib/crypto.js";
import { fetchMetaCampaigns } from "../services/meta-campaign-fetcher.js";
import { generateMatchSuggestions } from "../services/campaign-matcher.js";
import { validateCampaignFields } from "../services/plan-vs-live-validator.js";
import type {
  ConfirmMatchesRequest,
  CreateFlagRequest,
  ResolveFlagRequest,
  MetaCampaignSnapshot,
  CampaignValidationResult,
  ValidationReport,
} from "@guardrails/shared";
import type { CampaignGroup } from "@guardrails/shared";

const validation = new Hono<AuthEnv>();

// ─── Helper: Load and validate upload belongs to company ─────────────────────

async function loadUpload(uploadId: string, companyId: string) {
  const [upload] = await db
    .select()
    .from(excelUploads)
    .where(
      and(
        eq(excelUploads.id, uploadId),
        eq(excelUploads.companyId, companyId),
      ),
    );
  return upload ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 4: Fetch + Snapshot Routes
// ═══════════════════════════════════════════════════════════════════════════════

// POST /uploads/:id/fetch-campaigns — fetch live Meta campaigns and snapshot them
validation.post("/uploads/:id/fetch-campaigns", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  // Load the meta ad account for this upload
  const [adAccount] = await db
    .select()
    .from(metaAdAccounts)
    .where(
      and(
        eq(metaAdAccounts.id, upload.metaAdAccountId),
        eq(metaAdAccounts.companyId, auth.companyId),
      ),
    );

  if (!adAccount) {
    return c.json({ error: "Ad account not found" }, 404);
  }

  // Decrypt the access token
  let accessToken: string;
  try {
    accessToken = decrypt(adAccount.encryptedAccessToken, adAccount.tokenIv);
  } catch {
    return c.json({ error: "Failed to decrypt ad account token" }, 500);
  }

  // Fetch campaigns from Meta API
  let campaigns: Omit<MetaCampaignSnapshot, "id" | "uploadId">[];
  try {
    campaigns = await fetchMetaCampaigns({
      adAccountId: adAccount.metaAccountId,
      accessToken,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to fetch campaigns" },
      502,
    );
  }

  // Upsert each campaign into metaCampaignSnapshots
  for (const campaign of campaigns) {
    await db
      .insert(metaCampaignSnapshots)
      .values({
        uploadId,
        companyId: auth.companyId,
        metaCampaignId: campaign.metaCampaignId,
        data: campaign,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [metaCampaignSnapshots.uploadId, metaCampaignSnapshots.metaCampaignId],
        set: {
          data: campaign,
          fetchedAt: new Date(),
        },
      });
  }

  return c.json({ campaigns, count: campaigns.length });
});

// GET /uploads/:id/meta-campaigns — list snapshotted Meta campaigns for an upload
validation.get("/uploads/:id/meta-campaigns", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  const snapshots = await db
    .select()
    .from(metaCampaignSnapshots)
    .where(
      and(
        eq(metaCampaignSnapshots.uploadId, uploadId),
        eq(metaCampaignSnapshots.companyId, auth.companyId),
      ),
    );

  return c.json({
    campaigns: snapshots.map((s) => s.data as MetaCampaignSnapshot),
    count: snapshots.length,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 6: Match Routes
// ═══════════════════════════════════════════════════════════════════════════════

// GET /uploads/:id/match-suggestions — generate auto-match suggestions
validation.get("/uploads/:id/match-suggestions", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  // Load campaign groups for this upload
  const groups = await db
    .select()
    .from(campaignGroups)
    .where(eq(campaignGroups.uploadId, uploadId));

  // Load meta campaign snapshots for this upload
  const snapshots = await db
    .select()
    .from(metaCampaignSnapshots)
    .where(
      and(
        eq(metaCampaignSnapshots.uploadId, uploadId),
        eq(metaCampaignSnapshots.companyId, auth.companyId),
      ),
    );

  const metaCampaigns = snapshots.map((s) => s.data as MetaCampaignSnapshot);

  const suggestions = generateMatchSuggestions(
    groups as unknown as CampaignGroup[],
    metaCampaigns,
  );

  return c.json({ suggestions });
});

// POST /uploads/:id/matches — confirm matches
validation.post("/uploads/:id/matches", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  const body = (await c.req.json()) as ConfirmMatchesRequest;

  if (!body.matches || !Array.isArray(body.matches) || body.matches.length === 0) {
    return c.json({ error: "matches array is required and must not be empty" }, 400);
  }

  // Validate all campaignGroupIds belong to this upload
  const groupIds = body.matches.map((m) => m.campaignGroupId);
  const groups = await db
    .select()
    .from(campaignGroups)
    .where(
      and(
        eq(campaignGroups.uploadId, uploadId),
        inArray(campaignGroups.id, groupIds),
      ),
    );

  if (groups.length !== groupIds.length) {
    return c.json({ error: "One or more campaignGroupIds do not belong to this upload" }, 400);
  }

  // Validate all metaCampaignIds exist in snapshots for this upload
  const metaIds = body.matches.map((m) => m.metaCampaignId);
  const snapshots = await db
    .select()
    .from(metaCampaignSnapshots)
    .where(
      and(
        eq(metaCampaignSnapshots.uploadId, uploadId),
        inArray(metaCampaignSnapshots.metaCampaignId, metaIds),
      ),
    );

  const snapshotMetaIds = new Set(snapshots.map((s) => s.metaCampaignId));
  for (const metaId of metaIds) {
    if (!snapshotMetaIds.has(metaId)) {
      return c.json({ error: `Meta campaign ${metaId} not found in snapshots for this upload` }, 400);
    }
  }

  // Delete existing matches for this upload, then insert new ones
  await db
    .delete(campaignMatches)
    .where(eq(campaignMatches.uploadId, uploadId));

  const inserted = [];
  for (const match of body.matches) {
    const [row] = await db
      .insert(campaignMatches)
      .values({
        uploadId,
        campaignGroupId: match.campaignGroupId,
        metaCampaignId: match.metaCampaignId,
        confidence: match.confidence,
        confirmedByUserId: auth.userId,
      })
      .returning();
    inserted.push({
      id: row.id,
      uploadId: row.uploadId,
      campaignGroupId: row.campaignGroupId,
      metaCampaignId: row.metaCampaignId,
      confidence: row.confidence,
      confirmedByUserId: row.confirmedByUserId,
      confirmedAt: row.createdAt?.toISOString() ?? "",
    });
  }

  return c.json({ matches: inserted });
});

// GET /uploads/:id/matches — list confirmed matches
validation.get("/uploads/:id/matches", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  const matches = await db
    .select()
    .from(campaignMatches)
    .where(eq(campaignMatches.uploadId, uploadId));

  return c.json({
    matches: matches.map((m) => ({
      id: m.id,
      uploadId: m.uploadId,
      campaignGroupId: m.campaignGroupId,
      metaCampaignId: m.metaCampaignId,
      confidence: m.confidence,
      confirmedByUserId: m.confirmedByUserId,
      confirmedAt: m.createdAt?.toISOString() ?? "",
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 8: Validate Route
// ═══════════════════════════════════════════════════════════════════════════════

// POST /uploads/:id/validate — run plan-vs-live validation
validation.post("/uploads/:id/validate", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  // Load confirmed matches
  const matches = await db
    .select()
    .from(campaignMatches)
    .where(eq(campaignMatches.uploadId, uploadId));

  if (matches.length === 0) {
    return c.json({ error: "No confirmed matches found. Confirm matches first." }, 400);
  }

  // Load all campaign groups and snapshots for this upload
  const groups = await db
    .select()
    .from(campaignGroups)
    .where(eq(campaignGroups.uploadId, uploadId));

  const snapshots = await db
    .select()
    .from(metaCampaignSnapshots)
    .where(
      and(
        eq(metaCampaignSnapshots.uploadId, uploadId),
        eq(metaCampaignSnapshots.companyId, auth.companyId),
      ),
    );

  // Build lookup maps
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const snapshotMap = new Map(
    snapshots.map((s) => [s.metaCampaignId, s.data as MetaCampaignSnapshot]),
  );

  // Validate each match
  const results: CampaignValidationResult[] = [];
  const matchedGroupIds = new Set<string>();
  const matchedMetaIds = new Set<string>();

  for (const match of matches) {
    const group = groupMap.get(match.campaignGroupId);
    const metaCampaign = snapshotMap.get(match.metaCampaignId);

    if (!group || !metaCampaign) {
      continue;
    }

    matchedGroupIds.add(match.campaignGroupId);
    matchedMetaIds.add(match.metaCampaignId);

    const result = validateCampaignFields(
      group as unknown as CampaignGroup,
      metaCampaign,
      match.confidence,
    );

    results.push(result);
  }

  // Find unmatched plan campaigns
  const unmatchedPlanCampaigns = groups
    .filter((g) => !matchedGroupIds.has(g.id))
    .map((g) => ({ id: g.id, name: g.campaignName }));

  // Find unmatched meta campaigns
  const unmatchedMetaCampaigns = snapshots
    .filter((s) => !matchedMetaIds.has(s.metaCampaignId))
    .map((s) => {
      const data = s.data as MetaCampaignSnapshot;
      return { id: s.metaCampaignId, name: data.name };
    });

  // Aggregate counts
  const totalPass = results.filter((r) => r.overallStatus === "pass").length;
  const totalFail = results.filter((r) => r.overallStatus === "fail").length;
  const totalWarning = results.filter((r) => r.overallStatus === "warning").length;

  const report: ValidationReport = {
    id: "",
    uploadId,
    results,
    unmatchedPlanCampaigns,
    unmatchedMetaCampaigns,
    totalPass,
    totalFail,
    totalWarning,
    createdAt: new Date().toISOString(),
  };

  // Upsert into validationReports (on conflict uploadId -> replace)
  const [saved] = await db
    .insert(validationReports)
    .values({
      uploadId,
      companyId: auth.companyId,
      results: report,
    })
    .onConflictDoUpdate({
      target: [validationReports.uploadId],
      set: {
        results: report,
        createdAt: new Date(),
      },
    })
    .returning();

  report.id = saved.id;

  return c.json(report);
});

// GET /uploads/:id/validation-report — get existing validation report
validation.get("/uploads/:id/validation-report", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  const [report] = await db
    .select()
    .from(validationReports)
    .where(eq(validationReports.uploadId, uploadId));

  if (!report) {
    return c.json({ error: "Validation report not found" }, 404);
  }

  return c.json(report.results as ValidationReport);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 9: Flag Routes
// ═══════════════════════════════════════════════════════════════════════════════

// POST /uploads/:id/flags — create a validation flag
validation.post("/uploads/:id/flags", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  const body = (await c.req.json()) as CreateFlagRequest;

  if (!body.campaignGroupId || !body.metaCampaignId || !body.field || !body.severity || !body.note) {
    return c.json({ error: "campaignGroupId, metaCampaignId, field, severity, and note are required" }, 400);
  }

  const [flag] = await db
    .insert(validationFlags)
    .values({
      uploadId,
      campaignGroupId: body.campaignGroupId,
      metaCampaignId: body.metaCampaignId,
      field: body.field,
      severity: body.severity,
      note: body.note,
      flaggedByUserId: auth.userId,
      flaggedByEmail: auth.email,
    })
    .returning();

  return c.json(
    {
      id: flag.id,
      uploadId: flag.uploadId,
      campaignGroupId: flag.campaignGroupId,
      metaCampaignId: flag.metaCampaignId,
      field: flag.field,
      severity: flag.severity,
      note: flag.note,
      flaggedByUserId: flag.flaggedByUserId,
      flaggedByEmail: flag.flaggedByEmail,
      flaggedAt: flag.flaggedAt?.toISOString() ?? "",
      resolved: flag.resolved,
      resolvedByUserId: flag.resolvedByUserId ?? undefined,
      resolvedByEmail: flag.resolvedByEmail ?? undefined,
      resolvedAt: flag.resolvedAt?.toISOString() ?? undefined,
      resolutionNote: flag.resolutionNote ?? undefined,
    },
    201,
  );
});

// GET /uploads/:id/flags — list all flags for an upload
validation.get("/uploads/:id/flags", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const upload = await loadUpload(uploadId, auth.companyId);
  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  const flags = await db
    .select()
    .from(validationFlags)
    .where(eq(validationFlags.uploadId, uploadId))
    .orderBy(desc(validationFlags.flaggedAt));

  return c.json({
    flags: flags.map((f) => ({
      id: f.id,
      uploadId: f.uploadId,
      campaignGroupId: f.campaignGroupId,
      metaCampaignId: f.metaCampaignId,
      field: f.field,
      severity: f.severity,
      note: f.note,
      flaggedByUserId: f.flaggedByUserId,
      flaggedByEmail: f.flaggedByEmail,
      flaggedAt: f.flaggedAt?.toISOString() ?? "",
      resolved: f.resolved,
      resolvedByUserId: f.resolvedByUserId ?? undefined,
      resolvedByEmail: f.resolvedByEmail ?? undefined,
      resolvedAt: f.resolvedAt?.toISOString() ?? undefined,
      resolutionNote: f.resolutionNote ?? undefined,
    })),
  });
});

// PATCH /uploads/:id/flags/:flagId — resolve a flag
validation.patch("/uploads/:id/flags/:flagId", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");
  const flagId = c.req.param("flagId");

  // Validate flag belongs to this upload
  const [existing] = await db
    .select()
    .from(validationFlags)
    .where(
      and(
        eq(validationFlags.id, flagId),
        eq(validationFlags.uploadId, uploadId),
      ),
    );

  if (!existing) {
    return c.json({ error: "Flag not found" }, 404);
  }

  const body = (await c.req.json()) as ResolveFlagRequest;

  const [updated] = await db
    .update(validationFlags)
    .set({
      resolved: true,
      resolvedByUserId: auth.userId,
      resolvedByEmail: auth.email,
      resolvedAt: new Date(),
      resolutionNote: body.resolutionNote ?? null,
    })
    .where(eq(validationFlags.id, flagId))
    .returning();

  return c.json({
    id: updated.id,
    uploadId: updated.uploadId,
    campaignGroupId: updated.campaignGroupId,
    metaCampaignId: updated.metaCampaignId,
    field: updated.field,
    severity: updated.severity,
    note: updated.note,
    flaggedByUserId: updated.flaggedByUserId,
    flaggedByEmail: updated.flaggedByEmail,
    flaggedAt: updated.flaggedAt?.toISOString() ?? "",
    resolved: updated.resolved,
    resolvedByUserId: updated.resolvedByUserId ?? undefined,
    resolvedByEmail: updated.resolvedByEmail ?? undefined,
    resolvedAt: updated.resolvedAt?.toISOString() ?? undefined,
    resolutionNote: updated.resolutionNote ?? undefined,
  });
});

// DELETE /uploads/:id/flags/:flagId — delete a flag (only creator can delete)
validation.delete("/uploads/:id/flags/:flagId", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");
  const flagId = c.req.param("flagId");

  // Validate flag belongs to this upload
  const [existing] = await db
    .select()
    .from(validationFlags)
    .where(
      and(
        eq(validationFlags.id, flagId),
        eq(validationFlags.uploadId, uploadId),
      ),
    );

  if (!existing) {
    return c.json({ error: "Flag not found" }, 404);
  }

  // Only the creator can delete
  if (existing.flaggedByUserId !== auth.userId) {
    return c.json({ error: "Only the flag creator can delete this flag" }, 403);
  }

  await db
    .delete(validationFlags)
    .where(eq(validationFlags.id, flagId));

  return c.json({ success: true });
});

export { validation };
