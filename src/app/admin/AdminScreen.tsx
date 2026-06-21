"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Settings,
  Download,
  FileSpreadsheet,
  Store,
  ChevronRight,
  Target,
  Check,
} from "lucide-react";
import * as XLSX from "xlsx";
import { ultimasVentas, getMetaDiaria, guardarMetaDiaria } from "@/lib/repo";
import seed from "@/data/productos.seed.json";
import type { Producto, Venta } from "@/lib/types";
import { money } from "@/lib/format";
import { useNegocio } from "@/lib/negocio-context";

export function AdminScreen() {
  const NEGOCIO = useNegocio();
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(0);
  const [cargandoMeta, setCargandoMeta] = useState(true);
  const [guardandoMeta, setGuardandoMeta] = useState(false);
  const [metaGuardada, setMetaGuardada] = useState(false);

  useEffect(() => {
    getMetaDiaria()
      .then(setMeta)
      .catch(() => {})
      .finally(() => setCargandoMeta(false));
  }, []);

  async function guardarMeta() {
    setGuardandoMeta(true);
    setMetaGuardada(false);
    try {
      await guardarMetaDiaria(meta);
      setMetaGuardada(true);
      setTimeout(() => setMetaGuardada(false), 2500);
    } finally {
      setGuardandoMeta(false);
    }
  }

  async function exportarVentas() {
    setBusy(true);
    try {
      const ventas: Venta[] = await ultimasVentas(500);
      const filas = ventas.flatMap((v) =>
        v.items.map((l) => ({
          Nro: v.nro,
          Fecha: v.fecha,
          Cliente: v.cliente,
          Codigo: l.codigo,
          Descripcion: l.descripcion,
          Cantidad: l.cantidad,
          Precio: l.precio,
          "Dscto%": l.descuento,
          Subtotal: l.cantidad * l.precio * (1 - l.descuento / 100),
        }))
      );
      const ws = XLSX.utils.json_to_sheet(filas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "SALIDAS");
      XLSX.writeFile(wb, `ventas_${NEGOCIO.slug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  function exportarCatalogo() {
    const ws = XLSX.utils.json_to_sheet(seed as Producto[]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "STOCK");
    XLSX.writeFile(wb, `catalogo_${NEGOCIO.slug}.xlsx`);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h1 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
          <Settings className="text-cyan-600" size={22} /> Administración
        </h1>
        <p className="text-sm text-slate-500">
          Emprendedores y respaldos de tus datos a archivo.
        </p>
      </div>

      <Link
        href="/emprendedores"
        className="bg-white rounded-xl shadow p-4 anim-in flex items-center justify-between hover:bg-slate-50"
      >
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-cyan-100 text-cyan-700">
            <Store size={22} />
          </span>
          <span>
            <span className="block font-semibold text-slate-800">Emprendedores</span>
            <span className="block text-sm text-slate-500">
              Crear emprendedores y generar sus links de carga de productos
            </span>
          </span>
        </span>
        <ChevronRight className="text-slate-400" />
      </Link>

      {/* Meta de venta diaria (la usa el CRM) */}
      <div className="bg-white rounded-xl shadow p-4 space-y-3 anim-in">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Target size={18} className="text-cyan-600" /> Meta de venta diaria
        </h2>
        <p className="text-sm text-slate-500">
          El CRM muestra tu progreso contra esta meta. La semana y el mes se calculan
          automáticamente a partir de la meta diaria.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-sm">
            <span className="text-slate-500">Meta diaria ($)</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={meta || ""}
              onChange={(e) => setMeta(Math.max(0, Number(e.target.value) || 0))}
              placeholder={cargandoMeta ? "…" : "0"}
              className="mt-1 w-44 border-2 rounded-xl px-4 py-2.5 text-lg"
            />
          </label>
          <button
            onClick={guardarMeta}
            disabled={guardandoMeta || cargandoMeta}
            className="btn-accion bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 flex items-center gap-2 disabled:opacity-50"
          >
            {metaGuardada && <Check size={18} />}
            {guardandoMeta ? "Guardando…" : metaGuardada ? "Guardada" : "Guardar meta"}
          </button>
        </div>
        {meta > 0 && (
          <div className="text-sm text-slate-600 flex flex-wrap gap-x-5 gap-y-1">
            <span>Día: <strong className="text-slate-800">{money(meta)}</strong></span>
            <span>Semana (×7): <strong className="text-slate-800">{money(meta * 7)}</strong></span>
            <span>Mes (×30): <strong className="text-slate-800">{money(meta * 30)}</strong></span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-4 space-y-3 anim-in">
        <h2 className="font-semibold text-slate-800">Respaldos a archivo (.xlsx)</h2>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={exportarVentas}
            disabled={busy}
            className="btn-accion bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2.5 flex items-center gap-2 disabled:opacity-50"
          >
            <Download size={18} /> Exportar ventas
          </button>
          <button
            onClick={exportarCatalogo}
            className="btn-accion bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg px-4 py-2.5 flex items-center gap-2"
          >
            <FileSpreadsheet size={18} /> Exportar catálogo
          </button>
        </div>
      </div>
    </div>
  );
}
