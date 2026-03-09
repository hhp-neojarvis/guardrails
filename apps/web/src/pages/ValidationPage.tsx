import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { API_URL } from "../lib/api";
import type {
  MetaCampaignSnapshot,
  MatchSuggestion,
  MatchCandidate,
  FetchCampaignsResponse,
  MatchSuggestionsResponse,
  ConfirmMatchesRequest,
} from "@guardrails/shared";

type Phase = 1 | 2 | 3;

interface ConfirmedMatch {
  campaignGroupId: string;
  campaignGroupName: string;
  metaCampaignId: string;
  metaCampaignName: string;
  confidence: number;
}

export function ValidationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Phase 1 state
  const [campaigns, setCampaigns] = useState<MetaCampaignSnapshot[]>([]);
  const [campaignCount, setCampaignCount] = useState(0);

  // Phase 2 state
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [selections, setSelections] = useState<Map<string, string>>(new Map());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [changingGroup, setChangingGroup] = useState<string | null>(null);

  // Phase 3 state
  const [confirmedMatches, setConfirmedMatches] = useState<ConfirmedMatch[]>([]);
  const [validating, setValidating] = useState(false);

  // ── Phase 1: Fetch campaigns ──
  const handleFetchCampaigns = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/fetch-campaigns`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch campaigns");
      }
      const data: FetchCampaignsResponse = await res.json();
      setCampaigns(data.campaigns);
      setCampaignCount(data.count);

      // Auto-fetch match suggestions
      const sugRes = await fetch(`${API_URL}/api/uploads/${id}/match-suggestions`, {
        credentials: "include",
      });
      if (sugRes.ok) {
        const sugData: MatchSuggestionsResponse = await sugRes.json();
        setSuggestions(sugData.suggestions);

        // Pre-select top candidates with score >= 0.6
        const initial = new Map<string, string>();
        for (const s of sugData.suggestions) {
          if (s.candidates.length > 0 && s.candidates[0].score >= 0.6) {
            initial.set(s.campaignGroupId, s.candidates[0].metaCampaignId);
          }
        }
        setSelections(initial);
      }

      setPhase(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch campaigns");
    } finally {
      setLoading(false);
    }
  };

  // ── Phase 2: Confirm matches ──
  const handleConfirmMatches = async () => {
    setLoading(true);
    setError("");
    try {
      const matchEntries: ConfirmMatchesRequest["matches"] = [];
      const confirmed: ConfirmedMatch[] = [];

      for (const [groupId, metaId] of selections.entries()) {
        if (skipped.has(groupId)) continue;

        const suggestion = suggestions.find((s) => s.campaignGroupId === groupId);
        const candidate = suggestion?.candidates.find((c) => c.metaCampaignId === metaId);
        const metaCampaign = campaigns.find((c) => c.metaCampaignId === metaId);

        matchEntries.push({
          campaignGroupId: groupId,
          metaCampaignId: metaId,
          confidence: candidate?.score ?? 0,
        });

        confirmed.push({
          campaignGroupId: groupId,
          campaignGroupName: suggestion?.campaignGroupName ?? groupId,
          metaCampaignId: metaId,
          metaCampaignName: metaCampaign?.name ?? candidate?.metaCampaignName ?? metaId,
          confidence: candidate?.score ?? 0,
        });
      }

      const res = await fetch(`${API_URL}/api/uploads/${id}/matches`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches: matchEntries }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to confirm matches");
      }

      setConfirmedMatches(confirmed);
      setPhase(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm matches");
    } finally {
      setLoading(false);
    }
  };

  // ── Phase 3: Run validation ──
  const handleValidate = async () => {
    setValidating(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/uploads/${id}/validate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Validation failed");
      }
      navigate(`/jobs/${id}/report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  };

  // ── Helpers ──
  const handleSelectMeta = (groupId: string, metaCampaignId: string) => {
    setSelections((prev) => new Map(prev).set(groupId, metaCampaignId));
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
    setChangingGroup(null);
  };

  const handleSkip = (groupId: string) => {
    setSkipped((prev) => new Set(prev).add(groupId));
    setSelections((prev) => {
      const next = new Map(prev);
      next.delete(groupId);
      return next;
    });
  };

  const getTopCandidate = (suggestion: MatchSuggestion): MatchCandidate | null => {
    if (suggestion.candidates.length === 0) return null;
    return suggestion.candidates[0];
  };

  const getConfidenceClass = (score: number): string => {
    if (score >= 0.7) return "val-confidence-high";
    if (score >= 0.4) return "val-confidence-medium";
    return "val-confidence-low";
  };

  const activeSelectionCount = Array.from(selections.keys()).filter(
    (k) => !skipped.has(k),
  ).length;

  // Unmatched meta campaigns (not selected by any group)
  const selectedMetaIds = new Set(selections.values());
  const unmatchedMeta = campaigns.filter(
    (c) => !selectedMetaIds.has(c.metaCampaignId),
  );

  return (
    <div>
      {/* Header */}
      <div className="upload-header">
        <div className="job-detail-header">
          <button className="btn btn-sm" onClick={() => navigate(`/jobs/${id}`)}>
            &#8592; Back
          </button>
          <div>
            <h1>Validate Campaigns</h1>
            <div className="val-steps">
              <span className={`val-step ${phase >= 1 ? "val-step-active" : ""} ${phase > 1 ? "val-step-done" : ""}`}>
                1. Fetch
              </span>
              <span className="val-step-divider">&#8594;</span>
              <span className={`val-step ${phase >= 2 ? "val-step-active" : ""} ${phase > 2 ? "val-step-done" : ""}`}>
                2. Match
              </span>
              <span className="val-step-divider">&#8594;</span>
              <span className={`val-step ${phase >= 3 ? "val-step-active" : ""}`}>
                3. Validate
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="upload-error" style={{ marginBottom: "var(--space-4)" }}>
          <span className="upload-error-icon">&#9888;</span>
          <div>
            <p className="upload-error-text">{error}</p>
            {phase === 1 && (
              <button className="btn btn-sm" onClick={handleFetchCampaigns}>
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Phase 1: Fetch */}
      {phase === 1 && (
        <div className="val-phase">
          <div className="val-phase-content">
            <p className="val-phase-description">
              Fetch live campaigns from your connected Meta ad account to compare
              against your media plan.
            </p>
            <button
              className="btn btn-primary"
              onClick={handleFetchCampaigns}
              disabled={loading}
            >
              {loading ? (
                <span className="val-btn-loading">
                  <span className="val-spinner" />
                  Fetching...
                </span>
              ) : (
                "Fetch Live Campaigns"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Phase 2: Match */}
      {phase === 2 && (
        <div className="val-phase">
          {/* Campaign count badge */}
          <div className="val-found-badge">
            <span className="badge badge-success">Found {campaignCount} campaigns</span>
          </div>

          <div className="val-section-header">
            <h2>Match Campaigns</h2>
            <p className="val-section-subtitle">
              Match your plan campaigns to live Meta campaigns
            </p>
          </div>

          <div className="val-match-list">
            {suggestions.map((suggestion) => {
              const topCandidate = getTopCandidate(suggestion);
              const isSkipped = skipped.has(suggestion.campaignGroupId);
              const selectedId = selections.get(suggestion.campaignGroupId);
              const isChanging = changingGroup === suggestion.campaignGroupId;
              const hasAutoSuggestion = topCandidate && topCandidate.score >= 0.6;

              return (
                <div
                  key={suggestion.campaignGroupId}
                  className={`val-match-card ${isSkipped ? "val-match-card-skipped" : ""}`}
                >
                  <div className="val-match-card-header">
                    <div className="val-match-plan-name">
                      {suggestion.campaignGroupName}
                    </div>
                    <button
                      className="btn btn-sm val-skip-btn"
                      onClick={() =>
                        isSkipped
                          ? setSkipped((prev) => {
                              const next = new Set(prev);
                              next.delete(suggestion.campaignGroupId);
                              return next;
                            })
                          : handleSkip(suggestion.campaignGroupId)
                      }
                    >
                      {isSkipped ? "Unskip" : "Skip"}
                    </button>
                  </div>

                  {!isSkipped && (
                    <div className="val-match-card-body">
                      {hasAutoSuggestion && !isChanging ? (
                        <div className="val-suggestion">
                          <div className="val-suggestion-info">
                            <span className="val-meta-name">
                              {topCandidate.metaCampaignName}
                            </span>
                            <span
                              className={`badge ${getConfidenceClass(topCandidate.score)}`}
                            >
                              {Math.round(topCandidate.score * 100)}% match
                            </span>
                          </div>
                          <div className="val-suggestion-actions">
                            <button
                              className={`btn btn-sm ${selectedId === topCandidate.metaCampaignId ? "btn-primary" : ""}`}
                              onClick={() =>
                                handleSelectMeta(
                                  suggestion.campaignGroupId,
                                  topCandidate.metaCampaignId,
                                )
                              }
                            >
                              {selectedId === topCandidate.metaCampaignId
                                ? "Accepted"
                                : "Accept"}
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() =>
                                setChangingGroup(suggestion.campaignGroupId)
                              }
                            >
                              Change
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="val-manual-select">
                          {!hasAutoSuggestion && !isChanging && (
                            <p className="val-no-match">No match found</p>
                          )}
                          <select
                            className="input val-select"
                            value={selectedId ?? ""}
                            onChange={(e) => {
                              if (e.target.value) {
                                handleSelectMeta(
                                  suggestion.campaignGroupId,
                                  e.target.value,
                                );
                              }
                            }}
                          >
                            <option value="">Select a Meta campaign...</option>
                            {campaigns.map((c) => (
                              <option key={c.metaCampaignId} value={c.metaCampaignId}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          {isChanging && (
                            <button
                              className="btn btn-sm"
                              onClick={() => setChangingGroup(null)}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {isSkipped && (
                    <div className="val-match-card-body">
                      <p className="val-skipped-label">Skipped — will not be matched</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Unmatched Meta campaigns */}
          {unmatchedMeta.length > 0 && (
            <div className="val-unmatched-section">
              <h3 className="val-unmatched-header">
                Unmatched Meta Campaigns ({unmatchedMeta.length})
              </h3>
              <div className="val-unmatched-list">
                {unmatchedMeta.map((c) => (
                  <div key={c.metaCampaignId} className="val-unmatched-item">
                    <span className="val-unmatched-name">{c.name}</span>
                    <span className={`badge ${c.status === "ACTIVE" ? "badge-success" : ""}`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="val-phase-actions">
            <button
              className="btn btn-primary"
              onClick={handleConfirmMatches}
              disabled={activeSelectionCount === 0 || loading}
            >
              {loading ? (
                <span className="val-btn-loading">
                  <span className="val-spinner" />
                  Confirming...
                </span>
              ) : (
                `Confirm ${activeSelectionCount} Match${activeSelectionCount !== 1 ? "es" : ""}`
              )}
            </button>
          </div>
        </div>
      )}

      {/* Phase 3: Validate */}
      {phase === 3 && (
        <div className="val-phase">
          <div className="val-section-header">
            <h2>Confirmed Matches</h2>
            <p className="val-section-subtitle">
              {confirmedMatches.length} campaign{confirmedMatches.length !== 1 ? "s" : ""} matched
            </p>
          </div>

          <div className="val-confirmed-list">
            {confirmedMatches.map((m) => (
              <div key={m.campaignGroupId} className="val-confirmed-item">
                <span className="val-confirmed-plan">{m.campaignGroupName}</span>
                <span className="val-confirmed-arrow">&#8594;</span>
                <span className="val-confirmed-meta">{m.metaCampaignName}</span>
              </div>
            ))}
          </div>

          <div className="val-phase-actions">
            <button
              className="btn btn-primary"
              onClick={handleValidate}
              disabled={validating}
            >
              {validating ? (
                <span className="val-btn-loading">
                  <span className="val-spinner" />
                  Validating...
                </span>
              ) : (
                "Run Validation"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
