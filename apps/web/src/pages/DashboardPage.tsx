import { useAuth } from "../hooks/useAuth";

export function DashboardPage() {
  const { user, role } = useAuth();

  return (
    <div>
      <h1 className="mb-6">Dashboard</h1>
      <div className="info-grid">
        <p><strong>Company:</strong> {/* companyId for now, name comes later */}</p>
        <p>
          <strong>Role:</strong>{" "}
          <span className={`badge ${role === "super_admin" ? "badge-primary" : "badge-success"}`}>
            {role === "super_admin" ? "Super Admin" : "Executor"}
          </span>
        </p>
        <p><strong>Email:</strong> {user?.email}</p>
      </div>
      <div className="placeholder-area">
        Campaign management coming soon...
      </div>
    </div>
  );
}
