"use client";

import { History, Plus, Pencil, Tag, Boxes, FileText, Hash, Power, PauseCircle, UserPlus, Barcode, DollarSign } from "lucide-react";
import type { AccionMovEmprendedor, MovimientoEmprendedor } from "@/lib/types";
import { money } from "@/lib/format";

// Mapa de presentación por acción: ícono, color del badge y etiqueta corta.
const PRESENT: Record<
  AccionMovEmprendedor,
  { Icon: typeof History; color: string; label: string }
> = {
  producto_agregado: { Icon: Plus, color: "bg-emerald-100 text-emerald-700", label: "Producto agregado" },
  precio_cambiado: { Icon: Tag, color: "bg-amber-100 text-amber-700", label: "Precio" },
  stock_cambiado: { Icon: Boxes, color: "bg-cyan-100 text-cyan-700", label: "Stock" },
  descripcion_cambiada: { Icon: FileText, color: "bg-slate-100 text-slate-700", label: "Descripción" },
  barcode_cambiado: { Icon: Barcode, color: "bg-slate-100 text-slate-700", label: "Código de barras" },
  codigo_renombrado: { Icon: Hash, color: "bg-violet-100 text-violet-700", label: "Código" },
  costo_cambiado: { Icon: DollarSign, color: "bg-slate-100 text-slate-700", label: "Costo" },
  emprendedor_creado: { Icon: UserPlus, color: "bg-emerald-100 text-emerald-700", label: "Emprendedor creado" },
  emprendedor_editado: { Icon: Pencil, color: "bg-slate-100 text-slate-700", label: "Datos" },
  emprendedor_activado: { Icon: Power, color: "bg-emerald-100 text-emerald-700", label: "Reactivado" },
  emprendedor_pausado: { Icon: PauseCircle, color: "bg-amber-100 text-amber-700", label: "Pausado" },
};

function fmtFechaHora(en: number): string {
  return new Date(en).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Si la acción es de precio/costo, formateamos como CLP. El resto se muestra como string.
function fmtValor(accion: AccionMovEmprendedor, v: string | undefined): string {
  if (v === undefined || v === null || v === "") return "—";
  if (accion === "precio_cambiado" || accion === "costo_cambiado") {
    const n = Number(v);
    return Number.isFinite(n) ? money(n) : v;
  }
  return v;
}

export function HistorialMovs({
  movs,
  vacio = "Sin movimientos registrados.",
}: {
  movs: MovimientoEmprendedor[];
  vacio?: string;
}) {
  if (movs.length === 0) {
    return <p className="text-slate-400 text-sm py-3 text-center">{vacio}</p>;
  }
  return (
    <ul className="divide-y">
      {movs.map((m, i) => {
        const p = PRESENT[m.accion] ?? PRESENT.emprendedor_editado;
        const { Icon } = p;
        const hayValores = m.antes !== undefined || m.despues !== undefined;
        return (
          <li key={i} className="py-2.5 flex items-start gap-3">
            <span
              className={`shrink-0 rounded-lg p-1.5 ${p.color}`}
              aria-hidden
            >
              <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-0.5">
                <div className="text-sm font-semibold text-slate-800">
                  {p.label}
                  {m.codigo && (
                    <span className="ml-1.5 font-mono text-[11px] text-slate-500">
                      {m.codigo}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {fmtFechaHora(m.en)}
                </div>
              </div>
              {m.descripcion && (
                <div className="text-xs text-slate-500 truncate">
                  {m.descripcion}
                </div>
              )}
              {hayValores && (
                <div className="text-xs text-slate-600 mt-0.5">
                  <span className="text-slate-400 line-through">
                    {fmtValor(m.accion, m.antes)}
                  </span>
                  <span className="mx-1.5 text-slate-400">→</span>
                  <span className="font-semibold">
                    {fmtValor(m.accion, m.despues)}
                  </span>
                </div>
              )}
              <div className="text-[11px] text-slate-400 mt-0.5">
                {m.por || "—"}
                <span className="ml-1.5 inline-block bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  {m.origen === "admin" ? "Admin" : "Emprendedor"}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
