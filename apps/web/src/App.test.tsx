import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("./hooks/useAuth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: null,
    session: null,
    role: null,
    companyId: null,
    isLoading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("./lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
  },
}));

import { AppRoutes } from "./App";

function renderWithRouter(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  it("redirects unauthenticated user from /dashboard to /login", () => {
    renderWithRouter(["/dashboard"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Login",
    );
  });

  it("redirects / to /dashboard, then to /login when unauthenticated", () => {
    renderWithRouter(["/"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Login",
    );
  });

  it("renders login page at /login", () => {
    renderWithRouter(["/login"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Login",
    );
  });

  it("renders accept invite page at /accept-invite", () => {
    renderWithRouter(["/accept-invite"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Accept Invite",
    );
  });

  it("login page renders email and password fields", () => {
    renderWithRouter(["/login"]);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
  });

  it("accept invite page without token shows error message", () => {
    renderWithRouter(["/accept-invite"]);
    expect(screen.getByText("Invalid invitation link — no token provided.")).toBeInTheDocument();
  });

  it("accept invite page with token shows password form", () => {
    renderWithRouter(["/accept-invite?token=test-token-123"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Set Password",
    );
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set Password" })).toBeInTheDocument();
  });
});
