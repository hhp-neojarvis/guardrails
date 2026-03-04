import { useState, useEffect, useCallback } from "react";
import { API_URL } from "../lib/api";

interface User {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

export function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("executor");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetLink, setResetLink] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetCopied, setResetCopied] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/users`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    setInviteLink("");
    setInviting(true);

    try {
      const res = await fetch(`${API_URL}/api/users/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Failed to create invite");
        return;
      }

      setInviteLink(data.inviteLink);
      fetchUsers(); // Refresh table
    } catch {
      setInviteError("Something went wrong");
    } finally {
      setInviting(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResetPassword = async (userId: string) => {
    setResetError("");
    setResetLink("");

    try {
      const res = await fetch(`${API_URL}/api/users/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error || "Failed to generate reset link");
        return;
      }

      setResetLink(data.resetLink);
    } catch {
      setResetError("Something went wrong");
    }
  };

  const copyResetLink = () => {
    navigator.clipboard.writeText(resetLink);
    setResetCopied(true);
    setTimeout(() => setResetCopied(false), 2000);
  };

  return (
    <div>
      <div className="page-header">
        <h1>User Management</h1>
        <button className="btn-primary" onClick={() => { setShowInviteForm(true); setInviteLink(""); setInviteEmail(""); setInviteError(""); }}>
          Invite User
        </button>
      </div>

      {/* Invite form modal/section */}
      {showInviteForm && (
        <div className="card mb-6">
          <h3 className="mb-4">Invite User</h3>
          {!inviteLink ? (
            <form onSubmit={handleInvite}>
              <div className="form-group">
                <label htmlFor="inviteEmail">Email</label>
                <input id="inviteEmail" type="email" value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)} required
                  style={{ maxWidth: 300 }} />
              </div>
              <div className="form-group">
                <label htmlFor="inviteRole">Role</label>
                <select id="inviteRole" value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="executor">Executor</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              {inviteError && <p className="text-error mb-4">{inviteError}</p>}
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={inviting}>
                  {inviting ? "Creating..." : "Create Invite"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowInviteForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div>
              <p className="text-success mb-2">Invite created! Share this link:</p>
              <div className="invite-link-row">
                <input type="text" value={inviteLink} readOnly />
                <button className="btn-secondary" onClick={copyLink}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <button className="btn-ghost mt-4" onClick={() => setShowInviteForm(false)}>
                Done
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reset link card */}
      {resetLink && (
        <div className="card mb-6">
          <h3 className="mb-4">Password Reset Link</h3>
          <p className="text-success mb-2">Reset link generated! Share this link with the user:</p>
          <div className="invite-link-row">
            <input type="text" value={resetLink} readOnly />
            <button className="btn-secondary" onClick={copyResetLink}>
              {resetCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button className="btn-ghost mt-4" onClick={() => setResetLink("")}>
            Done
          </button>
        </div>
      )}

      {resetError && (
        <div className="card mb-6">
          <p className="text-error">{resetError}</p>
        </div>
      )}

      {/* Users table */}
      {loading ? (
        <p className="text-secondary">Loading users...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.role === "super_admin" ? "Super Admin" : "Executor"}</td>
                <td>
                  <span className={`badge ${u.status === "active" ? "badge-success" : "badge-warning"}`}>
                    {u.status}
                  </span>
                </td>
                <td>
                  {u.status === "active" && (
                    <button className="btn-secondary" onClick={() => handleResetPassword(u.id)}>
                      Reset Password
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
