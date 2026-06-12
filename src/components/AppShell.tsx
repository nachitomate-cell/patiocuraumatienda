"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ShoppingCart,
  PackagePlus,
  Boxes,
  History,
  Settings,
  LogOut,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUiMode } from "@/lib/uimode";

const NAV = [
  { href: "/venta", label: "Venta", Icon: ShoppingCart },
  { href: "/entradas", label: "Entradas", Icon: PackagePlus },
  { href: "/stock", label: "Stock", Icon: Boxes },
  { href: "/historial", label: "Historial", Icon: History },
  { href: "/admin", label: "Admin", Icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, logout, configured } = useAuth();
  const { mode, toggle } = useUiMode();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="no-print bg-slate-900 text-white shadow-md">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Image
              src="/logo.png"
              alt="Patio Curauma"
              width={40}
              height={52}
              className="h-11 w-auto drop-shadow"
              priority
            />
            <span className="font-bold tracking-tight hidden sm:block">Patio Curauma</span>
            <nav className="flex gap-1 ml-2">
              {NAV.map(({ href, label, Icon }) => {
                const active = path === href || path.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      active
                        ? "bg-cyan-500 text-slate-900 font-semibold"
                        : "hover:bg-slate-700 text-slate-200"
                    }`}
                  >
                    <Icon size={18} strokeWidth={2.2} />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="text-xs flex items-center gap-2">
            {configured && user && (
              <>
                <span className="text-slate-300 hidden md:inline">{user.email}</span>
                <button
                  onClick={() => logout()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-700"
                  title="Cerrar sesión"
                >
                  <LogOut size={16} />
                  <span className="hidden sm:inline">Salir</span>
                </button>
              </>
            )}
            <button
              onClick={toggle}
              title="Cambiar tamaño de la vista"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 hover:bg-slate-700 font-semibold whitespace-nowrap"
            >
              {mode === "grande" ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
              <span className="hidden sm:inline">
                {mode === "grande" ? "Vista normal" : "Vista grande"}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main
        className={`flex-1 mx-auto w-full max-w-6xl px-4 py-6 ${
          mode === "grande" ? "modo-grande" : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
