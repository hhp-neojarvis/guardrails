import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { API_URL } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import type {
  ValidationReport,
  CampaignValidationResult,
  FieldComparison,
  GuardrailCheckResult,
  ValidationFlag,
} from "@guardrails/shared";

function statusIcon(status: string): string {
  switch (status) {
    case "pass":
      return "\u2713"; // checkmark
    case "fail":
      return "\u2717"; // X
    case "warning":
      return "\u26A0"; // triangle
    case "skipped":
      return "\u2014"; // dash
    default:
      return "\u2014";
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "pass":
      return "rpt-status-pass";
    case "fail":
      return "rpt-status-fail";
    case "warning":
      return "rpt-status-warning";
    default:
      return "rpt-status-skipped";
  }
}

function getFieldStatus(
  comparisons: FieldComparison[],
  fieldPrefix: string,
): "pass" | "fail" | "warning" | "skipped" {
  const matching = comparisons.filter((c) =>
    c.field.toLowerCase().startsWith(fieldPrefix.toLowerCase()),
  );
  if (matching.length === 0) return "skipped";
  if (matching.some((c) => c.status === "fail")) return "fail";
  if (matching.some((c) => c.status === "warning")) return "warning";
  return "pass";
}

function getGuardrailsStatus(
  results: GuardrailCheckResult[],
): "pass" | "fail" | "skipped" {
  if (results.length === 0) return "skipped";
  if (results.some((r) => r.status === "fail")) return "fail";
  return "pass";
}

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

const SUMMARY_FIELDS = [
  { key: "budget", label: "Budget" },
  { key: "date", label: "Dates" },
  { key: "geo", label: "Geo" },
  { key: "demographic", label: "Demographics" },
  { key: "frequency", label: "Frequency" },
  { key: "placement", label: "Placements" },
  { key: "objective", label: "Objective" },
];

export function ValidationReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(
    new Set(),
  );
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

  // Flagged-for-review panel
  const [flagPanelOpen, setFlagPanelOpen] = useState(true);
  const [resolvedPanelOpen, setResolvedPanelOpen] = useState(false);
  const [resolvingFlagId, setResolvingFlagId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

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
      // silently fail — flags are secondary
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

  const toggleExpanded = (campaignGroupId: string) => {
    setExpandedCampaigns((prev) => {
      const next = new Set(prev);
      if (next.has(campaignGroupId)) {
        next.delete(campaignGroupId);
      } else {
        next.add(campaignGroupId);
      }
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
      if (res.ok) {
        await fetchFlags();
      }
    } catch {
      // ignore
    }
  };

  const unresolvedFlags = flags.filter((f) => !f.resolved);
  const resolvedFlags = flags.filter((f) => f.resolved);

  // Loading state
  if (loading) {
    return (
      <div className="rpt-page">
        <div className="rpt-topbar">
          <Link to={`/jobs/${id}`} className="btn btn-sm">
            &#8592; Back to Job
          </Link>
          <h1 className="rpt-title">Validation Report</h1>
        </div>
        <div className="rpt-loading">
          <div className="job-processing-spinner" />
          <p>Loading validation report...</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (error === "not_found") {
    return (
      <div className="rpt-page">
        <div className="rpt-topbar">
          <Link to={`/jobs/${id}`} className="btn btn-sm">
            &#8592; Back to Job
          </Link>
          <h1 className="rpt-title">Validation Report</h1>
        </div>
        <div className="rpt-empty">
          <p>No validation report yet.</p>
          <p>
            Go to the{" "}
            <Link to={`/jobs/${id}`}>job detail page</Link> to run one.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !report) {
    return (
      <div className="rpt-page">
        <div className="rpt-topbar">
          <Link to={`/jobs/${id}`} className="btn btn-sm">
            &#8592; Back to Job
          </Link>
          <h1 className="rpt-title">Validation Report</h1>
        </div>
        <div className="upload-error">
          <span className="upload-error-icon">&#9888;</span>
          <div>
            <p className="upload-error-text">{error}</p>
            <button className="btn" onClick={fetchReport}>
              Retry
            </button>
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
        <Link to={`/jobs/${id}`} className="btn btn-sm">
          &#8592; Back to Job
        </Link>
        <h1 className="rpt-title">Validation Report</h1>
        <div className="rpt-stats">
          <span className="badge badge-success rpt-badge">
            {report.totalPass} pass
          </span>
          <span className="badge badge-error rpt-badge">
            {report.totalFail} fail
          </span>
          <span className="badge badge-warning rpt-badge">
            {report.totalWarning} warning
          </span>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleRevalidate}
          disabled={revalidating}
        >
          {revalidating ? "Validating..." : "Re-validate"}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="upload-error" style={{ marginBottom: "var(--space-4)" }}>
          <span className="upload-error-icon">&#9888;</span>
          <p className="upload-error-text">{error}</p>
        </div>
      )}

      {/* Flagged for Review Panel */}
      {unresolvedFlags.length > 0 && (
        <div className="rpt-flag-panel">
          <button
            className="rpt-flag-panel-header"
            onClick={() => setFlagPanelOpen((v) => !v)}
          >
            <span className="rpt-flag-panel-title">
              {unresolvedFlags.length} item{unresolvedFlags.length !== 1 ? "s" : ""} flagged for review
            </span>
            <span className="rpt-flag-panel-toggle">
              {flagPanelOpen ? "\u25B2" : "\u25BC"}
            </span>
          </button>
          {flagPanelOpen && (
            <div className="rpt-flag-panel-body">
              {unresolvedFlags.map((flag) => (
                <div key={flag.id} className="rpt-flag-item">
                  <div className="rpt-flag-item-top">
                    <span className={`rpt-flag-severity rpt-flag-severity-${flag.severity}`}>
                      {severityLabel(flag.severity)}
                    </span>
                    <span className="rpt-flag-field">{flag.field}</span>
                    <span className="rpt-flag-note-text">{flag.note}</span>
                    <span className="rpt-flag-meta">
                      {flag.flaggedByEmail} &middot; {relativeTime(flag.flaggedAt)}
                    </span>
                    <div className="rpt-flag-actions">
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setResolvingFlagId(resolvingFlagId === flag.id ? null : flag.id);
                          setResolutionNote("");
                        }}
                      >
                        Resolve
                      </button>
                      {(user?.id === flag.flaggedByUserId || !user) && (
                        <button
                          className="btn btn-sm rpt-flag-delete-btn"
                          onClick={() => handleDeleteFlag(flag.id)}
                          title="Delete flag"
                        >
                          &#10005;
                        </button>
                      )}
                    </div>
                  </div>
                  {resolvingFlagId === flag.id && (
                    <div className="rpt-flag-resolve-form">
                      <textarea
                        className="rpt-flag-textarea"
                        placeholder="Resolution note (optional)"
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        rows={2}
                      />
                      <div className="rpt-flag-resolve-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleResolveFlag(flag.id)}
                        >
                          Confirm Resolve
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            setResolvingFlagId(null);
                            setResolutionNote("");
                          }}
                        >
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
      )}

      {/* Resolved Flags Panel */}
      {resolvedFlags.length > 0 && (
        <div className="rpt-flag-panel rpt-flag-panel-resolved">
          <button
            className="rpt-flag-panel-header"
            onClick={() => setResolvedPanelOpen((v) => !v)}
          >
            <span className="rpt-flag-panel-title rpt-flag-panel-title-resolved">
              Resolved ({resolvedFlags.length})
            </span>
            <span className="rpt-flag-panel-toggle">
              {resolvedPanelOpen ? "\u25B2" : "\u25BC"}
            </span>
          </button>
          {resolvedPanelOpen && (
            <div className="rpt-flag-panel-body">
              {resolvedFlags.map((flag) => (
                <div key={flag.id} className="rpt-flag-item rpt-flag-item-resolved">
                  <div className="rpt-flag-item-top">
                    <span className={`rpt-flag-severity rpt-flag-severity-${flag.severity}`}>
                      {severityLabel(flag.severity)}
                    </span>
                    <span className="rpt-flag-field">{flag.field}</span>
                    <span className="rpt-flag-note-text">{flag.note}</span>
                    <span className="rpt-flag-meta">
                      Resolved by {flag.resolvedByEmail}{flag.resolvedAt ? <> &middot; {relativeTime(flag.resolvedAt)}</> : null}
                      {flag.resolutionNote && ` — ${flag.resolutionNote}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Summary Table */}
      <div className="rpt-section">
        <div className="rpt-table-wrapper">
          <table className="rpt-summary-table">
            <thead>
              <tr>
                <th>Campaign</th>
                {SUMMARY_FIELDS.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
                <th>Guardrails</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {report.results.map((result) => {
                const isExpanded = expandedCampaigns.has(
                  result.campaignGroupId,
                );
                return (
                  <SummaryRow
                    key={result.campaignGroupId}
                    result={result}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpanded(result.campaignGroupId)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expanded Detail Cards */}
      {report.results
        .filter((r) => expandedCampaigns.has(r.campaignGroupId))
        .map((result) => (
          <DetailCard
            key={result.campaignGroupId}
            result={result}
            flags={flags}
            flagForm={flagForm}
            flagSeverity={flagSeverity}
            flagNote={flagNote}
            flagSubmitting={flagSubmitting}
            currentUserId={user?.id ?? null}
            onOpenFlagForm={(campaignGroupId, metaCampaignId, field) => {
              setFlagForm({ campaignGroupId, metaCampaignId, field });
              setFlagNote("");
              setFlagSeverity("warning");
            }}
            onCloseFlagForm={() => setFlagForm(null)}
            onSetFlagSeverity={setFlagSeverity}
            onSetFlagNote={setFlagNote}
            onSubmitFlag={handleCreateFlag}
            onDeleteFlag={handleDeleteFlag}
          />
        ))}

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
                  <div className="rpt-unmatched-detail">
                    Plan campaign with no matching Meta campaign
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmatched Meta Campaigns */}
      {report.unmatchedMetaCampaigns.length > 0 && (
        <div className="rpt-section">
          <h2 className="rpt-section-title">Not in Plan</h2>
          <div className="rpt-unmatched-list">
            {report.unmatchedMetaCampaigns.map((c) => (
              <div key={c.id} className="rpt-unmatched-card rpt-unmatched-info">
                <span className="rpt-unmatched-icon">&#8505;</span>
                <div>
                  <div className="rpt-unmatched-name">{c.name}</div>
                  <div className="rpt-unmatched-detail">
                    Meta campaign not found in media plan
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Summary Row ──
function SummaryRow({
  result,
  isExpanded,
  onToggle,
}: {
  result: CampaignValidationResult;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const rowClass =
    result.overallStatus === "pass"
      ? "rpt-row-pass"
      : result.overallStatus === "fail"
        ? "rpt-row-fail"
        : "rpt-row-warning";

  const guardrailStatus = getGuardrailsStatus(result.guardrailResults);

  return (
    <tr
      className={`rpt-summary-row ${rowClass} ${isExpanded ? "rpt-row-expanded" : ""}`}
      onClick={onToggle}
      style={{ cursor: "pointer" }}
    >
      <td className="rpt-campaign-cell">
        <div className="rpt-campaign-names">
          <span className="rpt-plan-name">{result.campaignGroupName}</span>
          <span className="rpt-arrow">&rarr;</span>
          <span className="rpt-meta-name">{result.metaCampaignName}</span>
        </div>
      </td>
      {SUMMARY_FIELDS.map((f) => {
        const st = getFieldStatus(result.fieldComparisons, f.key);
        return (
          <td key={f.key} className={`rpt-icon-cell ${statusClass(st)}`}>
            {statusIcon(st)}
          </td>
        );
      })}
      <td className={`rpt-icon-cell ${statusClass(guardrailStatus)}`}>
        {statusIcon(guardrailStatus)}
      </td>
      <td>
        <span
          className={`badge ${
            result.overallStatus === "pass"
              ? "badge-success"
              : result.overallStatus === "fail"
                ? "badge-error"
                : "badge-warning"
          }`}
        >
          {result.overallStatus}
        </span>
      </td>
    </tr>
  );
}

// ── Detail Card ──
function DetailCard({
  result,
  flags,
  flagForm,
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
  result: CampaignValidationResult;
  flags: ValidationFlag[];
  flagForm: { campaignGroupId: string; metaCampaignId: string; field: string } | null;
  flagSeverity: "critical" | "warning" | "info";
  flagNote: string;
  flagSubmitting: boolean;
  currentUserId: string | null;
  onOpenFlagForm: (campaignGroupId: string, metaCampaignId: string, field: string) => void;
  onCloseFlagForm: () => void;
  onSetFlagSeverity: (s: "critical" | "warning" | "info") => void;
  onSetFlagNote: (n: string) => void;
  onSubmitFlag: () => void;
  onDeleteFlag: (flagId: string) => void;
}) {
  const campaignFlags = flags.filter(
    (f) =>
      f.campaignGroupId === result.campaignGroupId &&
      f.metaCampaignId === result.metaCampaignId,
  );

  const isFormOpenForField = (field: string) =>
    flagForm?.campaignGroupId === result.campaignGroupId &&
    flagForm?.metaCampaignId === result.metaCampaignId &&
    flagForm?.field === field;

  const getExistingFlag = (field: string) =>
    campaignFlags.find((f) => f.field === field && !f.resolved);

  return (
    <div className="rpt-detail-card">
      <div className="rpt-detail-header">
        <div className="rpt-detail-title">
          <span>{result.campaignGroupName}</span>
          <span className="rpt-detail-arrow">&harr;</span>
          <span>{result.metaCampaignName}</span>
        </div>
        <span className="badge badge-primary">
          {Math.round(result.matchConfidence * 100)}% confidence
        </span>
      </div>

      {/* Field Comparisons */}
      {result.fieldComparisons.length > 0 && (
        <div className="rpt-detail-section">
          <h4 className="rpt-detail-section-title">Field Comparisons</h4>
          <div className="rpt-table-wrapper">
            <table className="rpt-detail-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Status</th>
                  <th>Message</th>
                  <th className="rpt-flag-col">Flag</th>
                </tr>
              </thead>
              <tbody>
                {result.fieldComparisons.map((fc, i) => {
                  const existingFlag = getExistingFlag(fc.field);
                  const formOpen = isFormOpenForField(fc.field);
                  return (
                    <FieldComparisonRow
                      key={i}
                      fc={fc}
                      existingFlag={existingFlag ?? null}
                      formOpen={formOpen}
                      flagSeverity={flagSeverity}
                      flagNote={flagNote}
                      flagSubmitting={flagSubmitting}
                      currentUserId={currentUserId}
                      onOpenForm={() =>
                        onOpenFlagForm(
                          result.campaignGroupId,
                          result.metaCampaignId,
                          fc.field,
                        )
                      }
                      onCloseForm={onCloseFlagForm}
                      onSetSeverity={onSetFlagSeverity}
                      onSetNote={onSetFlagNote}
                      onSubmit={onSubmitFlag}
                      onDelete={onDeleteFlag}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Guardrail Results */}
      {result.guardrailResults.length > 0 && (
        <div className="rpt-detail-section">
          <h4 className="rpt-detail-section-title">Guardrail Checks</h4>
          <div className="rpt-table-wrapper">
            <table className="rpt-detail-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {result.guardrailResults.map((gr, i) => (
                  <tr key={i} className={statusClass(gr.status)}>
                    <td className="rpt-field-name">{gr.ruleDescription}</td>
                    <td>
                      <span className={`rpt-status-badge ${statusClass(gr.status)}`}>
                        {statusIcon(gr.status)} {gr.status}
                      </span>
                    </td>
                    <td className="rpt-message">{gr.message || "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field Comparison Row with flag support ──
function FieldComparisonRow({
  fc,
  existingFlag,
  formOpen,
  flagSeverity,
  flagNote,
  flagSubmitting,
  currentUserId,
  onOpenForm,
  onCloseForm,
  onSetSeverity,
  onSetNote,
  onSubmit,
  onDelete,
}: {
  fc: FieldComparison;
  existingFlag: ValidationFlag | null;
  formOpen: boolean;
  flagSeverity: "critical" | "warning" | "info";
  flagNote: string;
  flagSubmitting: boolean;
  currentUserId: string | null;
  onOpenForm: () => void;
  onCloseForm: () => void;
  onSetSeverity: (s: "critical" | "warning" | "info") => void;
  onSetNote: (n: string) => void;
  onSubmit: () => void;
  onDelete: (flagId: string) => void;
}) {
  return (
    <>
      <tr className={statusClass(fc.status)}>
        <td className="rpt-field-name">{fc.field}</td>
        <td>{fc.expected || "\u2014"}</td>
        <td>{fc.actual || "\u2014"}</td>
        <td>
          <span className={`rpt-status-badge ${statusClass(fc.status)}`}>
            {statusIcon(fc.status)} {fc.status}
          </span>
        </td>
        <td className="rpt-message">{fc.message || "\u2014"}</td>
        <td className="rpt-flag-col">
          {existingFlag ? (
            <span
              className={`rpt-flag-inline-badge rpt-flag-severity-${existingFlag.severity}`}
              title={existingFlag.note}
            >
              &#9873; {severityLabel(existingFlag.severity)}
              {(currentUserId === existingFlag.flaggedByUserId || !currentUserId) && (
                <button
                  className="rpt-flag-inline-delete"
                  onClick={() => onDelete(existingFlag.id)}
                  title="Delete flag"
                >
                  &#10005;
                </button>
              )}
            </span>
          ) : (
            <button
              className="rpt-flag-icon-btn"
              onClick={onOpenForm}
              title="Flag this field"
            >
              &#9873;
            </button>
          )}
        </td>
      </tr>
      {formOpen && (
        <tr className="rpt-flag-form-row">
          <td colSpan={6}>
            <div className="rpt-flag-inline-form">
              <div className="rpt-flag-form-controls">
                <select
                  className="rpt-flag-select"
                  value={flagSeverity}
                  onChange={(e) =>
                    onSetSeverity(e.target.value as "critical" | "warning" | "info")
                  }
                >
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
                <textarea
                  className="rpt-flag-textarea"
                  placeholder="Describe the issue (required)"
                  value={flagNote}
                  onChange={(e) => onSetNote(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="rpt-flag-form-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={onSubmit}
                  disabled={flagSubmitting || !flagNote.trim()}
                >
                  {flagSubmitting ? "Submitting..." : "Submit Flag"}
                </button>
                <button className="btn btn-sm" onClick={onCloseForm}>
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
