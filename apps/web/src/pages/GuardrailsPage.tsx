import { useState, useEffect, useCallback } from "react";
import { API_URL } from "../lib/api";
import type {
  GuardrailRule,
  GeneratedRule,
  GuardrailGenerationEvent,
} from "@guardrails/shared";

type View = "list" | "generate" | "review";

export function GuardrailsPage() {
  const [view, setView] = useState<View>("list");
  const [guardrails, setGuardrails] = useState<GuardrailRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Generate view state
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedRules, setGeneratedRules] = useState<GeneratedRule[]>([]);
  const [generateStatus, setGenerateStatus] = useState("");

  // Review view state
  const [reviewRules, setReviewRules] = useState<GeneratedRule[]>([]);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchGuardrails = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/guardrails`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setGuardrails(data.guardrails);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGuardrails();
  }, [fetchGuardrails]);

  // Toggle active/inactive
  const handleToggleActive = async (rule: GuardrailRule) => {
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/guardrails/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ active: !rule.active }),
      });
      if (res.ok) {
        setGuardrails((prev) =>
          prev.map((r) =>
            r.id === rule.id ? { ...r, active: !r.active } : r,
          ),
        );
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to update rule");
      }
    } catch {
      setError("Something went wrong");
    }
  };

  // Delete
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/guardrails/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setGuardrails((prev) => prev.filter((r) => r.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete rule");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  // Generate rules via SSE
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGeneratedRules([]);
    setGenerateStatus("Analyzing your description...");
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/guardrails/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!response.ok) {
        const err = await response
          .json()
          .catch(() => ({ error: "Generation failed" }));
        setError(err.error || "Generation failed");
        setGenerating(false);
        return;
      }

      if (!response.body) {
        setError("No response stream");
        setGenerating(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const rules: GeneratedRule[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const event: GuardrailGenerationEvent = JSON.parse(dataStr);

              switch (event.type) {
                case "generating":
                  setGenerateStatus(event.message);
                  break;
                case "rule":
                  if (event.data?.rule) {
                    rules.push(event.data.rule);
                    setGeneratedRules([...rules]);
                    setGenerateStatus(event.message);
                  }
                  break;
                case "complete":
                  setGenerateStatus("");
                  setGenerating(false);
                  // Auto-switch to review view
                  setReviewRules([...rules]);
                  setView("review");
                  break;
                case "error":
                  setError(
                    event.data?.error ?? event.message ?? "Generation failed",
                  );
                  setGenerating(false);
                  break;
              }
            } catch {
              // skip malformed event
            }
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Generation failed",
      );
      setGenerating(false);
    }
  };

  // Save reviewed rules
  const handleSaveAll = async () => {
    if (reviewRules.length === 0) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/guardrails/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          rules: reviewRules.map((r) => ({
            description: r.description,
            check: r.check,
          })),
        }),
      });
      if (res.ok) {
        // Refresh list and go back
        await fetchGuardrails();
        setView("list");
        setReviewRules([]);
        setGeneratedRules([]);
        setPrompt("");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save rules");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveReviewRule = (index: number) => {
    setReviewRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateReviewDescription = (index: number, description: string) => {
    setReviewRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, description } : r)),
    );
  };

  const handleDiscard = () => {
    if (reviewRules.length > 0 && !confirm("Discard generated rules?")) return;
    setReviewRules([]);
    setGeneratedRules([]);
    setView("generate");
  };

  const getOperatorLabel = (op: string) => {
    switch (op) {
      case "is_set": return "is set";
      case "not_empty": return "not empty";
      case "all_within": return "all within";
      case "gte": return "\u2265";
      case "lte": return "\u2264";
      case "equals": return "equals";
      default: return op;
    }
  };

  const getFieldLabel = (field: string) => {
    return field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatValue = (value: unknown) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  // ── List View ──
  if (view === "list") {
    return (
      <div>
        <div className="page-header">
          <h1>Guardrails</h1>
          {guardrails.length > 0 && (
            <button
              className="btn-primary"
              onClick={() => setView("generate")}
            >
              Generate New Rules
            </button>
          )}
        </div>

        {error && (
          <div className="meta-error-banner mb-6">
            <span>{error}</span>
            <button
              className="btn-ghost"
              onClick={() => setError("")}
              style={{ marginLeft: "auto", padding: "0 var(--space-2)" }}
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-secondary">Loading guardrails...</p>
        ) : guardrails.length === 0 ? (
          <div className="meta-empty-state">
            <div className="meta-empty-icon">&#9888;</div>
            <h2>No Guardrails Set Up</h2>
            <p className="text-secondary">
              Describe common mistakes in your media campaigns, and we'll
              generate validation rules to catch them automatically.
            </p>
            <button
              className="btn-primary mt-6"
              onClick={() => setView("generate")}
            >
              Generate Guardrails
            </button>
          </div>
        ) : (
          <div className="guardrail-list">
            {guardrails.map((rule) => (
              <div
                key={rule.id}
                className={`guardrail-card${!rule.active ? " guardrail-card-inactive" : ""}`}
              >
                <div className="guardrail-card-top">
                  <div className="guardrail-card-info">
                    <p className="guardrail-card-description">
                      {rule.description}
                    </p>
                    {rule.check?.field && (
                      <div className="guardrail-card-badges">
                        <span className="badge">{getFieldLabel(rule.check.field)}</span>
                        <span className="badge">{getOperatorLabel(rule.check.operator)}</span>
                        {rule.check.value !== null && rule.check.value !== undefined && (
                          <span className="badge">{formatValue(rule.check.value)}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="guardrail-card-actions">
                    <label className="guardrail-toggle" title={rule.active ? "Active" : "Inactive"}>
                      <input
                        type="checkbox"
                        checked={rule.active}
                        onChange={() => handleToggleActive(rule)}
                      />
                      <span className="guardrail-toggle-slider" />
                    </label>
                    {confirmDeleteId === rule.id ? (
                      <div className="meta-confirm-actions">
                        <button
                          className="btn-danger-sm"
                          onClick={() => handleDelete(rule.id)}
                          disabled={deletingId === rule.id}
                        >
                          {deletingId === rule.id ? "Deleting..." : "Confirm"}
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-secondary"
                        onClick={() => setConfirmDeleteId(rule.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Generate View ──
  if (view === "generate") {
    return (
      <div>
        <div className="page-header">
          <h1>Generate Guardrails</h1>
        </div>

        {error && (
          <div className="meta-error-banner mb-6">
            <span>{error}</span>
            <button
              className="btn-ghost"
              onClick={() => setError("")}
              style={{ marginLeft: "auto", padding: "0 var(--space-2)" }}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="guardrail-generate-form">
          <label className="upload-label" htmlFor="guardrail-prompt">
            Describe common mistakes in your media campaigns
          </label>
          <textarea
            id="guardrail-prompt"
            className="guardrail-textarea"
            rows={5}
            placeholder="e.g., Make sure all campaigns target India only, have a budget of at least 10000, and always include frequency capping..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
          />
          <div className="form-actions mt-4">
            <button
              className="btn-primary"
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
            >
              {generating ? "Generating..." : "Generate Rules"}
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setView("list");
                setPrompt("");
                setGeneratedRules([]);
                setGenerateStatus("");
              }}
              disabled={generating}
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Progressive rule display during generation */}
        {generating && (
          <div className="guardrail-generating">
            <p className="text-secondary">{generateStatus}</p>
            {generatedRules.length > 0 && (
              <div className="guardrail-list mt-4">
                {generatedRules.map((rule, i) => (
                  <div key={i} className="guardrail-card">
                    <div className="guardrail-card-top">
                      <div className="guardrail-card-info">
                        <p className="guardrail-card-description">
                          {rule.description}
                        </p>
                        {rule.check?.field && (
                          <div className="guardrail-card-badges">
                            <span className="badge">{getFieldLabel(rule.check.field)}</span>
                            <span className="badge">{getOperatorLabel(rule.check.operator)}</span>
                            {rule.check.value !== null && rule.check.value !== undefined && (
                              <span className="badge">{formatValue(rule.check.value)}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Review View ──
  return (
    <div>
      <div className="page-header">
        <h1>Review Generated Rules</h1>
      </div>

      {error && (
        <div className="meta-error-banner mb-6">
          <span>{error}</span>
          <button
            className="btn-ghost"
            onClick={() => setError("")}
            style={{ marginLeft: "auto", padding: "0 var(--space-2)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {reviewRules.length === 0 ? (
        <div className="meta-empty-state">
          <p className="text-secondary">All rules have been removed.</p>
          <button
            className="btn-secondary mt-4"
            onClick={() => setView("generate")}
          >
            Back to Generate
          </button>
        </div>
      ) : (
        <>
          <p className="text-secondary mb-4">
            Edit descriptions or remove rules before saving. Field, operator,
            and value are read-only in this version.
          </p>
          <div className="guardrail-list">
            {reviewRules.map((rule, i) => (
              <div key={i} className="guardrail-card">
                <div className="guardrail-card-top">
                  <div className="guardrail-card-info" style={{ flex: 1 }}>
                    <input
                      type="text"
                      className="guardrail-edit-input"
                      value={rule.description}
                      onChange={(e) =>
                        handleUpdateReviewDescription(i, e.target.value)
                      }
                    />
                    {rule.check?.field && (
                      <div className="guardrail-card-badges">
                        <span className="badge">{getFieldLabel(rule.check.field)}</span>
                        <span className="badge">{getOperatorLabel(rule.check.operator)}</span>
                        {rule.check.value !== null && rule.check.value !== undefined && (
                          <span className="badge">{formatValue(rule.check.value)}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn-ghost guardrail-remove-btn"
                    onClick={() => handleRemoveReviewRule(i)}
                    title="Remove rule"
                  >
                    &#10005;
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="form-actions mt-6">
            <button
              className="btn-primary"
              onClick={handleSaveAll}
              disabled={saving || reviewRules.length === 0}
            >
              {saving ? "Saving..." : `Save All (${reviewRules.length})`}
            </button>
            <button
              className="btn-secondary"
              onClick={handleDiscard}
              disabled={saving}
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
