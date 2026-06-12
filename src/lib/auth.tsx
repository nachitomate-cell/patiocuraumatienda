"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  type User,
} from "firebase/auth";
import { getAuthInstance, isFirebaseConfigured } from "./firebase";
import { LOGIN_HABILITADO } from "./config";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  configured: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(getAuthInstance(), (u) => {
      // Modo presentación: si no hay login y no hay usuario, entra anónimo
      // para que Firestore siga funcionando sin pantalla de inicio de sesión.
      if (!u && !LOGIN_HABILITADO) {
        signInAnonymously(getAuthInstance()).catch(() => setLoading(false));
        return;
      }
      setUser(u);
      setLoading(false);
    });
  }, []);

  const value: AuthCtx = {
    user,
    loading,
    configured: isFirebaseConfigured,
    login: async (email, pass) => {
      await signInWithEmailAndPassword(getAuthInstance(), email, pass);
    },
    logout: async () => {
      await signOut(getAuthInstance());
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return c;
}
