import { useState, useEffect, useCallback } from "react";

const API_URL = "http://api.guardrails.localhost:1355";

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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1>User Management</h1>
        <button onClick={() => { setShowInviteForm(true); setInviteLink(""); setInviteEmail(""); setInviteError(""); }}
          style={{ padding: "8px 16px", cursor: "pointer" }}>
          Invite User
        </button>
      </div>

      {/* Invite form modal/section */}
      {showInviteForm && (
        <div style={{ marginBottom: 24, padding: 20, border: "1px solid #e0e0e0", borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Invite User</h3>
          {!inviteLink ? (
            <form onSubmit={handleInvite}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="inviteEmail" style={{ display: "block", marginBottom: 4 }}>Email</label>
                <input id="inviteEmail" type="email" value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)} required
                  style={{ width: "100%", padding: 8, maxWidth: 300 }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="inviteRole" style={{ display: "block", marginBottom: 4 }}>Role</label>
                <select id="inviteRole" value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{ padding: 8 }}>
                  <option value="executor">Executor</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              {inviteError && <p style={{ color: "red" }}>{inviteError}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" disabled={inviting} style={{ padding: "8px 16px" }}>
                  {inviting ? "Creating..." : "Create Invite"}
                </button>
                <button type="button" onClick={() => setShowInviteForm(false)} style={{ padding: "8px 16px" }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div>
              <p style={{ color: "green", marginBottom: 8 }}>Invite created! Share this link:</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="text" value={inviteLink} readOnly
                  style={{ flex: 1, padding: 8, maxWidth: 500 }} />
                <button onClick={copyLink} style={{ padding: "8px 16px" }}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <button onClick={() => setShowInviteForm(false)}
                style={{ marginTop: 12, padding: "8px 16px" }}>
                Done
              </button>
            </div>
          )}
        </div>
      )}

      {/* Users table */}
      {loading ? (
        <p>Loading users...</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}>
              <th style={{ padding: 8 }}>Email</th>
              <th style={{ padding: 8 }}>Role</th>
              <th style={{ padding: 8 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: 8 }}>{u.email}</td>
                <td style={{ padding: 8 }}>{u.role === "super_admin" ? "Super Admin" : "Executor"}</td>
                <td style={{ padding: 8 }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 13,
                    background: u.status === "active" ? "#e8f5e9" : "#fff3e0",
                  }}>
                    {u.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
