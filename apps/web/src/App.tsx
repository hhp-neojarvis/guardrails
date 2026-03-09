import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "./hooks/useAuth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import { LoginPage } from "./pages/LoginPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { UserManagementPage } from "./pages/UserManagementPage";
import { MetaAccountsPage } from "./pages/MetaAccountsPage";
import { UploadPage } from "./pages/UploadPage";
import { GuardrailsPage } from "./pages/GuardrailsPage";
import { JobsPage } from "./pages/JobsPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { ValidationPage } from "./pages/ValidationPage";
import { ValidationReportPage } from "./pages/ValidationReportPage";
import { Layout } from "./components/Layout";

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Layout>
              <DashboardPage />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/users" element={
          <AdminRoute>
            <Layout>
              <UserManagementPage />
            </Layout>
          </AdminRoute>
        } />
        <Route path="/settings/meta-accounts" element={
          <ProtectedRoute>
            <Layout>
              <MetaAccountsPage />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/upload" element={
          <ProtectedRoute>
            <Layout>
              <UploadPage />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/guardrails" element={
          <ProtectedRoute>
            <Layout>
              <GuardrailsPage />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/jobs" element={
          <ProtectedRoute>
            <Layout>
              <JobsPage />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/jobs/:id" element={
          <ProtectedRoute>
            <Layout>
              <JobDetailPage />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/jobs/:id/validate" element={
          <ProtectedRoute>
            <Layout>
              <ValidationPage />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/jobs/:id/report" element={
          <ProtectedRoute>
            <Layout>
              <ValidationReportPage />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
