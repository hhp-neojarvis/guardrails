import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { API_URL } from "../lib/api";
import type {
  CampaignGroup,
  GuardrailValidationResult,
  CampaignGuardrailResult,
  GuardrailViolation,
  LineItemConfig,
} from "@guardrails/shared";

interface OverrideRecord {
  id: string;
  uploadId: string;
  campaignGroupId: string;
  ruleId: string;
  ruleDescription: string;
  violationMessage: string;
  reason: string;
  overriddenByUserId: string;
  overriddenByEmail: string;
  createdAt: string;
}

interface JobDetail {
  id: string;
  fileName: string;
  status: string;
  totalRows: number | null;
  groups: CampaignGroup[];
  errorMessage: string | null;
  guardrailResults: GuardrailValidationResult | null;
  overrides: OverrideRecord[];
  createdAt: string;
}

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overrideForm, setOverrideForm] = useState<{
    campaignGroupId: string;
    ruleId: string;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJob = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setJob(data);
      } else {
        setError("Failed to load job");
      }
    } catch {
      setError("Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Poll while processing
  useEffect(() => {
    if (job?.status === "processing") {
      pollRef.current = setInterval(fetchJob, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [job?.status, fetchJob]);

  const handleOverride = async () => {
    if (!overrideForm || !overrideReason.trim()) return;
    setOverrideSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/override`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignGroupId: overrideForm.campaignGroupId,
          ruleId: overrideForm.ruleId,
          reason: overrideReason.trim(),
        }),
      });
      if (res.ok) {
        setOverrideForm(null);
        setOverrideReason("");
        await fetchJob();
      } else {
        const data = await res.json();
        setError(data.error || "Override failed");
      }
    } catch {
      setError("Override failed");
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        await fetchJob();
      } else {
        const data = await res.json();
        setError(data.error || "Approve failed");
      }
    } catch {
      setError("Approve failed");
    } finally {
      setApproving(false);
    }
  };

  const isOverridden = (campaignGroupId: string, ruleId: string) => {
    return job?.overrides.some(
      (o) => o.campaignGroupId === campaignGroupId && o.ruleId === ruleId,
    );
  };

  const getOverride = (campaignGroupId: string, ruleId: string) => {
    return job?.overrides.find(
      (o) => o.campaignGroupId === campaignGroupId && o.ruleId === ruleId,
    );
  };

  if (loading) {
    return (
      <div>
        <div className="upload-header">
          <h1>Job Details</h1>
          <p className="upload-subtitle">Loading...</p>
        </div>
      </div>
    );
  }

  if (error && !job) {
    return (
      <div>
        <div className="upload-header">
          <h1>Job Details</h1>
        </div>
        <div className="upload-error">
          <span className="upload-error-icon">&#9888;</span>
          <div>
            <p className="upload-error-text">{error}</p>
            <button className="btn" onClick={() => navigate("/jobs")}>
              Back to Jobs
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!job) return null;

  const totalViolations = job.guardrailResults?.results.reduce(
    (sum, r) => sum + r.violations.length,
    0,
  ) ?? 0;
  const totalOverrides = job.overrides.length;
  const allOverridden = totalViolations > 0 && totalOverrides >= totalViolations;
  const totalResolved = job.groups.reduce(
    (sum, g) => sum + (g.resolvedGeoTargets?.length ?? 0),
    0,
  );
  const totalUnresolved = job.groups.reduce(
    (sum, g) => sum + (g.unresolvedIntents?.length ?? 0),
    0,
  );

  const statusClass =
    job.status === "completed"
      ? "badge-success"
      : job.status === "awaiting_review"
        ? "badge-warning"
        : job.status === "error"
          ? "badge-error"
          : "badge-info";

  const statusLabel =
    job.status === "awaiting_review" ? "Awaiting Review" :
    job.status.charAt(0).toUpperCase() + job.status.slice(1);

  return (
    <div>
      {/* Header */}
      <div className="upload-header">
        <div className="job-detail-header">
          <button className="btn btn-sm" onClick={() => navigate("/jobs")}>
            &#8592; Jobs
          </button>
          <div>
            <h1>{job.fileName}</h1>
            <div className="job-detail-meta">
              <span className={`badge ${statusClass}`}>{statusLabel}</span>
              <span className="job-detail-date">
                {new Date(job.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="upload-error" style={{ marginBottom: "var(--space-4)" }}>
          <span className="upload-error-icon">&#9888;</span>
          <p className="upload-error-text">{error}</p>
        </div>
      )}

      {/* Summary bar */}
      <div className="upload-summary">
        <div className="upload-summary-item">
          <span className="upload-summary-value">{job.totalRows ?? 0}</span>
          <span className="upload-summary-label">Rows</span>
        </div>
        <div className="upload-summary-item">
          <span className="upload-summary-value">{job.groups.length}</span>
          <span className="upload-summary-label">Campaigns</span>
        </div>
        <div className="upload-summary-item">
          <span className="upload-summary-value">{totalResolved}</span>
          <span className="upload-summary-label">Geo Targets</span>
        </div>
        {totalUnresolved > 0 && (
          <div className="upload-summary-item upload-summary-warning">
            <span className="upload-summary-value">{totalUnresolved}</span>
            <span className="upload-summary-label">Unresolved</span>
          </div>
        )}
        {totalViolations > 0 && (
          <div className="upload-summary-item upload-summary-warning">
            <span className="upload-summary-value">{totalViolations}</span>
            <span className="upload-summary-label">Violations</span>
          </div>
        )}
        {totalOverrides > 0 && (
          <div className="upload-summary-item">
            <span className="upload-summary-value">{totalOverrides}</span>
            <span className="upload-summary-label">Overridden</span>
          </div>
        )}
      </div>

      {/* Processing state */}
      {job.status === "processing" && (
        <div className="job-processing">
          <div className="job-processing-spinner" />
          <p>Processing... This page will update automatically.</p>
        </div>
      )}

      {/* Guardrail Results */}
      {job.guardrailResults && job.guardrailResults.hasViolations && (
        <div className="job-guardrail-section">
          <h2>Guardrail Results</h2>
          {job.guardrailResults.results
            .filter((r) => r.status === "fail")
            .map((result) => (
              <GuardrailResultCard
                key={result.campaignGroupId}
                result={result}
                isOverridden={isOverridden}
                getOverride={getOverride}
                overrideForm={overrideForm}
                onStartOverride={(campaignGroupId, ruleId) => {
                  setOverrideForm({ campaignGroupId, ruleId });
                  setOverrideReason("");
                }}
                onCancelOverride={() => {
                  setOverrideForm(null);
                  setOverrideReason("");
                }}
                overrideReason={overrideReason}
                onReasonChange={setOverrideReason}
                onSubmitOverride={handleOverride}
                overrideSubmitting={overrideSubmitting}
                isAwaitingReview={job.status === "awaiting_review"}
              />
            ))}

          {/* Approve button */}
          {job.status === "awaiting_review" && allOverridden && (
            <div className="job-approve-section">
              <button
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={approving}
              >
                {approving ? "Approving..." : "Approve & Complete"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Campaign Preview Cards */}
      <div className="upload-groups">
        <h2>Campaign Preview</h2>
        {job.groups.map((group, i) => (
          <CampaignGroupCard key={group.id ?? i} group={group} />
        ))}
      </div>

      {/* Actions */}
      <div className="upload-actions">
        <button className="btn" onClick={() => navigate("/upload")}>
          Upload Another
        </button>
      </div>
    </div>
  );
}

// ── Guardrail Result Card ──
function GuardrailResultCard({
  result,
  isOverridden,
  getOverride,
  overrideForm,
  onStartOverride,
  onCancelOverride,
  overrideReason,
  onReasonChange,
  onSubmitOverride,
  overrideSubmitting,
  isAwaitingReview,
}: {
  result: CampaignGuardrailResult;
  isOverridden: (cid: string, rid: string) => boolean | undefined;
  getOverride: (cid: string, rid: string) => OverrideRecord | undefined;
  overrideForm: { campaignGroupId: string; ruleId: string } | null;
  onStartOverride: (campaignGroupId: string, ruleId: string) => void;
  onCancelOverride: () => void;
  overrideReason: string;
  onReasonChange: (v: string) => void;
  onSubmitOverride: () => void;
  overrideSubmitting: boolean;
  isAwaitingReview: boolean;
}) {
  return (
    <div className="job-guardrail-card">
      <div className="job-guardrail-card-header">
        <h3>{result.campaignName}</h3>
        <span className="badge badge-error">
          {result.violations.length} violation{result.violations.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="job-guardrail-violations">
        {result.violations.map((v, i) => {
          const overridden = isOverridden(result.campaignGroupId, v.ruleId);
          const override = getOverride(result.campaignGroupId, v.ruleId);
          const isEditingThis =
            overrideForm?.campaignGroupId === result.campaignGroupId &&
            overrideForm?.ruleId === v.ruleId;

          return (
            <div
              key={i}
              className={`job-violation ${overridden ? "job-violation-overridden" : ""}`}
            >
              <div className="job-violation-header">
                <div className="job-violation-info">
                  <span className="job-violation-icon">
                    {overridden ? "\u2713" : "\u2717"}
                  </span>
                  <div>
                    <div className="job-violation-rule">{v.ruleDescription}</div>
                    <div className="job-violation-message">{v.message}</div>
                    <div className="job-violation-meta">
                      <span className="badge">{v.field}</span>
                    </div>
                  </div>
                </div>
                {overridden ? (
                  <div className="job-violation-overridden-badge">
                    <span className="badge badge-success">Overridden</span>
                    <div className="job-override-detail">
                      <span>by {override?.overriddenByEmail}</span>
                      <span>Reason: {override?.reason}</span>
                    </div>
                  </div>
                ) : isAwaitingReview && !isEditingThis ? (
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      onStartOverride(result.campaignGroupId, v.ruleId)
                    }
                  >
                    Override
                  </button>
                ) : null}
              </div>

              {isEditingThis && (
                <div className="job-override-form">
                  <input
                    type="text"
                    className="input"
                    placeholder="Reason for override..."
                    value={overrideReason}
                    onChange={(e) => onReasonChange(e.target.value)}
                    autoFocus
                  />
                  <div className="job-override-form-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={onSubmitOverride}
                      disabled={!overrideReason.trim() || overrideSubmitting}
                    >
                      {overrideSubmitting ? "Saving..." : "Confirm Override"}
                    </button>
                    <button className="btn btn-sm" onClick={onCancelOverride}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Campaign Group Card (reused from UploadPage) ──
function CampaignGroupCard({ group }: { group: CampaignGroup }) {
  return (
    <div className="upload-group-card">
      <div className="upload-group-header">
        <div>
          <h3 className="upload-group-name">{group.campaignName}</h3>
          <div className="upload-group-meta">
            <span>Markets: {group.markets}</span>
            <span>Channel: {group.channel}</span>
            <span>{group.lineItems?.length ?? 0} line items</span>
            {group.frequencyCap && group.frequencyIntervalDays && (
              <span>
                Frequency: {group.frequencyCap} times every{" "}
                {group.frequencyIntervalDays} days
              </span>
            )}
          </div>
        </div>
        <span
          className={`badge ${group.status === "resolved" ? "badge-success" : group.status === "error" ? "badge-error" : group.status === "unsupported" ? "badge-warning" : ""}`}
        >
          {group.status === "unsupported"
            ? "unsupported channel"
            : group.status}
        </span>
      </div>

      {/* Resolved geo targets */}
      {group.resolvedGeoTargets && group.resolvedGeoTargets.length > 0 && (
        <div className="upload-group-section">
          <div className="upload-group-section-header">Resolved Geo Targets</div>
          <div className="upload-geo-tags">
            {group.resolvedGeoTargets.map((geo, j) => (
              <span key={j} className="upload-geo-tag">
                {geo.name}
                <span className="upload-geo-tag-type">{geo.type}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Unresolved warnings */}
      {group.unresolvedIntents && group.unresolvedIntents.length > 0 && (
        <div className="upload-group-section upload-group-warnings">
          <div className="upload-group-section-header">
            Unresolved ({group.unresolvedIntents.length})
          </div>
          {group.unresolvedIntents.map((u, j) => (
            <div key={j} className="upload-warning-item">
              <span className="upload-warning-icon">&#9888;</span>
              <span>
                {u.intent.name} ({u.intent.type}) — {u.reason}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Line items table */}
      {group.lineItems && group.lineItems.length > 0 && (
        <div className="upload-group-section">
          <div className="upload-group-section-header">Line Items</div>
          <div className="upload-table-wrapper">
            <table className="upload-table">
              <thead>
                <tr>
                  <th>Targeting</th>
                  <th>Buy Type</th>
                  <th>Asset</th>
                  <th>Inventory</th>
                  <th>Budget</th>
                  <th>Start</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {group.lineItems.map((item, k) => {
                  const config = group.lineItemConfigs?.[k];
                  return (
                    <tr key={k}>
                      <td>
                        {item.targeting || "—"}
                        {config?.targeting && (
                          <div className="upload-interpreted">
                            Age: {config.targeting.ageMin}-
                            {config.targeting.ageMax}, Gender:{" "}
                            {config.targeting.genders.length === 2
                              ? "M+F"
                              : config.targeting.genders[0] === 1
                                ? "M"
                                : "F"}
                          </div>
                        )}
                      </td>
                      <td>
                        {item.buyType || "—"}
                        {config?.buyType && (
                          <div className="upload-interpreted">
                            {config.buyType.buyingType}
                          </div>
                        )}
                      </td>
                      <td>
                        {item.asset || "—"}
                        {config?.asset && (
                          <div className="upload-interpreted">
                            {config.asset.format}
                            {config.asset.videoDurationSeconds
                              ? ` (${config.asset.videoDurationSeconds}s)`
                              : ""}
                          </div>
                        )}
                      </td>
                      <td>
                        {item.inventory || "—"}
                        {config?.inventory && (
                          <div className="upload-interpreted">
                            {config.inventory.facebookPositions
                              ? `fb: ${config.inventory.facebookPositions.join(", ")}`
                              : ""}
                            {config.inventory.facebookPositions &&
                            config.inventory.instagramPositions
                              ? " | "
                              : ""}
                            {config.inventory.instagramPositions
                              ? `ig: ${config.inventory.instagramPositions.join(", ")}`
                              : ""}
                          </div>
                        )}
                      </td>
                      <td>{item.budget || "—"}</td>
                      <td>{item.startDate || "—"}</td>
                      <td>{item.endDate || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
