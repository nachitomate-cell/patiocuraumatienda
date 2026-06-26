"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalIcon, ChevronLeft, ChevronRight } from "lucide-react";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

function isoAFecha(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fechaAIso(f: Date): string {
  const y = f.getFullYear();
  const m = String(f.getMonth() + 1).padStart(2, "0");
  const d = String(f.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function formatear(iso: string): string {
  const f = isoAFecha(iso);
  if (!f) return "";
  return `${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(
    2,
    "0"
  )}/${f.getFullYear()}`;
}

interface Props {
  value: string; // ISO yyyy-mm-dd o ""
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
}

// Calendario propio en español, formato día/mes/año. Devuelve ISO yyyy-mm-dd.
// El popup se renderiza con createPortal + position fixed para escapar cualquier
// stacking context o overflow de los contenedores padres (sin esto, cards que
// vienen después en el DOM lo tapan).
export function SelectorFecha({ value, onChange, placeholder = "dd/mm/aaaa", className = "" }: Props) {
  const [abierto, setAbierto] = useState(false);
  const sel = isoAFecha(value);
  const [cursor, setCursor] = useState<Date>(sel ?? new Date());
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function recolocar() {
    const t = trigger.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const ancho = 288; // w-72 (Tailwind)
    const margen = 8;
    let left = r.left;
    if (left + ancho > window.innerWidth - margen) {
      left = Math.max(margen, window.innerWidth - ancho - margen);
    }
    setPos({ top: r.bottom + 4, left });
  }

  useLayoutEffect(() => {
    if (!abierto) return;
    recolocar();
    function onMove() {
      recolocar();
    }
    // Capture true para enterarse de scrolls de contenedores anidados.
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [abierto]);

  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (!abierto) return;
      const tgt = e.target as Node;
      if (trigger.current?.contains(tgt)) return;
      if (pop.current?.contains(tgt)) return;
      setAbierto(false);
    }
    if (abierto) document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  useEffect(() => {
    const f = isoAFecha(value);
    if (f) setCursor(f);
  }, [value]);

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const primerDia = (new Date(y, m, 1).getDay() + 6) % 7; // lunes = 0
  const diasMes = new Date(y, m + 1, 0).getDate();
  const celdas: (number | null)[] = [];
  for (let i = 0; i < primerDia; i++) celdas.push(null);
  for (let d = 1; d <= diasMes; d++) celdas.push(d);

  const hoyIso = fechaAIso(new Date());

  const popup = abierto && pos && (
    <div
      ref={pop}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}
      className="w-72 max-w-[88vw] bg-white rounded-xl shadow-xl border border-slate-200 p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCursor(new Date(y, m - 1, 1))}
          className="p-1.5 rounded-lg hover:bg-slate-100"
          aria-label="Mes anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="font-semibold text-slate-800 capitalize">
          {MESES[m]} {y}
        </span>
        <button
          type="button"
          onClick={() => setCursor(new Date(y, m + 1, 1))}
          className="p-1.5 rounded-lg hover:bg-slate-100"
          aria-label="Mes siguiente"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400 mb-1">
        {DIAS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {celdas.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = fechaAIso(new Date(y, m, d));
          const esSel = iso === value;
          const esHoy = iso === hoyIso;
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                onChange(iso);
                setAbierto(false);
              }}
              className={`h-9 rounded-lg text-sm transition-colors ${
                esSel
                  ? "bg-cyan-600 text-white font-semibold"
                  : esHoy
                  ? "border border-cyan-400 text-cyan-700"
                  : "hover:bg-slate-100 text-slate-700"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="flex justify-between mt-2 text-sm">
        <button
          type="button"
          onClick={() => {
            onChange("");
            setAbierto(false);
          }}
          className="text-slate-500 hover:underline"
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(hoyIso);
            setAbierto(false);
          }}
          className="text-cyan-700 font-semibold hover:underline"
        >
          Hoy
        </button>
      </div>
    </div>
  );

  return (
    <div className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="w-full border rounded-lg px-3 py-2 flex items-center justify-between gap-2 bg-white text-left"
      >
        <span className={value ? "text-slate-800" : "text-slate-400"}>
          {value ? formatear(value) : placeholder}
        </span>
        <CalIcon size={16} className="text-slate-400 shrink-0" />
      </button>

      {popup && typeof document !== "undefined"
        ? createPortal(popup, document.body)
        : null}
    </div>
  );
}
