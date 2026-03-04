import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { API_URL } from "../lib/api";
import type {
  MetaAdAccount,
  PipelineEvent,
  CampaignGroup,
  ThinkingEntry,
  ValidationResult,
  LineItemConfig,
} from "@guardrails/shared";

type Stage = "idle" | "uploading" | "complete" | "error";

interface StageStatus {
  parsing: "pending" | "active" | "done" | "error";
  validating: "pending" | "active" | "done" | "error";
  interpreting: "pending" | "active" | "done" | "error";
  resolving: "pending" | "active" | "done" | "error";
  configuring: "pending" | "active" | "done" | "error";
}

export function UploadPage() {
  const { user } = useAuth();

  // Ad account selection
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // File selection
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pipeline state
  const [stage, setStage] = useState<Stage>("idle");
  const [stages, setStages] = useState<StageStatus>({
    parsing: "pending",
    validating: "pending",
    interpreting: "pending",
    resolving: "pending",
    configuring: "pending",
  });
  const [progressMessage, setProgressMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [groups, setGroups] = useState<CampaignGroup[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [thinkingLog, setThinkingLog] = useState<ThinkingEntry[]>([]);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);

  // Fetch valid Meta accounts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/meta/accounts`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          const valid = data.accounts.filter(
            (a: MetaAdAccount) => a.tokenStatus === "valid",
          );
          if (!cancelled) {
            setAccounts(valid);
            if (valid.length === 1) {
              setSelectedAccountId(valid[0].id);
            }
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // File drop handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const f = e.dataTransfer.files[0];
      if (f.name.endsWith(".xlsx") || f.name.endsWith(".xls")) {
        setFile(f);
      }
    }
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        setFile(e.target.files[0]);
      }
    },
    [],
  );

  // Upload and process
  const handleUpload = useCallback(async () => {
    if (!file || !selectedAccountId) return;

    setStage("uploading");
    setStages({
      parsing: "active",
      validating: "pending",
      interpreting: "pending",
      resolving: "pending",
      configuring: "pending",
    });
    setProgressMessage("Starting upload...");
    setProgress(0);
    setGroups([]);
    setErrorMessage("");
    setThinkingLog([]);
    setValidationResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("metaAdAccountId", selectedAccountId);

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const err = await response
          .json()
          .catch(() => ({ error: "Upload failed" }));
        setStage("error");
        setErrorMessage(err.error || "Upload failed");
        return;
      }

      if (!response.body) {
        setStage("error");
        setErrorMessage("No response stream");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const event: PipelineEvent = JSON.parse(dataStr);

              setProgressMessage(event.message);

              // Append thinking entries
              if (event.type === "thinking" && event.data?.thinking) {
                setThinkingLog((prev) => [...prev, event.data!.thinking!]);
              }

              switch (event.type) {
                case "parsing":
                  setStages((s) => ({ ...s, parsing: "active" }));
                  break;
                case "parsed":
                  setStages((s) => ({ ...s, parsing: "done" }));
                  if (event.data?.totalRows) {
                    setTotalRows(event.data.totalRows);
                  }
                  break;
                case "validating":
                  setStages((s) => ({
                    ...s,
                    parsing: "done",
                    validating: "active",
                  }));
                  break;
                case "validated":
                  if (event.data?.validation) {
                    setValidationResult(event.data.validation);
                    setStages((s) => ({
                      ...s,
                      validating: event.data!.validation!.valid
                        ? "done"
                        : "error",
                    }));
                  } else {
                    setStages((s) => ({ ...s, validating: "done" }));
                  }
                  break;
                case "interpreting":
                  setStages((s) => ({
                    ...s,
                    parsing: "done",
                    validating: "done",
                    interpreting: "active",
                  }));
                  break;
                case "interpreted":
                  setStages((s) => ({ ...s, interpreting: "done" }));
                  break;
                case "resolving":
                  setStages((s) => ({
                    ...s,
                    interpreting: "done",
                    resolving: "active",
                  }));
                  if (event.data?.progress) {
                    setProgress(event.data.progress);
                  }
                  break;
                case "resolved":
                  setStages((s) => ({ ...s, resolving: "done" }));
                  if (event.data?.groups) {
                    setGroups(event.data.groups);
                  }
                  break;
                case "configuring":
                  setStages((s) => ({
                    ...s,
                    resolving: "done",
                    configuring: "active",
                  }));
                  break;
                case "configured":
                  setStages((s) => ({ ...s, configuring: "done" }));
                  if (event.data?.groups) {
                    setGroups(event.data.groups);
                  }
                  break;
                case "complete":
                  setStage("complete");
                  setStages({
                    parsing: "done",
                    validating: "done",
                    interpreting: "done",
                    resolving: "done",
                    configuring: "done",
                  });
                  if (event.data?.groups) {
                    setGroups(event.data.groups);
                  }
                  if (event.data?.totalRows) {
                    setTotalRows(event.data.totalRows);
                  }
                  break;
                case "error":
                  setStage("error");
                  if (event.data?.validation) {
                    setValidationResult(event.data.validation);
                  }
                  setErrorMessage(
                    event.data?.error ?? event.message ?? "Processing failed",
                  );
                  break;
              }
            } catch {
              // skip malformed event
            }
          }
        }
      }
    } catch (err) {
      setStage("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Upload failed",
      );
    }
  }, [file, selectedAccountId]);

  const handleRetry = useCallback(() => {
    setStage("idle");
    setFile(null);
    setGroups([]);
    setErrorMessage("");
    setProgress(0);
    setTotalRows(0);
    setThinkingLog([]);
    setValidationResult(null);
    setStages({
      parsing: "pending",
      validating: "pending",
      interpreting: "pending",
      resolving: "pending",
      configuring: "pending",
    });
  }, []);

  // ── Render ──

  // Upload form state
  if (stage === "idle") {
    return (
      <div>
        <div className="upload-header">
          <h1>Upload Media Plan</h1>
          <p className="upload-subtitle">
            Upload an Excel media plan to parse campaigns and resolve geographic
            targets
          </p>
        </div>

        {/* Ad account selector */}
        <div className="upload-section">
          <label className="upload-label" htmlFor="account-select">
            Meta Ad Account
          </label>
          {loadingAccounts ? (
            <p className="upload-hint">Loading accounts...</p>
          ) : accounts.length === 0 ? (
            <div className="upload-empty-accounts">
              <p>No Meta Ad Accounts with valid tokens found.</p>
              <a href="/settings/meta-accounts" className="upload-link">
                Connect a Meta Account
              </a>
            </div>
          ) : (
            <select
              id="account-select"
              className="upload-select"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              <option value="">Select an account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.metaAccountName} ({a.metaAccountId})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* File drop zone */}
        <div className="upload-section">
          <label className="upload-label">Media Plan File</label>
          <div
            className={`upload-dropzone${dragActive ? " upload-dropzone-active" : ""}${file ? " upload-dropzone-selected" : ""}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            {file ? (
              <div className="upload-file-info">
                <span className="upload-file-icon">&#128196;</span>
                <div>
                  <div className="upload-file-name">{file.name}</div>
                  <div className="upload-file-size">
                    {(file.size / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button
                  className="upload-file-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  aria-label="Remove file"
                >
                  &#10005;
                </button>
              </div>
            ) : (
              <div className="upload-dropzone-text">
                <span className="upload-dropzone-icon">&#8593;</span>
                <p>
                  Drag and drop your Excel file here, or{" "}
                  <span className="upload-dropzone-link">browse</span>
                </p>
                <p className="upload-hint">.xlsx or .xls files only</p>
              </div>
            )}
          </div>
        </div>

        {/* Upload button */}
        <button
          className="btn btn-primary upload-submit"
          disabled={!file || !selectedAccountId}
          onClick={handleUpload}
        >
          Upload &amp; Process
        </button>
      </div>
    );
  }

  // Processing state (and error state with thinking log visible)
  if (stage === "uploading" || (stage === "error" && thinkingLog.length > 0)) {
    return (
      <div>
        <div className="upload-header">
          <h1>
            {stage === "error" ? "Upload Failed" : "Processing Media Plan"}
          </h1>
          <p className="upload-subtitle">{file?.name}</p>
        </div>

        <div className="upload-progress">
          <StageIndicator label="Parsing Excel" status={stages.parsing} />
          <StageIndicator label="Validating Data" status={stages.validating} />
          <StageIndicator
            label="Interpreting Geo Targets"
            status={stages.interpreting}
          />
          <StageIndicator
            label="Resolving via Meta API"
            status={stages.resolving}
          />
          <StageIndicator
            label="Configuring Campaigns"
            status={stages.configuring}
          />
        </div>

        {/* Validation errors */}
        {stage === "error" && validationResult && !validationResult.valid && (
          <div className="upload-validation-errors">
            <div className="upload-validation-errors-top">
              <div className="upload-validation-errors-header">
                Validation Errors ({validationResult.issues.filter((i) => i.severity === "error").length})
              </div>
              <CopyButton
                getText={() =>
                  validationResult.issues
                    .map((i) => `[${i.severity.toUpperCase()}]${i.row ? ` Row ${i.row}` : ""}${i.field ? ` (${i.field})` : ""}: ${i.message}`)
                    .join("\n")
                }
                label="Copy Errors"
              />
            </div>
            {validationResult.issues
              .filter((i) => i.severity === "error")
              .map((issue, idx) => (
                <div key={idx} className="upload-validation-issue">
                  <span className="upload-validation-issue-icon">&#10007;</span>
                  <span>{issue.message}</span>
                </div>
              ))}
            {validationResult.issues.filter((i) => i.severity === "warning")
              .length > 0 && (
              <>
                <div className="upload-validation-warnings-header">
                  Warnings ({validationResult.issues.filter((i) => i.severity === "warning").length})
                </div>
                {validationResult.issues
                  .filter((i) => i.severity === "warning")
                  .map((issue, idx) => (
                    <div key={idx} className="upload-validation-issue upload-validation-issue-warn">
                      <span className="upload-validation-issue-icon">&#9888;</span>
                      <span>{issue.message}</span>
                    </div>
                  ))}
              </>
            )}
            <button className="btn btn-primary" onClick={handleRetry} style={{ marginTop: "var(--space-4)" }}>
              Fix and Re-upload
            </button>
          </div>
        )}

        {/* General error without validation */}
        {stage === "error" && !validationResult && (
          <div className="upload-error">
            <span className="upload-error-icon">&#9888;</span>
            <div>
              <p className="upload-error-text">{errorMessage}</p>
              <button className="btn btn-primary" onClick={handleRetry}>
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Thinking log */}
        <ThinkingLog entries={thinkingLog} />

        {stage === "uploading" && (
          <div className="upload-progress-message">
            {progressMessage}
            {progress > 0 && stages.resolving === "active" && (
              <div className="upload-progress-bar-container">
                <div
                  className="upload-progress-bar"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Error state (no thinking log — simple errors)
  if (stage === "error") {
    return (
      <div>
        <div className="upload-header">
          <h1>Upload Failed</h1>
        </div>
        <div className="upload-error">
          <span className="upload-error-icon">&#9888;</span>
          <div>
            <p className="upload-error-text">{errorMessage}</p>
            <button className="btn btn-primary" onClick={handleRetry}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Complete — campaign preview
  const totalResolved = groups.reduce(
    (sum, g) => sum + (g.resolvedGeoTargets?.length ?? 0),
    0,
  );
  const totalUnresolved = groups.reduce(
    (sum, g) => sum + (g.unresolvedIntents?.length ?? 0),
    0,
  );

  return (
    <div>
      <div className="upload-header">
        <h1>Campaign Preview</h1>
        <p className="upload-subtitle">{file?.name}</p>
      </div>

      {/* Summary bar */}
      <div className="upload-summary">
        <div className="upload-summary-item">
          <span className="upload-summary-value">{totalRows}</span>
          <span className="upload-summary-label">Rows</span>
        </div>
        <div className="upload-summary-item">
          <span className="upload-summary-value">{groups.length}</span>
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
      </div>

      {/* Campaign group cards */}
      <div className="upload-groups">
        {groups.map((group, i) => (
          <div key={i} className="upload-group-card">
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
                {group.status === "unsupported" ? "unsupported channel" : group.status}
              </span>
            </div>

            {/* Resolved geo targets */}
            {group.resolvedGeoTargets && group.resolvedGeoTargets.length > 0 && (
              <div className="upload-group-section">
                <div className="upload-group-section-header">
                  Resolved Geo Targets
                </div>
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
                                  Age: {config.targeting.ageMin}-{config.targeting.ageMax}, Gender: {config.targeting.genders.length === 2 ? "M+F" : config.targeting.genders[0] === 1 ? "M" : "F"}
                                </div>
                              )}
                              <ConfigWarnings config={config} field="targeting" />
                            </td>
                            <td>
                              {item.buyType || "—"}
                              {config?.buyType && (
                                <div className="upload-interpreted">
                                  {config.buyType.buyingType}
                                </div>
                              )}
                              <ConfigWarnings config={config} field="buyType" />
                            </td>
                            <td>
                              {item.asset || "—"}
                              {config?.asset && (
                                <div className="upload-interpreted">
                                  {config.asset.format}{config.asset.videoDurationSeconds ? ` (${config.asset.videoDurationSeconds}s)` : ""}
                                </div>
                              )}
                              <ConfigWarnings config={config} field="asset" />
                            </td>
                            <td>
                              {item.inventory || "—"}
                              {config?.inventory && (
                                <div className="upload-interpreted">
                                  {config.inventory.facebookPositions ? `fb: ${config.inventory.facebookPositions.join(", ")}` : ""}
                                  {config.inventory.facebookPositions && config.inventory.instagramPositions ? " | " : ""}
                                  {config.inventory.instagramPositions ? `ig: ${config.inventory.instagramPositions.join(", ")}` : ""}
                                </div>
                              )}
                              <ConfigWarnings config={config} field="inventory" />
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
        ))}
      </div>

      {/* Actions */}
      <div className="upload-actions">
        <button className="btn" onClick={handleRetry}>
          Upload Another
        </button>
      </div>
    </div>
  );
}

// ── Config warnings component ──
function ConfigWarnings({ config, field }: { config?: LineItemConfig; field: string }) {
  if (!config?.warnings.length) return null;
  const relevant = config.warnings.filter((w) =>
    w.toLowerCase().includes(field.toLowerCase().replace("buytype", "buy type")),
  );
  if (relevant.length === 0) return null;
  return (
    <>
      {relevant.map((w, i) => (
        <div key={i} className="upload-interpreted upload-interpreted-warn">
          {w}
        </div>
      ))}
    </>
  );
}

// ── Copy button component ──
function CopyButton({ getText, label }: { getText: () => string; label: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = getText();
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [getText]);

  return (
    <button
      className="btn-copy"
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? "\u2713 Copied" : label}
    </button>
  );
}

// ── Thinking Log component ──
function ThinkingLog({ entries }: { entries: ThinkingEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const getLogText = useCallback(() => {
    return entries
      .map((e) => {
        const icon =
          e.status === "pass" ? "[PASS]" :
          e.status === "fail" ? "[FAIL]" :
          e.status === "warn" ? "[WARN]" : "[INFO]";
        return `${icon} [${e.stage}] ${e.message}`;
      })
      .join("\n");
  }, [entries]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="thinking-log-wrapper">
      <div className="thinking-log-header">
        <span className="thinking-log-title">Processing Log</span>
        <CopyButton getText={getLogText} label="Copy Log" />
      </div>
      <div className="thinking-log" ref={containerRef}>
        {entries.map((entry, i) => (
          <div key={i} className={`thinking-entry thinking-entry-${entry.status}`}>
            <span className="thinking-stage-badge">{entry.stage}</span>
            <span className="thinking-entry-icon">
              {entry.status === "pass"
                ? "\u2713"
                : entry.status === "fail"
                  ? "\u2717"
                  : entry.status === "warn"
                    ? "\u26A0"
                    : "\u2022"}
            </span>
            <span className="thinking-entry-message">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stage indicator component ──
function StageIndicator({
  label,
  status,
}: {
  label: string;
  status: "pending" | "active" | "done" | "error";
}) {
  return (
    <div className={`upload-stage upload-stage-${status}`}>
      <span className="upload-stage-icon">
        {status === "done"
          ? "\u2713"
          : status === "error"
            ? "\u2717"
            : "\u25CB"}
      </span>
      <span className="upload-stage-label">{label}</span>
    </div>
  );
}
