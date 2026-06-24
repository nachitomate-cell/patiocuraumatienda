"use client";

import { useAuth } from "@/lib/auth";

// Envuelve las páginas del POS. Sin login: solo espera que esté listo el
// token (anónimo) de Firebase y avisa si Firebase no está configurado. La
// diferenciación de negocio se hace por subdominio (ver tenant.ts).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();

  if (!configured) {
    return (
      <Aviso titulo="Falta configurar Firebase">
        Copia <code className="bg-amber-100 px-1 rounded">.env.local.example</code> como{" "}
        <code className="bg-amber-100 px-1 rounded">.env.local</code> y completa las claves de tu
        proyecto Firebase. Luego reinicia el servidor (<code>npm run dev</code>).
      </Aviso>
    );
  }

  if (loading || !user) {
    return <div className="mt-20 text-center text-slate-500">Cargando…</div>;
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
