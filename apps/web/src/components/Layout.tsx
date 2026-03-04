import { Link, useNavigate, useLocation } from "react-router";
import { useAuth } from "../hooks/useAuth";

function getInitial(name: string | undefined | null): string {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
}

function getRoleLabel(role: string | null): string {
  if (role === "super_admin") return "Super Admin";
  if (role === "executor") return "Executor";
  return role ?? "Member";
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const companyName = "Acme Corp";
  const companySlug = "acme-corp";

  const isActive = (path: string) => location.pathname === path;
  const isActivePrefix = (prefix: string) => location.pathname.startsWith(prefix);

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <nav className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">G</div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Guardrails</span>
            <span className="sidebar-brand-subtitle">Media Executor</span>
          </div>
        </div>

        {/* Org switcher */}
        <div className="sidebar-org">
          <div className="sidebar-org-avatar">
            {getInitial(companyName)}
          </div>
          <div className="sidebar-org-info">
            <span className="sidebar-org-name">{companyName}</span>
            <span className="sidebar-org-slug">{companySlug}</span>
          </div>
        </div>

        {/* Navigation */}
        <div className="sidebar-nav">
          <div className="sidebar-nav-section">
            <div className="sidebar-nav-section-header">Overview</div>
            <Link
              to="/dashboard"
              className={isActive("/dashboard") ? "nav-active" : ""}
            >
              <span className="sidebar-nav-icon">&#9632;</span>
              Dashboard
            </Link>
            <Link
              to="/upload"
              className={isActive("/upload") ? "nav-active" : ""}
            >
              <span className="sidebar-nav-icon">&#8593;</span>
              Upload Media Plan
            </Link>
            <Link
              to="/jobs"
              className={isActivePrefix("/jobs") ? "nav-active" : ""}
            >
              <span className="sidebar-nav-icon">&#9776;</span>
              Jobs
            </Link>
            <Link
              to="/guardrails"
              className={isActive("/guardrails") ? "nav-active" : ""}
            >
              <span className="sidebar-nav-icon">&#9888;</span>
              Guardrails
            </Link>
          </div>

          {role === "super_admin" && (
            <div className="sidebar-nav-section">
              <div className="sidebar-nav-section-header">Manage</div>
              <Link
                to="/users"
                className={isActive("/users") ? "nav-active" : ""}
              >
                <span className="sidebar-nav-icon">&#9775;</span>
                User Management
              </Link>
            </div>
          )}

          <div className="sidebar-nav-section">
            <div className="sidebar-nav-section-header">Settings</div>
            <Link
              to="/settings/meta-accounts"
              className={isActivePrefix("/settings/meta-accounts") ? "nav-active" : ""}
            >
              <span className="sidebar-nav-icon">&#9741;</span>
              Meta Accounts
            </Link>
          </div>
        </div>

        {/* Version badge */}
        <div className="sidebar-version">
          <span>v0.1.0</span>
        </div>
      </nav>

      {/* Right side: topbar + content */}
      <div className="main-area">
        {/* Top bar */}
        <header className="topbar">
          <button className="topbar-bell" title="Notifications">
            &#128276;
          </button>
          <div className="topbar-user">
            <div className="topbar-avatar">
              {getInitial(user?.name || user?.email)}
            </div>
            <div className="topbar-user-info">
              <span className="topbar-user-email">
                {user?.email ?? "user@example.com"}
              </span>
              <span className="topbar-user-role">{getRoleLabel(role)}</span>
            </div>
          </div>
          <button className="topbar-logout" onClick={handleLogout}>
            Logout
          </button>
        </header>

        {/* Main content */}
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
