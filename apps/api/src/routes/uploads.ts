import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import {
  db,
  metaAdAccounts,
  excelUploads,
  campaignGroups,
  eq,
  and,
} from "@guardrails/db";
import { decrypt } from "../lib/crypto.js";
import { parseExcel, groupIntoCampaigns } from "../services/excel-parser.js";
import { validateRows } from "../services/excel-validator.js";
import { interpretGeoFromMarkets } from "../services/geo-interpreter.js";
import { resolveGeoTargets } from "../services/geo-resolver.js";
import type { PipelineEvent, CampaignGroup, ThinkingEntry } from "@guardrails/shared";

const uploads = new Hono<AuthEnv>();

// POST /upload — multipart file upload with SSE streaming pipeline
uploads.post("/upload", authMiddleware, async (c) => {
  const auth = c.get("auth");

  // Parse multipart form data
  const formData = await c.req.formData();
  const file = formData.get("file");
  const metaAdAccountId = formData.get("metaAdAccountId");

  if (!file || !(file instanceof File)) {
    return c.json({ error: "File is required" }, 400);
  }

  if (!metaAdAccountId || typeof metaAdAccountId !== "string") {
    return c.json({ error: "metaAdAccountId is required" }, 400);
  }

  // Validate file type
  const fileName = file.name;
  if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
    return c.json({ error: "Only .xlsx and .xls files are supported" }, 400);
  }

  // Validate ad account belongs to company and token is valid
  const [adAccount] = await db
    .select()
    .from(metaAdAccounts)
    .where(
      and(
        eq(metaAdAccounts.id, metaAdAccountId),
        eq(metaAdAccounts.companyId, auth.companyId),
      ),
    );

  if (!adAccount) {
    return c.json({ error: "Ad account not found" }, 404);
  }

  if (adAccount.tokenStatus !== "valid") {
    return c.json({ error: "Ad account token is not valid. Please reconnect." }, 400);
  }

  // Decrypt access token
  let accessToken: string;
  try {
    accessToken = decrypt(adAccount.encryptedAccessToken, adAccount.tokenIv);
  } catch {
    return c.json({ error: "Failed to decrypt ad account token" }, 500);
  }

  // Read file buffer
  const buffer = await file.arrayBuffer();

  // Return SSE stream
  return streamSSE(c, async (stream) => {
    let uploadId: string | undefined;

    const sendEvent = async (event: PipelineEvent) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    };

    try {
      const sendThinking = async (entry: ThinkingEntry) => {
        await sendEvent({
          type: "thinking",
          message: entry.message,
          data: { thinking: entry },
        });
      };

      // ── Stage 1: Parsing ──
      await sendEvent({
        type: "parsing",
        message: "Parsing Excel file...",
      });

      const rows = parseExcel(buffer);

      // Emit thinking for each parsed row
      for (let i = 0; i < rows.length; i++) {
        await sendThinking({
          stage: "parsing",
          subject: `Row ${i + 2}`,
          message: `Row ${i + 2}: Markets='${rows[i].markets}', Channel='${rows[i].channel}', Budget='${rows[i].budget}'`,
          status: "info",
        });
      }

      await sendEvent({
        type: "parsed",
        message: `Parsed ${rows.length} rows`,
        data: { totalRows: rows.length },
      });

      // ── Stage 2: Validation ──
      await sendEvent({
        type: "validating",
        message: "Validating data...",
      });

      const validationResult = await validateRows(rows, async (entry) => {
        await sendThinking(entry);
      });

      await sendEvent({
        type: "validated",
        message: validationResult.valid
          ? `Validation passed: ${rows.length} rows OK`
          : `Validation failed: ${validationResult.issues.filter((i) => i.severity === "error").length} errors`,
        data: { validation: validationResult, totalRows: rows.length },
      });

      if (!validationResult.valid) {
        await sendEvent({
          type: "error",
          message: "Validation failed — fix the issues and re-upload",
          data: {
            error: "Validation failed",
            validation: validationResult,
          },
        });
        return;
      }

      // ── Create upload record ──
      const [upload] = await db
        .insert(excelUploads)
        .values({
          companyId: auth.companyId,
          uploadedByUserId: auth.userId,
          metaAdAccountId: metaAdAccountId,
          fileName,
          status: "processing",
          totalRows: rows.length,
          rawData: rows,
        })
        .returning({ id: excelUploads.id });

      uploadId = upload.id;

      // ── Group into campaigns ──
      const groups = groupIntoCampaigns(rows);

      await sendThinking({
        stage: "parsing",
        message: `Grouped ${rows.length} rows into ${groups.length} campaigns`,
        status: "info",
      });

      for (const group of groups) {
        await sendThinking({
          stage: "parsing",
          subject: group.campaignName,
          message: `Group '${group.markets} - ${group.channel}': ${group.lineItems.length} line items`,
          status: "info",
        });
      }

      // ── Stage 3: Geo Interpretation ──
      await sendEvent({
        type: "interpreting",
        message: "Interpreting geographic targets...",
      });

      // Deduplicate Markets values before LLM calls
      const uniqueMarkets = [...new Set(groups.map((g) => g.markets))];
      const marketsToIntents = new Map<string, CampaignGroup["geoIntents"]>();

      for (const markets of uniqueMarkets) {
        await sendThinking({
          stage: "interpreting",
          subject: markets,
          message: `Interpreting '${markets}'...`,
          status: "info",
        });

        try {
          const intents = await interpretGeoFromMarkets(markets);
          marketsToIntents.set(markets, intents);
          await sendThinking({
            stage: "interpreting",
            subject: markets,
            message: `Extracted ${intents.length} geo targets: ${intents.map((i) => i.name).join(", ")}`,
            status: "pass",
          });
        } catch (err) {
          console.error(`Failed to interpret Markets "${markets}":`, err);
          marketsToIntents.set(markets, []);
          await sendThinking({
            stage: "interpreting",
            subject: markets,
            message: `Failed to interpret: ${err instanceof Error ? err.message : String(err)}`,
            status: "fail",
          });
        }
      }

      // Assign intents to groups
      for (const group of groups) {
        group.geoIntents = marketsToIntents.get(group.markets) ?? [];
      }

      await sendEvent({
        type: "interpreted",
        message: `Interpreted ${uniqueMarkets.length} unique Markets values`,
        data: { totalGroups: groups.length },
      });

      // ── Stage 4: Geo Resolution ──
      await sendEvent({
        type: "resolving",
        message: "Resolving geo targets against Meta API...",
      });

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];

        if (group.geoIntents.length === 0) {
          group.status = "resolved";
          await sendThinking({
            stage: "resolving",
            subject: group.campaignName,
            message: `Skipping '${group.markets}' — no geo intents`,
            status: "info",
          });
          continue;
        }

        await sendEvent({
          type: "resolving",
          message: `Resolving geo for "${group.markets}"...`,
          data: {
            currentGroup: group.markets,
            progress: Math.round(((i + 1) / groups.length) * 100),
          },
        });

        for (const intent of group.geoIntents) {
          await sendThinking({
            stage: "resolving",
            subject: intent.name,
            message: `Resolving '${intent.name}' (${intent.type}, ${intent.countryCode})...`,
            status: "info",
          });
        }

        try {
          const result = await resolveGeoTargets(group.geoIntents, accessToken);
          group.resolvedGeoTargets = result.resolved;
          group.unresolvedIntents = result.unresolved;
          group.status = "resolved";

          for (const target of result.resolved) {
            await sendThinking({
              stage: "resolving",
              subject: target.name,
              message: `Found match: ${target.name} (key=${target.key})`,
              status: "pass",
            });
          }
          for (const u of result.unresolved) {
            await sendThinking({
              stage: "resolving",
              subject: u.intent.name,
              message: `No match: ${u.reason}`,
              status: "warn",
            });
          }
        } catch (err) {
          console.error(`Failed to resolve geo for "${group.markets}":`, err);
          group.status = "error";
          group.unresolvedIntents = group.geoIntents.map((intent) => ({
            intent,
            reason: `Resolution failed: ${err instanceof Error ? err.message : String(err)}`,
          }));
          await sendThinking({
            stage: "resolving",
            subject: group.markets,
            message: `Resolution failed: ${err instanceof Error ? err.message : String(err)}`,
            status: "fail",
          });
        }
      }

      await sendEvent({
        type: "resolved",
        message: "Geo resolution complete",
        data: { totalGroups: groups.length, groups },
      });

      // ── Save campaign groups to DB ──
      for (const group of groups) {
        await db.insert(campaignGroups).values({
          uploadId: uploadId!,
          companyId: auth.companyId,
          markets: group.markets,
          channel: group.channel,
          campaignName: group.campaignName,
          lineItems: group.lineItems,
          geoIntents: group.geoIntents,
          resolvedGeoTargets: group.resolvedGeoTargets,
          unresolvedIntents: group.unresolvedIntents,
          status: group.status,
        });
      }

      // Update upload status
      await db
        .update(excelUploads)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(excelUploads.id, uploadId!));

      // ── Complete ──
      await sendEvent({
        type: "complete",
        message: "Upload processing complete",
        data: {
          totalRows: rows.length,
          totalGroups: groups.length,
          groups,
        },
      });
    } catch (err) {
      console.error("Upload pipeline error:", err);

      // Update upload status if we have an upload record
      if (uploadId) {
        await db
          .update(excelUploads)
          .set({
            status: "error",
            errorMessage:
              err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(excelUploads.id, uploadId));
      }

      await sendEvent({
        type: "error",
        message: err instanceof Error ? err.message : "Upload processing failed",
        data: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });
});

// GET /uploads/:id — retrieve a stored upload with its campaign groups
uploads.get("/uploads/:id", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const [upload] = await db
    .select()
    .from(excelUploads)
    .where(
      and(
        eq(excelUploads.id, uploadId),
        eq(excelUploads.companyId, auth.companyId),
      ),
    );

  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  const groups = await db
    .select()
    .from(campaignGroups)
    .where(eq(campaignGroups.uploadId, uploadId));

  return c.json({
    id: upload.id,
    fileName: upload.fileName,
    status: upload.status,
    totalRows: upload.totalRows,
    groups: groups.map((g) => ({
      id: g.id,
      markets: g.markets,
      channel: g.channel,
      campaignName: g.campaignName,
      lineItems: g.lineItems,
      geoIntents: g.geoIntents,
      resolvedGeoTargets: g.resolvedGeoTargets,
      unresolvedIntents: g.unresolvedIntents,
      status: g.status,
    })),
    errorMessage: upload.errorMessage,
    createdAt: upload.createdAt?.toISOString() ?? "",
  });
});

export { uploads };
