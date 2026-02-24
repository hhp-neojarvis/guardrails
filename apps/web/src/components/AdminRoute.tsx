import { Navigate } from "react-router";
import { useAuth } from "../hooks/useAuth";
import { ProtectedRoute } from "./ProtectedRoute";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();

  return (
    <ProtectedRoute>
      {role === "super_admin" ? children : <Navigate to="/dashboard" replace />}
    </ProtectedRoute>
  );
}
