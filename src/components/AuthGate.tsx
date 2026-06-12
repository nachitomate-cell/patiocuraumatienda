"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";

// Envuelve las paginas privadas: exige login y avisa si Firebase no esta configurado.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, configured, login } = useAuth();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <div className="mx-auto max-w-xl mt-16 bg-amber-50 border border-amber-300 rounded-lg p-6">
        <h1 className="text-lg font-bold text-amber-900">Falta configurar Firebase</h1>
        <p className="mt-2 text-sm text-amber-900">
          Copia <code className="bg-amber-100 px-1 rounded">.env.local.example</code> como{" "}
          <code className="bg-amber-100 px-1 rounded">.env.local</code> y completa las claves de tu
          proyecto Firebase. Luego reinicia el servidor (<code>npm run dev</code>).
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="mt-20 text-center text-slate-500">Cargando…</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-sm mt-16 bg-white rounded-xl shadow p-6">
        <h1 className="text-xl font-bold text-slate-900 mb-1">Ingresar</h1>
        <p className="text-sm text-slate-500 mb-4">Patio Curauma — punto de venta</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setErr("");
            setBusy(true);
            try {
              await login(email.trim(), pass);
            } catch {
              setErr("Correo o contraseña incorrectos.");
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-3"
        >
          <input
            type="email"
            required
            placeholder="correo@patiocurauma.cl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          <input
            type="password"
            required
            placeholder="contraseña"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            disabled={busy}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-semibold rounded py-2 disabled:opacity-50"
          >
            {busy ? "Ingresando…" : "Entrar"}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
