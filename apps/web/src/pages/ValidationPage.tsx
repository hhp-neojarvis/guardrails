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
  CampaignStrategy,
  OneToManyMatchSuggestion,
  AdSetMatchCandidate,
  LineItemMatchSuggestion,
} from "@guardrails/shared";

type Phase = 1 | 2 | 3 | 4;

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

  // Phase 2 state (strategy)
  const [strategy, setStrategy] = useState<CampaignStrategy | null>(null);

  // Phase 3 state (match)
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [oneToManySuggestions, setOneToManySuggestions] = useState<OneToManyMatchSuggestion[]>([]);
  const [selections, setSelections] = useState<Map<string, string>>(new Map());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [changingGroup, setChangingGroup] = useState<string | null>(null);
  // For 1:N strategy: line item → ad set selections per campaign group
  const [lineItemSelections, setLineItemSelections] = useState<Map<string, Map<number, string>>>(new Map());

  // Phase 4 state (validate)
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
      setPhase(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch campaigns");
    } finally {
      setLoading(false);
    }
  };

  // ── Phase 2: Select strategy and fetch match suggestions ──
  const handleSelectStrategy = async (selected: CampaignStrategy) => {
    setStrategy(selected);
    setLoading(true);
    setError("");
    try {
      // Set strategy on the server
      const stratRes = await fetch(`${API_URL}/api/uploads/${id}/strategy`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy: selected }),
      });
      if (!stratRes.ok) {
        const data = await stratRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to set strategy");
      }

      // Fetch match suggestions
      const sugRes = await fetch(`${API_URL}/api/uploads/${id}/match-suggestions`, {
        credentials: "include",
      });
      if (sugRes.ok) {
        const sugData: MatchSuggestionsResponse = await sugRes.json();
        setSuggestions(sugData.suggestions);

        if (selected === "one_campaign" && sugData.oneToManySuggestions) {
          setOneToManySuggestions(sugData.oneToManySuggestions);

          // Pre-select top campaign candidates with score >= 0.6
          // Line-item suggestions are fetched on-demand when the user accepts a campaign
          const initial = new Map<string, string>();
          for (const s of sugData.oneToManySuggestions) {
            if (s.metaCampaignCandidates.length > 0 && s.metaCampaignCandidates[0].score >= 0.6) {
              initial.set(s.campaignGroupId, s.metaCampaignCandidates[0].metaCampaignId);
            }
          }
          setSelections(initial);

          // Fetch line-item suggestions for each pre-selected campaign
          for (const [groupId, metaCampaignId] of initial.entries()) {
            fetchLineItemSuggestions(groupId, metaCampaignId);
          }
        } else {
          // 1:1 strategy - pre-select top candidates
          const initial = new Map<string, string>();
          for (const s of sugData.suggestions) {
            if (s.candidates.length > 0 && s.candidates[0].score >= 0.6) {
              initial.set(s.campaignGroupId, s.candidates[0].metaCampaignId);
            }
          }
          setSelections(initial);
        }
      }

      setPhase(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set strategy");
      setStrategy(null);
    } finally {
      setLoading(false);
    }
  };

  // ── Phase 3: Confirm matches ──
  const handleConfirmMatches = async () => {
    setLoading(true);
    setError("");
    try {
      const matchEntries: ConfirmMatchesRequest["matches"] = [];
      const confirmed: ConfirmedMatch[] = [];

      if (strategy === "one_campaign") {
        for (const [groupId, metaId] of selections.entries()) {
          if (skipped.has(groupId)) continue;

          const suggestion = oneToManySuggestions.find((s) => s.campaignGroupId === groupId);
          const candidate = suggestion?.metaCampaignCandidates.find((c) => c.metaCampaignId === metaId);
          const metaCampaign = campaigns.find((c) => c.metaCampaignId === metaId);

          // Gather line item matches for this group
          const groupLineItems = lineItemSelections.get(groupId);
          const lineItemMatches: Array<{ lineItemIndex: number; metaAdSetId: string }> = [];
          if (groupLineItems) {
            for (const [lineItemIndex, metaAdSetId] of groupLineItems.entries()) {
              lineItemMatches.push({ lineItemIndex, metaAdSetId });
            }
          }

          matchEntries.push({
            campaignGroupId: groupId,
            metaCampaignId: metaId,
            confidence: candidate?.score ?? 0,
            lineItemMatches: lineItemMatches.length > 0 ? lineItemMatches : undefined,
          });

          confirmed.push({
            campaignGroupId: groupId,
            campaignGroupName: suggestion?.campaignGroupName ?? groupId,
            metaCampaignId: metaId,
            metaCampaignName: metaCampaign?.name ?? candidate?.metaCampaignName ?? metaId,
            confidence: candidate?.score ?? 0,
          });
        }
      } else {
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
      setPhase(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm matches");
    } finally {
      setLoading(false);
    }
  };

  // ── Phase 4: Run validation ──
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

  // Fetch line-item suggestions on-demand when a campaign is selected in 1:N mode
  const fetchLineItemSuggestions = async (groupId: string, metaCampaignId: string) => {
    try {
      const res = await fetch(
        `${API_URL}/api/uploads/${id}/match-suggestions/line-items?campaignGroupId=${groupId}&metaCampaignId=${metaCampaignId}`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const data: { lineItemSuggestions: LineItemMatchSuggestion[] } = await res.json();

      // Update the oneToManySuggestions with the fresh line-item suggestions
      setOneToManySuggestions((prev) =>
        prev.map((s) =>
          s.campaignGroupId === groupId
            ? { ...s, lineItemSuggestions: data.lineItemSuggestions }
            : s,
        ),
      );

      // Pre-select top ad set candidates with score >= 0.6
      const lineItemMap = new Map<number, string>();
      for (const li of data.lineItemSuggestions) {
        if (li.candidates.length > 0 && li.candidates[0].score >= 0.6) {
          lineItemMap.set(li.lineItemIndex, li.candidates[0].metaAdSetId);
        }
      }
      if (lineItemMap.size > 0) {
        setLineItemSelections((prev) => {
          const next = new Map(prev);
          next.set(groupId, lineItemMap);
          return next;
        });
      }
    } catch {
      // Silently fail — the user can still manually select ad sets
    }
  };

  const handleSelectMeta = (groupId: string, metaCampaignId: string) => {
    setSelections((prev) => new Map(prev).set(groupId, metaCampaignId));
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
    setChangingGroup(null);

    // In 1:N mode, fetch line-item suggestions for the selected campaign
    if (strategy === "one_campaign") {
      fetchLineItemSuggestions(groupId, metaCampaignId);
    }
  };

  const handleSkip = (groupId: string) => {
    setSkipped((prev) => new Set(prev).add(groupId));
    setSelections((prev) => {
      const next = new Map(prev);
      next.delete(groupId);
      return next;
    });
  };

  const handleSelectAdSet = (groupId: string, lineItemIndex: number, metaAdSetId: string) => {
    setLineItemSelections((prev) => {
      const next = new Map(prev);
      const groupMap = new Map(next.get(groupId) ?? []);
      groupMap.set(lineItemIndex, metaAdSetId);
      next.set(groupId, groupMap);
      return next;
    });
  };

  const getTopCandidate = (candidates: MatchCandidate[]): MatchCandidate | null => {
    if (candidates.length === 0) return null;
    return candidates[0];
  };

  const getTopAdSetCandidate = (candidates: AdSetMatchCandidate[]): AdSetMatchCandidate | null => {
    if (candidates.length === 0) return null;
    return candidates[0];
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

  // Get ad sets for a specific meta campaign
  const getAdSetsForCampaign = (metaCampaignId: string) => {
    const campaign = campaigns.find((c) => c.metaCampaignId === metaCampaignId);
    return campaign?.adSets ?? [];
  };

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
                2. Strategy
              </span>
              <span className="val-step-divider">&#8594;</span>
              <span className={`val-step ${phase >= 3 ? "val-step-active" : ""} ${phase > 3 ? "val-step-done" : ""}`}>
                3. Match
              </span>
              <span className="val-step-divider">&#8594;</span>
              <span className={`val-step ${phase >= 4 ? "val-step-active" : ""}`}>
                4. Validate
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

      {/* Phase 2: Strategy Selection */}
      {phase === 2 && (
        <div className="val-phase">
          <div className="val-found-badge">
            <span className="badge badge-success">Found {campaignCount} campaigns</span>
          </div>

          <div className="val-section-header">
            <h2>Choose Campaign Strategy</h2>
            <p className="val-section-subtitle">
              How are your Meta campaigns organized relative to your media plan?
            </p>
          </div>

          <div className="val-strategy-cards">
            <button
              className={`val-strategy-card ${strategy === "one_per_line_item" ? "val-strategy-selected" : ""}`}
              onClick={() => handleSelectStrategy("one_per_line_item")}
              disabled={loading}
            >
              <h3>One Campaign per Line Item</h3>
              <p>
                Each row in your plan maps to a separate Meta campaign.
              </p>
              {loading && strategy === "one_per_line_item" ? (
                <span className="val-btn-loading">
                  <span className="val-spinner" />
                  Loading...
                </span>
              ) : (
                <span className="btn btn-sm btn-primary">Select</span>
              )}
            </button>

            <button
              className={`val-strategy-card ${strategy === "one_campaign" ? "val-strategy-selected" : ""}`}
              onClick={() => handleSelectStrategy("one_campaign")}
              disabled={loading}
            >
              <h3>One Campaign, Multiple Ad Sets</h3>
              <p>
                All rows map to a single campaign. Each row matches an ad set within it.
              </p>
              {loading && strategy === "one_campaign" ? (
                <span className="val-btn-loading">
                  <span className="val-spinner" />
                  Loading...
                </span>
              ) : (
                <span className="btn btn-sm btn-primary">Select</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Phase 3: Match */}
      {phase === 3 && strategy === "one_per_line_item" && (
        <div className="val-phase">
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
              const topCandidate = getTopCandidate(suggestion.candidates);
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

      {/* Phase 3: Match (1:N strategy) */}
      {phase === 3 && strategy === "one_campaign" && (
        <div className="val-phase">
          <div className="val-found-badge">
            <span className="badge badge-success">Found {campaignCount} campaigns</span>
          </div>

          <div className="val-section-header">
            <h2>Match Campaigns &amp; Ad Sets</h2>
            <p className="val-section-subtitle">
              Match your plan campaigns to a Meta campaign, then map each line item to an ad set
            </p>
          </div>

          <div className="val-match-list">
            {oneToManySuggestions.map((suggestion) => {
              const topCandidate = getTopCandidate(suggestion.metaCampaignCandidates);
              const isSkipped = skipped.has(suggestion.campaignGroupId);
              const selectedId = selections.get(suggestion.campaignGroupId);
              const isChanging = changingGroup === suggestion.campaignGroupId;
              const hasAutoSuggestion = topCandidate && topCandidate.score >= 0.6;
              const adSets = selectedId ? getAdSetsForCampaign(selectedId) : [];

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

                      {/* Line item → ad set matches (shown after campaign is accepted) */}
                      {selectedId && suggestion.lineItemSuggestions.length > 0 && (
                        <div className="val-line-item-matches">
                          <h4 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", marginBottom: "var(--space-2)" }}>
                            Line Item &rarr; Ad Set Mapping
                          </h4>
                          {suggestion.lineItemSuggestions.map((li) => {
                            const topAdSet = getTopAdSetCandidate(li.candidates);
                            const selectedAdSetId = lineItemSelections.get(suggestion.campaignGroupId)?.get(li.lineItemIndex);
                            const hasAutoAdSet = topAdSet && topAdSet.score >= 0.6;

                            return (
                              <div key={li.lineItemIndex} className="val-line-item-row">
                                <span className="val-line-item-name">{li.lineItemName}</span>
                                <span className="val-line-item-arrow">&rarr;</span>
                                <div className="val-line-item-adset">
                                  {hasAutoAdSet && selectedAdSetId === topAdSet.metaAdSetId ? (
                                    <span style={{ fontSize: "var(--text-sm)" }}>
                                      {topAdSet.metaAdSetName}{" "}
                                      <span className={`badge ${getConfidenceClass(topAdSet.score)}`}>
                                        {Math.round(topAdSet.score * 100)}%
                                      </span>
                                    </span>
                                  ) : (
                                    <select
                                      className="input val-select"
                                      value={selectedAdSetId ?? (hasAutoAdSet ? topAdSet.metaAdSetId : "")}
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          handleSelectAdSet(
                                            suggestion.campaignGroupId,
                                            li.lineItemIndex,
                                            e.target.value,
                                          );
                                        }
                                      }}
                                      style={{ minWidth: "200px" }}
                                    >
                                      <option value="">Select an ad set...</option>
                                      {adSets.map((as) => (
                                        <option key={as.metaAdSetId} value={as.metaAdSetId}>
                                          {as.name}
                                        </option>
                                      ))}
                                      {/* Also include candidates from suggestions that may not be in the campaign */}
                                      {li.candidates
                                        .filter((c) => !adSets.some((as) => as.metaAdSetId === c.metaAdSetId))
                                        .map((c) => (
                                          <option key={c.metaAdSetId} value={c.metaAdSetId}>
                                            {c.metaAdSetName}
                                          </option>
                                        ))}
                                    </select>
                                  )}
                                </div>
                              </div>
                            );
                          })}
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

      {/* Phase 4: Validate */}
      {phase === 4 && (
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
