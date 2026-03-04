import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { API_URL } from "../lib/api";

interface MetaAdAccount {
  id: string;
  metaAccountId: string;
  metaAccountName: string;
  connectedByEmail: string;
  connectedAt: string;
  tokenStatus: "valid" | "expired" | "error";
}

interface PendingAccount {
  accountId: string;
  accountName: string;
}

export function MetaAccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  // Account selection state (after OAuth callback)
  const [pendingAccounts, setPendingAccounts] = useState<PendingAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [selectingSession, setSelectingSession] = useState<string | null>(null);
  const [metaUserId, setMetaUserId] = useState<string | null>(null);
  const [submittingSelection, setSubmittingSelection] = useState(false);

  // Disconnect confirmation
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/meta/accounts`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Check URL params for OAuth callback or error
  useEffect(() => {
    const status = searchParams.get("status");
    const reason = searchParams.get("reason");
    const sessionId = searchParams.get("session");

    if (status === "error" && reason) {
      setError(decodeURIComponent(reason));
      // Clean up URL params
      setSearchParams({}, { replace: true });
    }

    if (status === "select" && sessionId) {
      setSelectingSession(sessionId);
      fetchPendingAccounts(sessionId);
      // Clean up URL params
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const fetchPendingAccounts = async (sessionId: string) => {
    try {
      const res = await fetch(
        `${API_URL}/api/meta/pending-accounts?sessionId=${encodeURIComponent(sessionId)}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        setPendingAccounts(data.accounts || []);
        setMetaUserId(data.metaUserId || null);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to load pending accounts");
        setSelectingSession(null);
      }
    } catch {
      setError("Failed to load pending accounts");
      setSelectingSession(null);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/meta/auth-url`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to get authorization URL");
        setConnecting(false);
      }
    } catch {
      setError("Something went wrong");
      setConnecting(false);
    }
  };

  const toggleAccountSelection = (accountId: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  const handleConnectSelected = async () => {
    if (selectedAccountIds.size === 0 || !selectingSession || !metaUserId) return;
    setSubmittingSelection(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/meta/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          metaUserId,
          selectedAccountIds: Array.from(selectedAccountIds),
          sessionId: selectingSession,
        }),
      });
      if (res.ok) {
        // Clear selection state and refresh
        setSelectingSession(null);
        setPendingAccounts([]);
        setSelectedAccountIds(new Set());
        setMetaUserId(null);
        fetchAccounts();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to connect selected accounts");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setSubmittingSelection(false);
    }
  };

  const handleCancelSelection = () => {
    setSelectingSession(null);
    setPendingAccounts([]);
    setSelectedAccountIds(new Set());
    setMetaUserId(null);
  };

  const handleDisconnect = async (accountId: string) => {
    setDisconnectingId(accountId);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/meta/accounts/${accountId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        fetchAccounts();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to disconnect account");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setDisconnectingId(null);
      setConfirmDisconnect(null);
    }
  };

  const getTokenBadgeClass = (status: string) => {
    switch (status) {
      case "valid":
        return "badge-success";
      case "expired":
        return "badge-warning";
      case "error":
        return "badge-error";
      default:
        return "badge-warning";
    }
  };

  const getTokenLabel = (status: string) => {
    switch (status) {
      case "valid":
        return "Valid";
      case "expired":
        return "Expiring";
      case "error":
        return "Error";
      default:
        return status;
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Meta Ad Accounts</h1>
        {accounts.length > 0 && !selectingSession && (
          <button
            className="btn-primary"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? "Redirecting..." : "Connect Meta Account"}
          </button>
        )}
      </div>

      {/* Error banner */}
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

      {/* Account selection after OAuth */}
      {selectingSession && pendingAccounts.length > 0 && (
        <div className="card mb-6">
          <h3 className="mb-4">Select Ad Accounts to Connect</h3>
          <p className="text-secondary mb-4">
            Choose which Meta ad accounts you want to connect to Guardrails.
          </p>
          <div className="meta-select-list">
            {pendingAccounts.map((acct) => (
              <label key={acct.accountId} className="meta-select-item">
                <input
                  type="checkbox"
                  checked={selectedAccountIds.has(acct.accountId)}
                  onChange={() => toggleAccountSelection(acct.accountId)}
                />
                <div className="meta-select-item-info">
                  <span className="meta-select-item-name">
                    {acct.accountName}
                  </span>
                  <span className="meta-select-item-id">{acct.accountId}</span>
                </div>
              </label>
            ))}
          </div>
          <div className="form-actions mt-4">
            <button
              className="btn-primary"
              onClick={handleConnectSelected}
              disabled={selectedAccountIds.size === 0 || submittingSelection}
            >
              {submittingSelection
                ? "Connecting..."
                : `Connect Selected (${selectedAccountIds.size})`}
            </button>
            <button className="btn-secondary" onClick={handleCancelSelection}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectingSession && pendingAccounts.length === 0 && !error && (
        <div className="card mb-6">
          <p className="text-secondary">Loading available accounts...</p>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <p className="text-secondary">Loading accounts...</p>
      ) : accounts.length === 0 && !selectingSession ? (
        /* Empty state */
        <div className="meta-empty-state">
          <div className="meta-empty-icon">&#9741;</div>
          <h2>No Meta Accounts Connected</h2>
          <p className="text-secondary">
            Connect your Meta ad accounts to start monitoring and managing your
            campaigns with Guardrails.
          </p>
          <button
            className="btn-primary mt-6"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? "Redirecting..." : "Connect Meta Account"}
          </button>
        </div>
      ) : (
        /* Accounts table */
        accounts.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Account Name</th>
                <th>Account ID</th>
                <th>Connected By</th>
                <th>Connected Date</th>
                <th>Token Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acct) => (
                <tr key={acct.id}>
                  <td style={{ fontWeight: "var(--font-medium)" }}>
                    {acct.metaAccountName}
                  </td>
                  <td>
                    <code className="meta-account-id-code">
                      {acct.metaAccountId}
                    </code>
                  </td>
                  <td>{acct.connectedByEmail}</td>
                  <td>{formatDate(acct.connectedAt)}</td>
                  <td>
                    <span
                      className={`badge ${getTokenBadgeClass(acct.tokenStatus)}`}
                    >
                      {getTokenLabel(acct.tokenStatus)}
                    </span>
                  </td>
                  <td>
                    {confirmDisconnect === acct.id ? (
                      <div className="meta-confirm-actions">
                        <button
                          className="btn-danger-sm"
                          onClick={() => handleDisconnect(acct.id)}
                          disabled={disconnectingId === acct.id}
                        >
                          {disconnectingId === acct.id
                            ? "Removing..."
                            : "Confirm"}
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => setConfirmDisconnect(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-secondary"
                        onClick={() => setConfirmDisconnect(acct.id)}
                      >
                        Disconnect
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
