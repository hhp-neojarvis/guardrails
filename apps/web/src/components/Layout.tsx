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
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={{
        width: 240,
        padding: 24,
        borderRight: "1px solid #e0e0e0",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{ fontWeight: "bold", fontSize: 20, marginBottom: 32 }}>
          Guardrails
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          <Link to="/dashboard" style={{ textDecoration: "none", padding: "8px 12px" }}>
            Dashboard
          </Link>
          {role === "super_admin" && (
            <Link to="/users" style={{ textDecoration: "none", padding: "8px 12px" }}>
              User Management
            </Link>
          )}
        </div>
        <button onClick={handleLogout} style={{ padding: "8px 12px", cursor: "pointer" }}>
          Logout
        </button>
      </nav>
      <main style={{ flex: 1, padding: 32 }}>
        {children}
      </main>
    </div>
  );
}
