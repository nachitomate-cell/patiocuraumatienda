"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import { getAuthInstance, isFirebaseConfigured } from "./firebase";
import { setNegocioActivo, subdominioDeNegocio } from "./tenant";

// Sin login para el POS: el tenant se decide por el subdominio. Solo se
// mantiene una sesión anónima para que Firestore tenga un token válido en las
// llamadas. El panel /moderador maneja su propio login internamente.

interface AuthCtx {
  user: User | null;
  loading: boolean;
  configured: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Resuelve el negocio activo desde el subdominio antes de tocar Firestore.
    setNegocioActivo(subdominioDeNegocio());
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(getAuthInstance(), (u) => {
      if (!u) {
        // Sin sesión: entra anónimo. onAuthStateChanged se re-dispara con el
        // usuario anónimo apenas Firebase termina el sign-in.
        signInAnonymously(getAuthInstance()).catch(() => setLoading(false));
        return;
      }
      setUser(u);
      setLoading(false);
    });
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, configured: isFirebaseConfigured }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return c;
}
