"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type User,
} from "firebase/auth";
import { getAuthInstance, isFirebaseConfigured } from "./firebase";
import { setNegocioActivo, subdominioDeNegocio } from "./tenant";
import { getUsuario, type Usuario } from "./admin";

interface AuthCtx {
  user: User | null;
  // Perfil del usuario (rol + negocio). null si es anónimo o no tiene perfil.
  usuario: Usuario | null;
  loading: boolean;
  configured: boolean;
  // recordar=true (por defecto) mantiene la sesión al cerrar el navegador
  // (persistencia local); false la limita a la pestaña actual (persistencia
  // de sesión).
  login: (email: string, pass: string, recordar?: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Resuelve el negocio activo desde el subdominio antes de tocar Firestore.
    // (El login confirmará luego que el usuario pertenece a este negocio.)
    setNegocioActivo(subdominioDeNegocio());
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(getAuthInstance(), async (u) => {
      // Sin usuario: entra anónimo para que las páginas públicas (/alta)
      // tengan un token válido de Firestore. onAuthStateChanged se re-dispara.
      if (!u) {
        signInAnonymously(getAuthInstance()).catch(() => setLoading(false));
        return;
      }
      setUser(u);
      // Los anónimos no tienen perfil; el AuthGate del POS los tratará como
      // "sin sesión" y mostrará el login.
      if (u.isAnonymous) {
        setUsuario(null);
        setLoading(false);
        return;
      }
      try {
        setUsuario(await getUsuario(u.uid));
      } catch {
        setUsuario(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const value: AuthCtx = {
    user,
    usuario,
    loading,
    configured: isFirebaseConfigured,
    login: async (email, pass, recordar = true) => {
      const auth = getAuthInstance();
      await setPersistence(
        auth,
        recordar ? browserLocalPersistence : browserSessionPersistence
      );
      await signInWithEmailAndPassword(auth, email, pass);
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
