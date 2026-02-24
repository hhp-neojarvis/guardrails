import { Navigate } from "react-router";
import { useAuth } from "../hooks/useAuth";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="loading-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
