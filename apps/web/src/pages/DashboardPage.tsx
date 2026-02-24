import { useAuth } from "../hooks/useAuth";

export function DashboardPage() {
  const { user, role } = useAuth();

  return (
    <div>
      <h1>Dashboard</h1>
      <div style={{ marginTop: 16 }}>
        <p><strong>Company:</strong> {/* companyId for now, name comes later */}</p>
        <p>
          <strong>Role:</strong>{" "}
          <span style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 4,
            background: role === "super_admin" ? "#e3f2fd" : "#f3e5f5",
            fontSize: 14,
          }}>
            {role === "super_admin" ? "Super Admin" : "Executor"}
          </span>
        </p>
        <p><strong>Email:</strong> {user?.email}</p>
      </div>
      <div style={{ marginTop: 32, padding: 24, border: "1px dashed #ccc", borderRadius: 8, color: "#999" }}>
        Campaign management coming soon...
      </div>
    </div>
  );
}
