"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { LOGIN_HABILITADO } from "@/lib/config";
import { useNegocio } from "@/lib/negocio-context";
import { negocioActivo } from "@/lib/tenant";

// Envuelve las paginas privadas del POS: exige login y que el usuario pertenezca
// al negocio del subdominio (o sea moderador). Avisa si Firebase no esta
// configurado.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, usuario, loading, configured, login, logout } = useAuth();
  const NEGOCIO = useNegocio();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [recordar, setRecordar] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <Aviso titulo="Falta configurar Firebase">
        Copia <code className="bg-amber-100 px-1 rounded">.env.local.example</code> como{" "}
        <code className="bg-amber-100 px-1 rounded">.env.local</code> y completa las claves de tu
        proyecto Firebase. Luego reinicia el servidor (<code>npm run dev</code>).
      </Aviso>
    );
  }

  if (loading) {
    return <div className="mt-20 text-center text-slate-500">Cargando…</div>;
  }

  // Modo presentación (sin login): basta con un usuario anónimo.
  if (!LOGIN_HABILITADO) {
    if (user) return <>{children}</>;
    return (
      <Aviso titulo="Falta habilitar el acceso anónimo">
        El login está desactivado para la presentación. Habilita el acceso anónimo en Firebase
        Console → <b>Authentication → Sign-in method → Anónimo → Habilitar</b>, y recarga.
      </Aviso>
    );
  }

  // Login requerido: usuario real (no anónimo).
  if (!user || user.isAnonymous) {
    const conFondo = Boolean(NEGOCIO.fondoLogin);
    return (
      <div className="relative min-h-screen flex items-center justify-center p-4">
        {/* Fondo: imagen del negocio (si tiene) + degradado para legibilidad. */}
        {conFondo && (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${NEGOCIO.fondoLogin})` }}
            aria-hidden
          />
        )}
        <div
          className={`absolute inset-0 ${
            conFondo
              ? "bg-gradient-to-b from-slate-900/70 via-slate-900/60 to-slate-900/80"
              : "bg-slate-50"
          }`}
          aria-hidden
        />
        <div
          className={`relative w-full max-w-sm rounded-2xl p-6 anim-in ${
            conFondo
              ? "bg-white/95 backdrop-blur-md shadow-2xl ring-1 ring-white/40"
              : "bg-white shadow"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={NEGOCIO.logo} alt={NEGOCIO.nombre} className="h-20 w-auto mx-auto mb-3" />
          <h1 className="text-xl font-bold text-slate-900 mb-1 text-center">Ingresar</h1>
          <p className="text-sm text-slate-500 mb-4 text-center">
            {NEGOCIO.nombre} — punto de venta
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setErr("");
              setBusy(true);
              try {
                await login(email.trim(), pass, recordar);
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
              placeholder={NEGOCIO.emailPlaceholder}
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
            <label className="flex items-center gap-2 text-sm text-slate-600 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
              />
              Mantener la sesión iniciada
            </label>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button
              disabled={busy}
              className="btn-accion w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50"
            >
              {busy ? "Ingresando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Usuario real: verificar que pertenece a este negocio (o es moderador).
  const negId = negocioActivo();
  const esModerador = usuario?.rol === "moderador";
  const pertenece = !!usuario && usuario.negocioId === negId;
  if (!esModerador && !pertenece) {
    return (
      <Aviso titulo="No tienes acceso a este negocio">
        Tu usuario no pertenece a <b>{negId}</b>. Verifica que entraste por el subdominio correcto.{" "}
        <button onClick={logout} className="underline font-medium">
          Cerrar sesión
        </button>
      </Aviso>
    );
  }

  return <>{children}</>;
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl mt-16 bg-amber-50 border border-amber-300 rounded-lg p-6">
      <h1 className="text-lg font-bold text-amber-900">{titulo}</h1>
      <p className="mt-2 text-sm text-amber-900">{children}</p>
    </div>
  );
}
