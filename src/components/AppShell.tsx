"use client";

import { useEffect, useRef, useState } from "react";
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
  LogIn,
  Receipt,
  MoreHorizontal,
  ChevronDown,
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
  { href: "/historial", label: "Historial", Icon: History },
  { href: "/entradas", label: "Entradas", Icon: PackagePlus },
  { href: "/stock", label: "Stock", Icon: Boxes },
  { href: "/etiquetas", label: "Etiquetas", Icon: Barcode },
  { href: "/emprendedores", label: "Emprendedores", Icon: Store },
  { href: "/crm", label: "CRM", Icon: BarChart3 },
];

// Menú agrupado para descongestionar el header en desktop.
const OTROS = [
  { href: "/fiados", label: "Fiados", Icon: Notebook },
  { href: "/boleta", label: "Boleta", Icon: Receipt },
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
  const [otrosAbierto, setOtrosAbierto] = useState(false);
  const otrosRef = useRef<HTMLDivElement>(null);

  // Cierra el dropdown "Otros" al hacer click fuera o presionar Escape.
  useEffect(() => {
    if (!otrosAbierto) return;
    function fueraClick(e: MouseEvent) {
      if (otrosRef.current && !otrosRef.current.contains(e.target as Node)) {
        setOtrosAbierto(false);
      }
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOtrosAbierto(false);
    }
    document.addEventListener("mousedown", fueraClick);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fueraClick);
      document.removeEventListener("keydown", esc);
    };
  }, [otrosAbierto]);

  // Cierra el dropdown al navegar.
  useEffect(() => {
    setOtrosAbierto(false);
  }, [path]);

  const otrosActive = OTROS.some((o) => path === o.href || path.startsWith(o.href + "/"));

  // Hidratación: useVendedor devuelve "" en SSR. Esperamos al primer efecto
  // para conocer el valor real de localStorage; así evitamos el flash de la
  // pantalla de ingreso a quienes ya tienen vendedor guardado.
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => {
    setHidratado(true);
  }, []);

  // Atajos globales: Alt+1..9 navega a cada sección; "?" abre la ayuda.
  useAtajos({
    ...Object.fromEntries(
      NAV.slice(0, 9).map((item, i) => [`alt+${i + 1}`, () => router.push(item.href)])
    ),
    "?": () => setAyuda((a) => !a),
  });

  // Mientras hidratamos, no renderizamos nada para no parpadear entre la
  // pantalla de ingreso y la app.
  if (!hidratado) return null;

  // Sin vendedor: gate a pantalla completa. Nadie ve la app hasta tipear
  // su nombre. Salir = vaciar el chip del header (queda en localStorage).
  if (!vendedor) return <PantallaIngresoVendedor />;

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

            <div ref={otrosRef} className="relative shrink-0">
              <button
                onClick={() => setOtrosAbierto((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={otrosAbierto}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  otrosActive
                    ? "bg-cyan-500 text-slate-900 font-semibold"
                    : "hover:bg-slate-700 text-slate-200"
                }`}
              >
                <MoreHorizontal size={18} strokeWidth={2.2} />
                <span className="hidden xl:inline">Otros</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${otrosAbierto ? "rotate-180" : ""}`}
                />
              </button>
              {otrosAbierto && (
                <div
                  role="menu"
                  className="absolute left-0 sm:left-auto sm:right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 min-w-[180px] z-50 anim-pop"
                >
                  {OTROS.map(({ href, label, Icon }) => {
                    const active = path === href || path.startsWith(href + "/");
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setOtrosAbierto(false)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm ${
                          active
                            ? "bg-cyan-500 text-slate-900 font-semibold"
                            : "text-slate-200 hover:bg-slate-700"
                        }`}
                      >
                        <Icon size={16} strokeWidth={2.2} /> {label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
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

// Pantalla "panel" de bienvenida que pregunta quién vino a trabajar hoy.
// Bloquea el acceso al POS hasta que el operador tipea su nombre. El nombre
// queda en localStorage del dispositivo (mismo storage que el chip del
// header), así que se mantiene entre sesiones del navegador.
function PantallaIngresoVendedor() {
  const NEGOCIO = useNegocio();
  const [nombre, setNombre] = useState("");

  function ingresar(e: React.FormEvent) {
    e.preventDefault();
    const n = nombre.trim();
    if (!n) return;
    setVendedor(n);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full anim-pop">
        <div className="flex flex-col items-center text-center mb-6">
          <Image
            src={NEGOCIO.logo}
            alt={NEGOCIO.nombre}
            width={88}
            height={88}
            className="h-20 w-auto mb-3"
            priority
          />
          <h1 className="text-2xl font-bold text-slate-900">{NEGOCIO.nombre}</h1>
          {NEGOCIO.eslogan && (
            <p className="text-[10px] uppercase tracking-[0.25em] text-amber-600 mt-1">
              {NEGOCIO.eslogan}
            </p>
          )}
        </div>

        <h2 className="text-lg font-semibold text-slate-800">
          ¿Quién vino a trabajar hoy?
        </h2>
        <p className="text-sm text-slate-500 mt-1 mb-4">
          Escribe tu nombre para entrar. Quedará registrado en las ventas,
          entradas y devoluciones que hagas en este equipo.
        </p>

        <form onSubmit={ingresar}>
          <input
            autoFocus
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Camila"
            className="w-full border-2 rounded-xl px-4 py-3 text-lg"
          />
          <button
            type="submit"
            disabled={!nombre.trim()}
            className="mt-3 w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-xl py-3 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <LogIn size={18} /> Entrar
          </button>
        </form>

        <p className="text-[11px] text-slate-400 text-center mt-4">
          Si te equivocaste de cuenta, después puedes cambiarte desde el chip
          del encabezado.
        </p>
      </div>
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
