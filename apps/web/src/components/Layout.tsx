import { Link, useNavigate } from "react-router";
import { useAuth } from "../hooks/useAuth";

export function Layout({ children }: { children: React.ReactNode }) {
  const { role, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-brand">
          Guardrails
        </div>
        <div className="sidebar-nav">
          <Link to="/dashboard">
            Dashboard
          </Link>
          {role === "super_admin" && (
            <Link to="/users">
              User Management
            </Link>
          )}
        </div>
        <button className="btn-ghost" onClick={handleLogout}>
          Logout
        </button>
      </nav>
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
