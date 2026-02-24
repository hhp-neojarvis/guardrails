import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { authClient } from "../lib/auth-client";
import { useAuth } from "../hooks/useAuth";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const message = searchParams.get("message");
  const { user, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Redirect if already authenticated
  if (!isLoading && user) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message || "Invalid email or password");
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch {
      setError("Invalid email or password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-center">
      <div className="card">
        <h1 className="mb-6">Login</h1>
        {message && <p className="text-success mb-4">{message}</p>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-error mb-4">{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
