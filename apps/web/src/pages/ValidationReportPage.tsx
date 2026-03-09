import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router";
import { API_URL } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import type {
  ValidationReport,
  CampaignValidationResult,
  FieldComparison,
  LineItemValidationResult,
  ValidationFlag,
} from "@guardrails/shared";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function severityLabel(s: "critical" | "warning" | "info"): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fieldLabel(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ValidationReportPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revalidating, setRevalidating] = useState(false);

  // Flag state
  const [flags, setFlags] = useState<ValidationFlag[]>([]);
  const [flagForm, setFlagForm] = useState<{
    campaignGroupId: string;
    metaCampaignId: string;
    field: string;
  } | null>(null);
  const [flagSeverity, setFlagSeverity] = useState<"critical" | "warning" | "info">("warning");
  const [flagNote, setFlagNote] = useState("");
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  // Flag panels
  const [flagPanelOpen, setFlagPanelOpen] = useState(true);
  const [resolvedPanelOpen, setResolvedPanelOpen] = useState(false);
  const [resolvingFlagId, setResolvingFlagId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  // Expand all details by default
  const [collapsedCampaigns, setCollapsedCampaigns] = useState<Set<string>>(new Set());

  const fetchReport = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/validation-report`, {
        credentials: "include",
      });
      if (res.status === 404) {
        setReport(null);
        setError("not_found");
      } else if (res.ok) {
        const data = await res.json();
        setReport(data);
        setError("");
      } else {
        setError("Failed to load validation report");
      }
    } catch {
      setError("Failed to load validation report");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchFlags = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/flags`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setFlags(data.flags ?? []);
      }
    } catch {
      // flags are secondary
    }
  }, [id]);

  useEffect(() => {
    fetchReport();
    fetchFlags();
  }, [fetchReport, fetchFlags]);

  const handleRevalidate = async () => {
    if (!id) return;
    setRevalidating(true);
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/validate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        await fetchReport();
      } else {
        const data = await res.json();
        setError(data.error || "Re-validation failed");
      }
    } catch {
      setError("Re-validation failed");
    } finally {
      setRevalidating(false);
    }
  };

  const toggleCollapsed = (campaignGroupId: string) => {
    setCollapsedCampaigns((prev) => {
      const next = new Set(prev);
      if (next.has(campaignGroupId)) next.delete(campaignGroupId);
      else next.add(campaignGroupId);
      return next;
    });
  };


  const handleCreateFlag = async () => {
    if (!id || !flagForm || !flagNote.trim()) return;
    setFlagSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/flags`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignGroupId: flagForm.campaignGroupId,
          metaCampaignId: flagForm.metaCampaignId,
          field: flagForm.field,
          severity: flagSeverity,
          note: flagNote.trim(),
        }),
      });
      if (res.ok) {
        setFlagForm(null);
        setFlagNote("");
        setFlagSeverity("warning");
        await fetchFlags();
      }
    } catch {
      // ignore
    } finally {
      setFlagSubmitting(false);
    }
  };

  const handleResolveFlag = async (flagId: string) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/flags/${flagId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNote: resolutionNote.trim() || undefined }),
      });
      if (res.ok) {
        setResolvingFlagId(null);
        setResolutionNote("");
        await fetchFlags();
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteFlag = async (flagId: string) => {
    if (!id) return;
    if (!window.confirm("Delete this flag? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/flags/${flagId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) await fetchFlags();
    } catch {
      // ignore
    }
  };

  const unresolvedFlags = flags.filter((f) => !f.resolved);
  const resolvedFlags = flags.filter((f) => f.resolved);

  // Loading
  if (loading) {
    return (
      <div className="rpt-page">
        <div className="rpt-topbar">
          <Link to={`/jobs/${id}`} className="btn btn-sm">&larr; Back to Job</Link>
          <h1 className="rpt-title">Validation Report</h1>
        </div>
        <div className="rpt-loading">
          <div className="job-processing-spinner" />
          <p>Loading validation report...</p>
        </div>
      </div>
    );
  }

  // Not found
  if (error === "not_found") {
    return (
      <div className="rpt-page">
        <div className="rpt-topbar">
          <Link to={`/jobs/${id}`} className="btn btn-sm">&larr; Back to Job</Link>
          <h1 className="rpt-title">Validation Report</h1>
        </div>
        <div className="rpt-empty">
          <p>No validation report yet.</p>
          <p>Go to the <Link to={`/jobs/${id}`}>job detail page</Link> to run one.</p>
        </div>
      </div>
    );
  }

  // Error
  if (error && !report) {
    return (
      <div className="rpt-page">
        <div className="rpt-topbar">
          <Link to={`/jobs/${id}`} className="btn btn-sm">&larr; Back to Job</Link>
          <h1 className="rpt-title">Validation Report</h1>
        </div>
        <div className="upload-error">
          <span className="upload-error-icon">&#9888;</span>
          <div>
            <p className="upload-error-text">{error}</p>
            <button className="btn" onClick={fetchReport}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="rpt-page">
      {/* Top bar */}
      <div className="rpt-topbar">
        <Link to={`/jobs/${id}`} className="btn btn-sm">&larr; Back to Job</Link>
        <h1 className="rpt-title">Validation Report</h1>
        <div className="rpt-stats">
          <span className="badge badge-success rpt-badge">{report.totalPass} pass</span>
          <span className="badge badge-error rpt-badge">{report.totalFail} fail</span>
          <span className="badge badge-warning rpt-badge">{report.totalWarning} warning</span>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleRevalidate}
          disabled={revalidating}
        >
          {revalidating ? "Re-validating..." : "Re-validate"}
        </button>
      </div>

      {/* Re-validation overlay */}
      {revalidating && (
        <div className="rpt-revalidating-overlay">
          <div className="rpt-revalidating-content">
            <div className="job-processing-spinner" />
            <p>Fetching latest campaigns from Meta and re-validating...</p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="upload-error" style={{ marginBottom: "var(--space-4)" }}>
          <span className="upload-error-icon">&#9888;</span>
          <p className="upload-error-text">{error}</p>
        </div>
      )}

      {/* Flagged for Review Panel */}
      {unresolvedFlags.length > 0 && (
        <FlagPanel
          title={`${unresolvedFlags.length} item${unresolvedFlags.length !== 1 ? "s" : ""} flagged for review`}
          flags={unresolvedFlags}
          open={flagPanelOpen}
          onToggle={() => setFlagPanelOpen((v) => !v)}
          resolved={false}
          currentUserId={user?.id ?? null}
          resolvingFlagId={resolvingFlagId}
          resolutionNote={resolutionNote}
          onSetResolvingFlagId={(fid) => { setResolvingFlagId(fid); setResolutionNote(""); }}
          onSetResolutionNote={setResolutionNote}
          onResolve={handleResolveFlag}
          onDelete={handleDeleteFlag}
        />
      )}

      {/* Resolved Flags Panel */}
      {resolvedFlags.length > 0 && (
        <FlagPanel
          title={`Resolved (${resolvedFlags.length})`}
          flags={resolvedFlags}
          open={resolvedPanelOpen}
          onToggle={() => setResolvedPanelOpen((v) => !v)}
          resolved={true}
          currentUserId={user?.id ?? null}
          resolvingFlagId={null}
          resolutionNote=""
          onSetResolvingFlagId={() => {}}
          onSetResolutionNote={() => {}}
          onResolve={() => {}}
          onDelete={() => {}}
        />
      )}

      {/* Campaign Cards */}
      <div className="rpt-cards">
        {report.results.map((result) => {
          const isCollapsed = collapsedCampaigns.has(result.campaignGroupId);
          const failed = result.fieldComparisons.filter((c) => c.status === "fail");
          const warned = result.fieldComparisons.filter((c) => c.status === "warning");
          const campaignFlags = flags.filter(
            (f) => f.campaignGroupId === result.campaignGroupId && f.metaCampaignId === result.metaCampaignId,
          );
          const lineItemResults = result.lineItemResults ?? [];
          const lineItemFailed = lineItemResults.some((lr) => lr.fieldComparisons.some((c) => c.status === "fail"));
          const lineItemWarned = lineItemResults.some((lr) => lr.fieldComparisons.some((c) => c.status === "warning"));

          // Derive status from actual field results (don't trust stored overallStatus)
          const derivedStatus = (failed.length > 0 || lineItemFailed) ? "fail" : (warned.length > 0 || lineItemWarned) ? "warning" : "pass";

          return (
            <div
              key={result.campaignGroupId}
              className={`rpt-card rpt-card-${derivedStatus}`}
            >
              {/* Card header */}
              <div
                className="rpt-card-header"
                onClick={() => toggleCollapsed(result.campaignGroupId)}
              >
                <div className="rpt-card-status-indicator">
                  <span className={`rpt-card-dot rpt-card-dot-${derivedStatus}`} />
                </div>
                <div className="rpt-card-names">
                  <span className="rpt-card-plan-name">{result.campaignGroupName}</span>
                  <span className="rpt-card-arrow">&rarr;</span>
                  <span className="rpt-card-meta-name">{result.metaCampaignName}</span>
                </div>
                <div className="rpt-card-summary">
                  {failed.length > 0 && (
                    <span className="rpt-card-count rpt-card-count-fail">
                      {failed.length} failed
                    </span>
                  )}
                  {warned.length > 0 && (
                    <span className="rpt-card-count rpt-card-count-warn">
                      {warned.length} warning{warned.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {failed.length === 0 && warned.length === 0 && (
                    <span className="rpt-card-count rpt-card-count-pass">All checks passed</span>
                  )}
                </div>
                <span className="rpt-card-chevron">{isCollapsed ? "\u25BC" : "\u25B2"}</span>
              </div>

              {/* Card body — full comparison table */}
              {!isCollapsed && (
                <div className="rpt-card-body">
                  <table className="rpt-compare-table">
                    <thead>
                      <tr>
                        <th className="rpt-compare-th-field">Field</th>
                        <th className="rpt-compare-th-plan">Plan</th>
                        <th className="rpt-compare-th-meta">Meta</th>
                        <th className="rpt-compare-th-status">Status</th>
                        <th className="rpt-compare-th-flag"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.fieldComparisons.map((fc) => {
                        const existingFlag = campaignFlags.find((f) => f.field === fc.field && !f.resolved);
                        const isFormOpen =
                          flagForm?.campaignGroupId === result.campaignGroupId &&
                          flagForm?.metaCampaignId === result.metaCampaignId &&
                          flagForm?.field === fc.field;

                        return (
                          <ComparisonRow
                            key={fc.field}
                            fc={fc}
                            result={result}
                            existingFlag={existingFlag ?? null}
                            isFormOpen={isFormOpen}
                            flagSeverity={flagSeverity}
                            flagNote={flagNote}
                            flagSubmitting={flagSubmitting}
                            currentUserId={user?.id ?? null}
                            onOpenFlagForm={setFlagForm}
                            onCloseFlagForm={() => setFlagForm(null)}
                            onSetFlagSeverity={setFlagSeverity}
                            onSetFlagNote={setFlagNote}
                            onSubmitFlag={handleCreateFlag}
                            onDeleteFlag={handleDeleteFlag}
                          />
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Line item results (1:N strategy) */}
                  {lineItemResults.length > 0 && (
                    <div className="rpt-line-items">
                      {lineItemResults.map((lr) => {
                        const liFailed = lr.fieldComparisons.filter((c) => c.status === "fail");
                        const liWarned = lr.fieldComparisons.filter((c) => c.status === "warning");
                        const liStatus = liFailed.length > 0 ? "fail" : liWarned.length > 0 ? "warning" : "pass";

                        return (
                          <div key={lr.lineItemIndex} className={`rpt-line-item rpt-card-${liStatus}`}>
                            <div className="rpt-line-item-header">
                              <span className={`rpt-card-dot rpt-card-dot-${liStatus}`} />
                              <span className="rpt-line-item-plan">{lr.lineItemName}</span>
                              <span className="rpt-card-arrow">&rarr;</span>
                              <span className="rpt-line-item-meta">{lr.metaAdSetName}</span>
                              <span className="rpt-card-summary">
                                {liFailed.length > 0 && (
                                  <span className="rpt-card-count rpt-card-count-fail">{liFailed.length} failed</span>
                                )}
                                {liWarned.length > 0 && (
                                  <span className="rpt-card-count rpt-card-count-warn">{liWarned.length} warning{liWarned.length !== 1 ? "s" : ""}</span>
                                )}
                                {liFailed.length === 0 && liWarned.length === 0 && (
                                  <span className="rpt-card-count rpt-card-count-pass">All checks passed</span>
                                )}
                              </span>
                            </div>
                            <table className="rpt-compare-table">
                              <thead>
                                <tr>
                                  <th className="rpt-compare-th-field">Field</th>
                                  <th className="rpt-compare-th-plan">Plan</th>
                                  <th className="rpt-compare-th-meta">Meta</th>
                                  <th className="rpt-compare-th-status">Status</th>
                                  <th className="rpt-compare-th-flag"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {lr.fieldComparisons.map((fc) => {
                                  const existingFlag = campaignFlags.find((f) => f.field === `${lr.lineItemIndex}:${fc.field}` && !f.resolved);
                                  const isFormOpen =
                                    flagForm?.campaignGroupId === result.campaignGroupId &&
                                    flagForm?.metaCampaignId === result.metaCampaignId &&
                                    flagForm?.field === `${lr.lineItemIndex}:${fc.field}`;

                                  return (
                                    <ComparisonRow
                                      key={fc.field}
                                      fc={fc}
                                      result={result}
                                      existingFlag={existingFlag ?? null}
                                      isFormOpen={isFormOpen}
                                      flagSeverity={flagSeverity}
                                      flagNote={flagNote}
                                      flagSubmitting={flagSubmitting}
                                      currentUserId={user?.id ?? null}
                                      onOpenFlagForm={(_form) =>
                                        setFlagForm({
                                          campaignGroupId: result.campaignGroupId,
                                          metaCampaignId: result.metaCampaignId,
                                          field: `${lr.lineItemIndex}:${fc.field}`,
                                        })
                                      }
                                      onCloseFlagForm={() => setFlagForm(null)}
                                      onSetFlagSeverity={setFlagSeverity}
                                      onSetFlagNote={setFlagNote}
                                      onSubmitFlag={handleCreateFlag}
                                      onDeleteFlag={handleDeleteFlag}
                                    />
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Match confidence */}
                  <div className="rpt-card-footer">
                    <span className="rpt-card-confidence">
                      {result.matchConfidence > 0
                        ? `Match confidence: ${Math.round(result.matchConfidence * 100)}%`
                        : "Manually matched"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unmatched Plan Campaigns */}
      {report.unmatchedPlanCampaigns.length > 0 && (
        <div className="rpt-section">
          <h2 className="rpt-section-title">Not Found in Meta</h2>
          <div className="rpt-unmatched-list">
            {report.unmatchedPlanCampaigns.map((c) => (
              <div key={c.id} className="rpt-unmatched-card rpt-unmatched-warning">
                <span className="rpt-unmatched-icon">&#9888;</span>
                <div>
                  <div className="rpt-unmatched-name">{c.name}</div>
                  <div className="rpt-unmatched-detail">Plan campaign with no matching Meta campaign</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Comparison Row ──
function ComparisonRow({
  fc,
  result,
  existingFlag,
  isFormOpen,
  flagSeverity,
  flagNote,
  flagSubmitting,
  currentUserId,
  onOpenFlagForm,
  onCloseFlagForm,
  onSetFlagSeverity,
  onSetFlagNote,
  onSubmitFlag,
  onDeleteFlag,
}: {
  fc: FieldComparison;
  result: CampaignValidationResult;
  existingFlag: ValidationFlag | null;
  isFormOpen: boolean;
  flagSeverity: "critical" | "warning" | "info";
  flagNote: string;
  flagSubmitting: boolean;
  currentUserId: string | null;
  onOpenFlagForm: (form: { campaignGroupId: string; metaCampaignId: string; field: string }) => void;
  onCloseFlagForm: () => void;
  onSetFlagSeverity: (s: "critical" | "warning" | "info") => void;
  onSetFlagNote: (n: string) => void;
  onSubmitFlag: () => void;
  onDeleteFlag: (flagId: string) => void;
}) {
  const statusIcon = fc.status === "pass" ? "\u2713" : fc.status === "fail" ? "\u2717" : fc.status === "warning" ? "\u26A0" : "\u2014";
  const statusLabel = fc.status === "pass" ? "Match" : fc.status === "fail" ? "Mismatch" : fc.status === "warning" ? "Warning" : "No plan data";

  return (
    <>
      <tr className={`rpt-compare-row rpt-compare-row-${fc.status}`}>
        <td className="rpt-compare-field">{fieldLabel(fc.field)}</td>
        <td className={`rpt-compare-plan ${fc.expected === "Not in plan" ? "rpt-compare-empty" : ""}`}>
          {fc.expected || "\u2014"}
        </td>
        <td className={`rpt-compare-meta ${fc.actual === "Not set" ? "rpt-compare-empty" : ""}`}>
          {fc.actual || "\u2014"}
        </td>
        <td className="rpt-compare-status">
          <span className={`rpt-compare-badge rpt-compare-badge-${fc.status}`}>
            {statusIcon} {statusLabel}
          </span>
        </td>
        <td className="rpt-compare-flag-cell">
          {existingFlag ? (
            <span
              className={`rpt-flag-inline-badge rpt-flag-severity-${existingFlag.severity}`}
              title={existingFlag.note}
            >
              &#9873;
              {(currentUserId === existingFlag.flaggedByUserId || !currentUserId) && (
                <button
                  className="rpt-flag-inline-delete"
                  onClick={() => onDeleteFlag(existingFlag.id)}
                  title="Delete flag"
                >
                  &#10005;
                </button>
              )}
            </span>
          ) : fc.status !== "skipped" ? (
            <button
              className="rpt-flag-icon-btn"
              onClick={() =>
                onOpenFlagForm({
                  campaignGroupId: result.campaignGroupId,
                  metaCampaignId: result.metaCampaignId,
                  field: fc.field,
                })
              }
              title="Flag this field"
            >
              &#9873;
            </button>
          ) : null}
        </td>
      </tr>
      {fc.status !== "pass" && fc.status !== "skipped" && fc.message && (
        <tr className="rpt-compare-message-row">
          <td colSpan={5} className="rpt-compare-message">{fc.message}</td>
        </tr>
      )}
      {isFormOpen && (
        <tr className="rpt-flag-form-row">
          <td colSpan={5}>
            <div className="rpt-flag-inline-form">
              <div className="rpt-flag-form-controls">
                <select
                  className="rpt-flag-select"
                  value={flagSeverity}
                  onChange={(e) => onSetFlagSeverity(e.target.value as "critical" | "warning" | "info")}
                >
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
                <textarea
                  className="rpt-flag-textarea"
                  placeholder="Describe the issue (required)"
                  value={flagNote}
                  onChange={(e) => onSetFlagNote(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="rpt-flag-form-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={onSubmitFlag}
                  disabled={flagSubmitting || !flagNote.trim()}
                >
                  {flagSubmitting ? "Submitting..." : "Submit Flag"}
                </button>
                <button className="btn btn-sm" onClick={onCloseFlagForm}>Cancel</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Flag Panel ──
function FlagPanel({
  title,
  flags,
  open,
  onToggle,
  resolved,
  currentUserId,
  resolvingFlagId,
  resolutionNote,
  onSetResolvingFlagId,
  onSetResolutionNote,
  onResolve,
  onDelete,
}: {
  title: string;
  flags: ValidationFlag[];
  open: boolean;
  onToggle: () => void;
  resolved: boolean;
  currentUserId: string | null;
  resolvingFlagId: string | null;
  resolutionNote: string;
  onSetResolvingFlagId: (id: string | null) => void;
  onSetResolutionNote: (note: string) => void;
  onResolve: (flagId: string) => void;
  onDelete: (flagId: string) => void;
}) {
  return (
    <div className={`rpt-flag-panel ${resolved ? "rpt-flag-panel-resolved" : ""}`}>
      <button className="rpt-flag-panel-header" onClick={onToggle}>
        <span className={`rpt-flag-panel-title ${resolved ? "rpt-flag-panel-title-resolved" : ""}`}>
          {title}
        </span>
        <span className="rpt-flag-panel-toggle">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div className="rpt-flag-panel-body">
          {flags.map((flag) => (
            <div key={flag.id} className={`rpt-flag-item ${resolved ? "rpt-flag-item-resolved" : ""}`}>
              <div className="rpt-flag-item-top">
                <span className={`rpt-flag-severity rpt-flag-severity-${flag.severity}`}>
                  {severityLabel(flag.severity)}
                </span>
                <span className="rpt-flag-field">{flag.field}</span>
                <span className="rpt-flag-note-text">{flag.note}</span>
                <span className="rpt-flag-meta">
                  {resolved
                    ? <>Resolved by {flag.resolvedByEmail}{flag.resolvedAt ? <> &middot; {relativeTime(flag.resolvedAt)}</> : null}{flag.resolutionNote && ` \u2014 ${flag.resolutionNote}`}</>
                    : <>{flag.flaggedByEmail} &middot; {relativeTime(flag.flaggedAt)}</>}
                </span>
                {!resolved && (
                  <div className="rpt-flag-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => onSetResolvingFlagId(resolvingFlagId === flag.id ? null : flag.id)}
                    >
                      Resolve
                    </button>
                    {(currentUserId === flag.flaggedByUserId || !currentUserId) && (
                      <button
                        className="btn btn-sm rpt-flag-delete-btn"
                        onClick={() => onDelete(flag.id)}
                        title="Delete flag"
                      >
                        &#10005;
                      </button>
                    )}
                  </div>
                )}
              </div>
              {!resolved && resolvingFlagId === flag.id && (
                <div className="rpt-flag-resolve-form">
                  <textarea
                    className="rpt-flag-textarea"
                    placeholder="Resolution note (optional)"
                    value={resolutionNote}
                    onChange={(e) => onSetResolutionNote(e.target.value)}
                    rows={2}
                  />
                  <div className="rpt-flag-resolve-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => onResolve(flag.id)}>
                      Confirm Resolve
                    </button>
                    <button className="btn btn-sm" onClick={() => onSetResolvingFlagId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
