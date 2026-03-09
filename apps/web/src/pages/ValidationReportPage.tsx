import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { API_URL } from "../lib/api";
import type {
  ValidationReport,
  CampaignValidationResult,
  FieldComparison,
  GuardrailCheckResult,
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
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revalidating, setRevalidating] = useState(false);

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

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

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
          <DetailCard key={result.campaignGroupId} result={result} />
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
function DetailCard({ result }: { result: CampaignValidationResult }) {
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
                </tr>
              </thead>
              <tbody>
                {result.fieldComparisons.map((fc, i) => (
                  <tr key={i} className={statusClass(fc.status)}>
                    <td className="rpt-field-name">{fc.field}</td>
                    <td>{fc.expected || "\u2014"}</td>
                    <td>{fc.actual || "\u2014"}</td>
                    <td>
                      <span className={`rpt-status-badge ${statusClass(fc.status)}`}>
                        {statusIcon(fc.status)} {fc.status}
                      </span>
                    </td>
                    <td className="rpt-message">{fc.message || "\u2014"}</td>
                  </tr>
                ))}
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
