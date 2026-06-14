"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ShoppingCart,
  PackagePlus,
  Boxes,
  Barcode,
  History,
  Notebook,
  Store,
  BarChart3,
  Settings,
  LogOut,
  ZoomIn,
  ZoomOut,
  Keyboard,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUiMode } from "@/lib/uimode";
import { useAtajos } from "@/lib/useAtajos";
import { AtajosAyuda } from "@/components/AtajosAyuda";

const NAV = [
  { href: "/venta", label: "Venta", Icon: ShoppingCart },
  { href: "/entradas", label: "Entradas", Icon: PackagePlus },
  { href: "/stock", label: "Stock", Icon: Boxes },
  { href: "/etiquetas", label: "Etiquetas", Icon: Barcode },
  { href: "/fiados", label: "Fiados", Icon: Notebook },
  { href: "/emprendedores", label: "Emprendedores", Icon: Store },
  { href: "/crm", label: "CRM", Icon: BarChart3 },
  { href: "/historial", label: "Historial", Icon: History },
  { href: "/admin", label: "Admin", Icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, logout, configured } = useAuth();
  const { mode, toggle } = useUiMode();
  const [ayuda, setAyuda] = useState(false);

  // Atajos globales: Alt+1..9 navega a cada sección; "?" abre la ayuda.
  useAtajos({
    ...Object.fromEntries(
      NAV.slice(0, 9).map((item, i) => [`alt+${i + 1}`, () => router.push(item.href)])
    ),
    "?": () => setAyuda((a) => !a),
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="no-print bg-slate-900 text-white shadow-md">
        <div className="mx-auto w-full max-w-[1600px] px-2 sm:px-4 h-14 sm:h-16 flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Patio Curauma"
            width={40}
            height={52}
            className="h-9 sm:h-11 w-auto shrink-0 drop-shadow-[0_2px_8px_rgba(232,163,61,0.35)]"
            priority
          />
          <span className="hidden lg:flex flex-col leading-none shrink-0">
            <span className="font-bold tracking-tight text-base">Patio Curauma</span>
            <span className="text-[10px] uppercase tracking-[0.25em] text-amber-300/80">
              Premium POS
            </span>
          </span>
          <nav className="flex gap-0.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
            {NAV.map(({ href, label, Icon }) => {
              const active = path === href || path.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm transition-colors shrink-0 ${
                    active
                      ? "bg-cyan-500 text-slate-900 font-semibold"
                      : "hover:bg-slate-700 text-slate-200"
                  }`}
                >
                  <Icon size={18} strokeWidth={2.2} />
                  <span className="hidden xl:inline">{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="text-xs flex items-center gap-1.5 sm:gap-2 shrink-0">
            {configured && user && !user.isAnonymous && (
              <>
                <span className="text-slate-300 hidden 2xl:inline-block max-w-[150px] truncate align-middle">
                  {user.email}
                </span>
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
              onClick={() => setAyuda(true)}
              title="Atajos de teclado (?)"
              aria-label="Atajos de teclado"
              className="flex items-center justify-center p-1.5 rounded-lg border border-slate-600 hover:bg-slate-700"
            >
              <Keyboard size={16} />
            </button>
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

      <AtajosAyuda abierto={ayuda} onCerrar={() => setAyuda(false)} />

      <main
        className={`flex-1 mx-auto w-full max-w-[1600px] px-2 sm:px-4 py-6 ${
          mode === "grande" ? "modo-grande" : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
