"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/venta", label: "Venta" },
  { href: "/entradas", label: "Entradas" },
  { href: "/stock", label: "Stock" },
  { href: "/admin", label: "Admin" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, logout, configured } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="no-print bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold tracking-tight">🏡 Patio Curauma</span>
            <nav className="flex gap-1">
              {NAV.map((n) => {
                const active = path === n.href || path.startsWith(n.href + "/");
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`px-3 py-1.5 rounded text-sm ${
                      active ? "bg-emerald-500 text-slate-900 font-semibold" : "hover:bg-slate-700"
                    }`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="text-xs flex items-center gap-3">
            {configured && user && (
              <>
                <span className="text-slate-300">{user.email}</span>
                <button onClick={() => logout()} className="underline hover:text-emerald-400">
                  Salir
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
