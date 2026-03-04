import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { db, guardrails, eq, and } from "@guardrails/db";
import { generateGuardrailRules } from "../services/guardrail-generator.js";
import type {
  CreateGuardrailRequest,
  UpdateGuardrailRequest,
  GuardrailCheck,
  GuardrailGenerationEvent,
} from "@guardrails/shared";

const guardrailRoutes = new Hono<AuthEnv>();

// GET / — List all guardrails for company
guardrailRoutes.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth");

  const rows = await db
    .select()
    .from(guardrails)
    .where(eq(guardrails.companyId, auth.companyId));

  return c.json({
    guardrails: rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      description: r.description,
      check: r.check as GuardrailCheck,
      active: r.active,
      createdAt: r.createdAt?.toISOString() ?? "",
      updatedAt: r.updatedAt?.toISOString() ?? "",
    })),
  });
});

// POST / — Create a single guardrail rule
guardrailRoutes.post("/", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json<CreateGuardrailRequest>();

  if (!body.description || !body.check) {
    return c.json({ error: "description and check are required" }, 400);
  }

  const [row] = await db
    .insert(guardrails)
    .values({
      companyId: auth.companyId,
      description: body.description,
      check: body.check,
    })
    .returning();

  return c.json(
    {
      id: row.id,
      companyId: row.companyId,
      description: row.description,
      check: row.check as GuardrailCheck,
      active: row.active,
      createdAt: row.createdAt?.toISOString() ?? "",
      updatedAt: row.updatedAt?.toISOString() ?? "",
    },
    201,
  );
});

// POST /batch — Create multiple rules (post-approval)
guardrailRoutes.post("/batch", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json<{ rules: CreateGuardrailRequest[] }>();

  if (!body.rules || !Array.isArray(body.rules) || body.rules.length === 0) {
    return c.json({ error: "rules array is required and must not be empty" }, 400);
  }

  const rows = await db
    .insert(guardrails)
    .values(
      body.rules.map((rule) => ({
        companyId: auth.companyId,
        description: rule.description,
        check: rule.check,
      })),
    )
    .returning();

  return c.json(
    {
      guardrails: rows.map((r) => ({
        id: r.id,
        companyId: r.companyId,
        description: r.description,
        check: r.check as GuardrailCheck,
        active: r.active,
        createdAt: r.createdAt?.toISOString() ?? "",
        updatedAt: r.updatedAt?.toISOString() ?? "",
      })),
    },
    201,
  );
});

// PATCH /:id — Update rule
guardrailRoutes.patch("/:id", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const body = await c.req.json<UpdateGuardrailRequest>();

  // Verify rule belongs to company
  const [existing] = await db
    .select()
    .from(guardrails)
    .where(and(eq(guardrails.id, id), eq(guardrails.companyId, auth.companyId)));

  if (!existing) {
    return c.json({ error: "Guardrail not found" }, 404);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.description !== undefined) updates.description = body.description;
  if (body.check !== undefined) updates.check = body.check;
  if (body.active !== undefined) updates.active = body.active;

  const [updated] = await db
    .update(guardrails)
    .set(updates)
    .where(eq(guardrails.id, id))
    .returning();

  return c.json({
    id: updated.id,
    companyId: updated.companyId,
    description: updated.description,
    check: updated.check as GuardrailCheck,
    active: updated.active,
    createdAt: updated.createdAt?.toISOString() ?? "",
    updatedAt: updated.updatedAt?.toISOString() ?? "",
  });
});

// DELETE /:id — Delete rule
guardrailRoutes.delete("/:id", authMiddleware, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  // Verify rule belongs to company
  const [existing] = await db
    .select()
    .from(guardrails)
    .where(and(eq(guardrails.id, id), eq(guardrails.companyId, auth.companyId)));

  if (!existing) {
    return c.json({ error: "Guardrail not found" }, 404);
  }

  await db.delete(guardrails).where(eq(guardrails.id, id));

  return c.json({ success: true });
});

// POST /generate — SSE stream: LLM generates rules
guardrailRoutes.post("/generate", authMiddleware, async (c) => {
  const body = await c.req.json<{ prompt: string }>();

  if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return c.json({ error: "prompt is required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    const sendEvent = async (event: GuardrailGenerationEvent) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    };

    try {
      await sendEvent({
        type: "generating",
        message: "Analyzing your description...",
      });

      const rules = await generateGuardrailRules(body.prompt);

      for (const rule of rules) {
        await sendEvent({
          type: "rule",
          message: rule.description,
          data: { rule },
        });
      }

      await sendEvent({
        type: "complete",
        message: `Generated ${rules.length} rules`,
        data: { rules },
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to generate guardrails";
      await sendEvent({
        type: "error",
        message: errorMessage,
        data: { error: errorMessage },
      });
    }
  });
});

export { guardrailRoutes };
