import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../hooks/useAuth";
import { API_URL } from "../lib/api";

export function DashboardPage() {
  const { role } = useAuth();
  const navigate = useNavigate();

  const [metaAccountCount, setMetaAccountCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/meta/accounts`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setMetaAccountCount(data.accounts.length);
        } else {
          if (!cancelled) setMetaAccountCount(0);
        }
      } catch {
        if (!cancelled) setMetaAccountCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const companyName = "Acme Corp";
  const companySlug = "acme-corp";

  const metaSubtitle =
    metaAccountCount === null
      ? "Loading..."
      : metaAccountCount === 0
        ? "No accounts connected"
        : `${metaAccountCount} account${metaAccountCount === 1 ? "" : "s"} connected`;

  return (
    <div>
      {/* Page header */}
      <div className="dash-header">
        <div className="dash-header-top">
          <h1>{companyName}</h1>
          <span className="badge badge-success">active</span>
        </div>
        <span className="dash-header-slug">Slug: {companySlug}</span>
      </div>

      {/* Overview stats */}
      <div className="dash-section">
        <div className="dash-section-heading">Overview</div>
        <div className="dash-stats">
          <div className="dash-stat-card">
            <span className="dash-stat-icon">&#9654;</span>
            <div className="dash-stat-value">0</div>
            <div className="dash-stat-label">Active Campaigns</div>
          </div>
          <div className="dash-stat-card">
            <span className="dash-stat-icon">&#9881;</span>
            <div className="dash-stat-value">0</div>
            <div className="dash-stat-label">Guardrails</div>
          </div>
          <div className="dash-stat-card">
            <span className="dash-stat-icon">&#9733;</span>
            <div className="dash-stat-value">0</div>
            <div className="dash-stat-label">Total Executions</div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="dash-section">
        <div className="dash-section-heading">Quick Actions</div>
        <div className="dash-actions">
          <div
            className="dash-action-card dash-action-primary"
            onClick={() => navigate("/upload")}
            role="link"
          >
            <div className="dash-action-icon">&#8593;</div>
            <div className="dash-action-text">
              <div className="dash-action-title">Upload Media Plan</div>
              <div className="dash-action-subtitle">
                Import a new media plan
              </div>
            </div>
            <span className="dash-action-arrow">&#8594;</span>
          </div>
          <div className="dash-action-card">
            <div className="dash-action-icon">&#9881;</div>
            <div className="dash-action-text">
              <div className="dash-action-title">Manage Guardrails</div>
              <div className="dash-action-subtitle">
                Configure validation rules
              </div>
            </div>
            <span className="dash-action-arrow">&#8594;</span>
          </div>
          <div
            className={`dash-action-card${metaAccountCount === 0 ? " dash-action-highlight" : ""}`}
            onClick={() => navigate("/settings/meta-accounts")}
            role="link"
          >
            <div className="dash-action-icon">&#9741;</div>
            <div className="dash-action-text">
              <div className="dash-action-title">Connect Meta Account</div>
              <div className="dash-action-subtitle">{metaSubtitle}</div>
            </div>
            <span className="dash-action-arrow">&#8594;</span>
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="dash-section">
        <div className="dash-section-heading">Configuration</div>
        {role === "super_admin" ? (
          <Link to="/users" className="dash-config-card">
            <div className="dash-config-text">
              <span className="dash-config-title">
                Company Settings &mdash; Manage users, roles &amp; preferences
              </span>
            </div>
            <span className="dash-config-arrow">Configure &#8594;</span>
          </Link>
        ) : (
          <div className="dash-config-card">
            <div className="dash-config-text">
              <span className="dash-config-title">
                Company Settings &mdash; Manage users, roles &amp; preferences
              </span>
              <span className="dash-config-subtitle">
                Contact your admin for access
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
