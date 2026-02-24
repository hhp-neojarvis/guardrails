import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

const API_URL = "http://api.guardrails.localhost:1355";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <div className="page-center">
        <div className="card">
          <h1 className="mb-4">Reset Password</h1>
          <p className="text-error">Invalid reset link — no token provided.</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Invalid or expired reset link");
        return;
      }

      navigate("/login?message=Password+reset+—+please+log+in", { replace: true });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-center">
      <div className="card">
        <h1 className="mb-2">Reset Password</h1>
        <p className="text-secondary mb-6">Enter your new password below.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="password">New Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-error mb-4">{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Resetting password..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
