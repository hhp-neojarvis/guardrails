import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { authClient } from "../lib/auth-client";

interface AuthContext {
  user: { id: string; name: string; email: string } | null;
  session: { id: string } | null;
  role: string | null;
  companyId: string | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: sessionData, isPending } = authClient.useSession();

  const [appContext, setAppContext] = useState<{
    role: string;
    companyId: string;
  } | null>(null);

  useEffect(() => {
    if (sessionData?.user) {
      fetch("http://api.guardrails.localhost:1355/api/me", {
        credentials: "include",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (data) =>
            data && setAppContext({ role: data.role, companyId: data.companyId })
        )
        .catch(() => setAppContext(null));
    } else {
      setAppContext(null);
    }
  }, [sessionData?.user?.id]);

  const signOut = async () => {
    await authClient.signOut();
    setAppContext(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user: sessionData?.user ?? null,
        session: sessionData?.session ?? null,
        role: appContext?.role ?? null,
        companyId: appContext?.companyId ?? null,
        isLoading: isPending,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
