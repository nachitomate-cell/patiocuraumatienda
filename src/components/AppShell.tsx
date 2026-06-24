"use client";

import { useEffect, useState } from "react";
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
  ZoomIn,
  ZoomOut,
  Keyboard,
  UserCircle2,
  Wallet,
} from "lucide-react";
import { useUiMode } from "@/lib/uimode";
import { useAtajos } from "@/lib/useAtajos";
import { AtajosAyuda } from "@/components/AtajosAyuda";
import { useNegocio } from "@/lib/negocio-context";
import { useVendedor, setVendedor } from "@/lib/vendedor";
import { Modal } from "@/components/Modal";

const NAV = [
  { href: "/venta", label: "Venta", Icon: ShoppingCart },
  { href: "/caja", label: "Caja", Icon: Wallet },
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
  const { mode, toggle } = useUiMode();
  const NEGOCIO = useNegocio();
  const vendedor = useVendedor();
  const [ayuda, setAyuda] = useState(false);
  const [editarVendedor, setEditarVendedor] = useState(false);

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
            src={NEGOCIO.logo}
            alt={NEGOCIO.nombre}
            width={40}
            height={52}
            className="h-9 sm:h-11 w-auto shrink-0 drop-shadow-[0_2px_8px_rgba(232,163,61,0.35)]"
            priority
          />
          <span className="hidden lg:flex flex-col leading-none shrink-0">
            <span className="font-bold tracking-tight text-base">{NEGOCIO.nombre}</span>
            {NEGOCIO.eslogan && (
              <span className="text-[10px] uppercase tracking-[0.25em] text-amber-300/80">
                {NEGOCIO.eslogan}
              </span>
            )}
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
            <button
              onClick={() => setEditarVendedor(true)}
              title="Vendedor actual (toca para cambiar)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-600 hover:bg-slate-700 max-w-[180px]"
            >
              <UserCircle2 size={16} className="shrink-0" />
              <span className="truncate">{vendedor || "Sin vendedor"}</span>
            </button>
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
      <ModalVendedor
        abierto={editarVendedor}
        actual={vendedor}
        onCerrar={() => setEditarVendedor(false)}
      />

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

function ModalVendedor({
  abierto,
  actual,
  onCerrar,
}: {
  abierto: boolean;
  actual: string;
  onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(actual);
  // Sincroniza el input con el valor actual cada vez que se reabre.
  useEffect(() => {
    if (abierto) setNombre(actual);
  }, [abierto, actual]);

  function guardar() {
    setVendedor(nombre);
    onCerrar();
  }

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Vendedor en este dispositivo" maxW="max-w-sm">
      <p className="text-sm text-slate-500 mb-3">
        Tu nombre se guarda en este dispositivo y queda registrado en las ventas y entradas que
        hagas.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          guardar();
        }}
      >
        <input
          autoFocus
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Camila"
          className="w-full border-2 rounded-xl px-4 py-2.5 text-lg"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="btn-accion bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg px-4 py-2.5"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-accion bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2.5"
          >
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}
