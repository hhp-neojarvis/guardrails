import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import {
  db,
  metaAdAccounts,
  excelUploads,
  campaignGroups,
  guardrails,
  guardrailOverrides,
  eq,
  and,
} from "@guardrails/db";
import { decrypt } from "../lib/crypto.js";
import { parseExcel, groupIntoCampaigns } from "../services/excel-parser.js";
import { validateRows } from "../services/excel-validator.js";
import { interpretGeoFromMarkets } from "../services/geo-interpreter.js";
import { resolveGeoTargets } from "../services/geo-resolver.js";
import { interpretLineItem, deriveCampaignBuyType } from "../services/column-interpreter.js";
import { validateGuardrails } from "../services/guardrail-validator.js";
import { validateGuardrailsLLM } from "../services/guardrail-llm-validator.js";
import type { PipelineEvent, CampaignGroup, ThinkingEntry } from "@guardrails/shared";
import type { GuardrailValidationResult } from "@guardrails/shared";

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

      const supportedGroups = groups.filter((g) => g.status !== "unsupported");
      const unsupportedGroups = groups.filter((g) => g.status === "unsupported");

      for (const group of groups) {
        await sendThinking({
          stage: "parsing",
          subject: group.campaignName,
          message: group.status === "unsupported"
            ? `Group '${group.markets} - ${group.channel}': ${group.lineItems.length} line items (unsupported channel — skipped)`
            : `Group '${group.markets} - ${group.channel}': ${group.lineItems.length} line items`,
          status: group.status === "unsupported" ? "warn" : "info",
        });
      }

      // ── Stage 3: Geo Interpretation ──
      await sendEvent({
        type: "interpreting",
        message: "Interpreting geographic targets...",
      });

      // Deduplicate Markets values before LLM calls (only from supported groups)
      const uniqueMarkets = [...new Set(supportedGroups.map((g) => g.markets))];
      const marketsToIntents = new Map<string, CampaignGroup["geoIntents"]>();

      for (const markets of uniqueMarkets) {
        await sendThinking({
          stage: "interpreting",
          subject: markets,
          message: `Interpreting '${markets}'...`,
          status: "info",
        });

        try {
          const intents = await interpretGeoFromMarkets(markets, auth.companyId);
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

      // Assign intents to supported groups only
      for (const group of supportedGroups) {
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

      for (let i = 0; i < supportedGroups.length; i++) {
        const group = supportedGroups[i];

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
            progress: Math.round(((i + 1) / supportedGroups.length) * 100),
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

      // ── Stage 5: Configuring ──
      await sendEvent({
        type: "configuring",
        message: "Interpreting line item columns into Meta configs...",
      });

      for (const group of supportedGroups) {
        const configs = group.lineItems.map((item, idx) => {
          const config = interpretLineItem(item);

          // Emit thinking for each line item
          const parsed: string[] = [];
          if (config.targeting) parsed.push(`Targeting: ${config.targeting.ageMin}-${config.targeting.ageMax} ${config.targeting.genders.length === 2 ? "M+F" : config.targeting.genders[0] === 1 ? "M" : "F"}`);
          if (config.buyType) parsed.push(`Buy: ${config.buyType.buyingType}`);
          if (config.asset) parsed.push(`Asset: ${config.asset.format}${config.asset.videoDurationSeconds ? ` (${config.asset.videoDurationSeconds}s)` : ""}`);
          if (config.inventory) parsed.push(`Inventory: ${config.inventory.publisherPlatforms.join(", ")}`);

          if (parsed.length > 0) {
            sendThinking({
              stage: "configuring",
              subject: `${group.campaignName} #${idx + 1}`,
              message: parsed.join(" | "),
              status: "pass",
            });
          }

          for (const warning of config.warnings) {
            sendThinking({
              stage: "configuring",
              subject: `${group.campaignName} #${idx + 1}`,
              message: warning,
              status: "warn",
            });
          }

          return config;
        });

        group.lineItemConfigs = configs;
        group.campaignBuyType = deriveCampaignBuyType(configs);
      }

      await sendEvent({
        type: "configured",
        message: "Line item configuration complete",
        data: { totalGroups: groups.length, groups },
      });

      // ── Save campaign groups to DB ──
      for (const group of groups) {
        const [inserted] = await db.insert(campaignGroups).values({
          uploadId: uploadId!,
          companyId: auth.companyId,
          markets: group.markets,
          channel: group.channel,
          campaignName: group.campaignName,
          lineItems: group.lineItems,
          geoIntents: group.geoIntents,
          resolvedGeoTargets: group.resolvedGeoTargets,
          unresolvedIntents: group.unresolvedIntents,
          lineItemConfigs: group.lineItemConfigs,
          campaignBuyType: group.campaignBuyType,
          status: group.status,
        }).returning({ id: campaignGroups.id });
        group.id = inserted.id;
      }

      // ── Stage 6: Guardrail Checking ──
      const activeRules = await db
        .select()
        .from(guardrails)
        .where(
          and(
            eq(guardrails.companyId, auth.companyId),
            eq(guardrails.active, true),
          ),
        );

      let guardrailResults: GuardrailValidationResult | undefined;

      if (activeRules.length > 0) {
        await sendEvent({
          type: "guardrail_checking",
          message: "Checking guardrails with AI...",
        });

        // Map DB rows to GuardrailRule type
        const rules = activeRules.map((r) => ({
          id: r.id,
          companyId: r.companyId,
          description: r.description,
          check: r.check as import("@guardrails/shared").GuardrailCheck | undefined,
          active: r.active,
          createdAt: r.createdAt?.toISOString() ?? "",
          updatedAt: r.updatedAt?.toISOString() ?? "",
        }));

        const useRuleValidator = process.env.GUARDRAIL_VALIDATOR_MODE === "rule";
        guardrailResults = useRuleValidator
          ? validateGuardrails(supportedGroups, rules)
          : await validateGuardrailsLLM(supportedGroups, rules, auth.companyId);

        // Emit thinking for each campaign result
        for (const result of guardrailResults.results) {
          if (result.status === "pass") {
            await sendThinking({
              stage: "guardrail_checking",
              subject: result.campaignName,
              message: `All ${rules.length} guardrail rules passed`,
              status: "pass",
            });
          } else {
            for (const v of result.violations) {
              await sendThinking({
                stage: "guardrail_checking",
                subject: result.campaignName,
                message: `Violation: ${v.message}`,
                status: "warn",
              });
            }
          }
        }

        await sendEvent({
          type: "guardrail_checked",
          message: guardrailResults.hasViolations
            ? `Guardrail check: ${guardrailResults.results.filter((r) => r.status === "fail").length} campaigns have violations`
            : "All guardrail checks passed",
          data: { guardrailResults },
        });

        // Save guardrail results to upload
        await db
          .update(excelUploads)
          .set({ guardrailResults, updatedAt: new Date() })
          .where(eq(excelUploads.id, uploadId!));
      }

      // Determine final status
      if (guardrailResults?.hasViolations) {
        // Pause — awaiting user review
        await db
          .update(excelUploads)
          .set({ status: "awaiting_review", updatedAt: new Date() })
          .where(eq(excelUploads.id, uploadId!));

        await sendEvent({
          type: "awaiting_review",
          message: "Guardrail violations found — review required",
          data: {
            totalRows: rows.length,
            totalGroups: groups.length,
            groups,
            guardrailResults,
            uploadId: uploadId!,
          },
        });
      } else {
        // No violations or no rules — complete
        await db
          .update(excelUploads)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(excelUploads.id, uploadId!));

        await sendEvent({
          type: "complete",
          message: "Upload processing complete",
          data: {
            totalRows: rows.length,
            totalGroups: groups.length,
            groups,
            uploadId: uploadId!,
          },
        });
      }
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

  const overrides = await db
    .select()
    .from(guardrailOverrides)
    .where(eq(guardrailOverrides.uploadId, uploadId));

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
      lineItemConfigs: g.lineItemConfigs,
      campaignBuyType: g.campaignBuyType,
      status: g.status,
    })),
    errorMessage: upload.errorMessage,
    guardrailResults: upload.guardrailResults,
    overrides: overrides.map((o) => ({
      id: o.id,
      uploadId: o.uploadId,
      campaignGroupId: o.campaignGroupId,
      ruleId: o.ruleId,
      ruleDescription: o.ruleDescription,
      violationMessage: o.violationMessage,
      reason: o.reason,
      overriddenByUserId: o.overriddenByUserId,
      overriddenByEmail: o.overriddenByEmail,
      createdAt: o.createdAt?.toISOString() ?? "",
    })),
    createdAt: upload.createdAt?.toISOString() ?? "",
  });
});

// GET /uploads — list all uploads for the company
uploads.get("/uploads", authMiddleware, async (c) => {
  const auth = c.get("auth");

  const allUploads = await db
    .select()
    .from(excelUploads)
    .where(eq(excelUploads.companyId, auth.companyId))
    .orderBy(excelUploads.createdAt);

  return c.json({
    uploads: allUploads.map((u) => ({
      id: u.id,
      fileName: u.fileName,
      status: u.status,
      totalRows: u.totalRows,
      errorMessage: u.errorMessage,
      guardrailResults: u.guardrailResults,
      createdAt: u.createdAt?.toISOString() ?? "",
    })),
  });
});

// POST /uploads/:id/override — override a specific guardrail violation
uploads.post("/uploads/:id/override", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  const body = await c.req.json();
  const { campaignGroupId, ruleId, reason } = body;

  if (!campaignGroupId || !ruleId || !reason) {
    return c.json({ error: "campaignGroupId, ruleId, and reason are required" }, 400);
  }

  // Validate upload exists and belongs to company
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

  if (upload.status !== "awaiting_review") {
    return c.json({ error: "Upload is not awaiting review" }, 400);
  }

  // Validate the violation exists in guardrail results
  const results = upload.guardrailResults as GuardrailValidationResult | null;
  if (!results) {
    return c.json({ error: "No guardrail results found" }, 400);
  }

  const campaignResult = results.results.find((r) => r.campaignGroupId === campaignGroupId);
  if (!campaignResult) {
    return c.json({ error: "Campaign group not found in guardrail results" }, 400);
  }

  const violation = campaignResult.violations.find((v) => v.ruleId === ruleId);
  if (!violation) {
    return c.json({ error: "Violation not found for this rule and campaign" }, 400);
  }

  // Check for existing override
  const existing = await db
    .select()
    .from(guardrailOverrides)
    .where(
      and(
        eq(guardrailOverrides.uploadId, uploadId),
        eq(guardrailOverrides.campaignGroupId, campaignGroupId),
        eq(guardrailOverrides.ruleId, ruleId),
      ),
    );

  if (existing.length > 0) {
    return c.json({ error: "This violation has already been overridden" }, 400);
  }

  // Create override record
  const [override] = await db.insert(guardrailOverrides).values({
    uploadId,
    campaignGroupId,
    ruleId,
    ruleDescription: violation.ruleDescription,
    violationMessage: violation.message,
    reason,
    overriddenByUserId: auth.userId,
    overriddenByEmail: auth.email,
  }).returning();

  return c.json({
    id: override.id,
    campaignGroupId: override.campaignGroupId,
    ruleId: override.ruleId,
    reason: override.reason,
    createdAt: override.createdAt?.toISOString() ?? "",
  }, 201);
});

// POST /uploads/:id/approve — approve upload after all violations are overridden
uploads.post("/uploads/:id/approve", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const uploadId = c.req.param("id");

  // Validate upload exists and belongs to company
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

  if (upload.status !== "awaiting_review") {
    return c.json({ error: "Upload is not awaiting review" }, 400);
  }

  // Count total violations and overrides
  const results = upload.guardrailResults as GuardrailValidationResult | null;
  if (!results) {
    return c.json({ error: "No guardrail results found" }, 400);
  }

  const totalViolations = results.results.reduce(
    (sum, r) => sum + r.violations.length,
    0,
  );

  const overrides = await db
    .select()
    .from(guardrailOverrides)
    .where(eq(guardrailOverrides.uploadId, uploadId));

  if (overrides.length < totalViolations) {
    return c.json({
      error: `Not all violations have been overridden (${overrides.length}/${totalViolations})`,
    }, 400);
  }

  // Transition to completed
  await db
    .update(excelUploads)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(excelUploads.id, uploadId));

  return c.json({ success: true, status: "completed" });
});

export { uploads };
