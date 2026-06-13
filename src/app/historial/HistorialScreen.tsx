"use client";

import { useEffect, useMemo, useState } from "react";
import {
  History,
  Search,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
} from "lucide-react";
import * as XLSX from "xlsx";
import { ultimasVentas } from "@/lib/repo";
import { subtotalLinea, type Venta } from "@/lib/types";
import { money, hoyISO } from "@/lib/format";
import { SelectorFecha } from "@/components/SelectorFecha";

export function HistorialScreen() {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      setVentas(await ultimasVentas(300));
    } catch {
      setError("No se pudo cargar el historial. Revise conexión o reglas de Firestore.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const filtradas = useMemo(() => {
    const t = term.trim().toLowerCase();
    return ventas.filter((v) => {
      if (desde && v.fecha < desde) return false;
      if (hasta && v.fecha > hasta) return false;
      if (!t) return true;
      return (
        v.nro.toLowerCase().includes(t) ||
        (v.cliente || "").toLowerCase().includes(t) ||
        (v.vendedor || "").toLowerCase().includes(t)
      );
    });
  }, [ventas, term, desde, hasta]);

  const resumen = useMemo(() => {
    let total = 0,
      unidades = 0;
    for (const v of filtradas) {
      total += v.total || 0;
      unidades += v.items.reduce((s, l) => s + l.cantidad, 0);
    }
    return { total, unidades, n: filtradas.length };
  }, [filtradas]);

  function exportar() {
    const filas = filtradas.flatMap((v) =>
      v.items.map((l) => ({
        Nro: v.nro,
        Fecha: v.fecha,
        Cliente: v.cliente,
        Vendedor: v.vendedor ?? "",
        Codigo: l.codigo,
        Descripcion: l.descripcion,
        Cantidad: l.cantidad,
        "Valor venta": l.precio,
        "Dscto%": l.descuento,
        Subtotal: subtotalLinea(l),
      }))
    );
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SALIDAS");
    XLSX.writeFile(wb, `ventas_patio_${hoyISO()}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <History className="text-cyan-600" size={22} /> Historial de ventas
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={exportar}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-3 py-2 text-sm"
            >
              <Download size={16} /> Exportar
            </button>
            <button
              onClick={cargar}
              className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm"
            >
              <RefreshCw size={16} /> Refrescar
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <div className="relative sm:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar por N° venta, cliente o vendedor…"
              className="w-full border rounded-lg pl-9 pr-3 py-2"
            />
          </div>
          <div className="text-sm">
            <span className="text-slate-500">Desde</span>
            <SelectorFecha value={desde} onChange={setDesde} className="mt-1" />
          </div>
          <div className="text-sm">
            <span className="text-slate-500">Hasta</span>
            <SelectorFecha value={hasta} onChange={setHasta} className="mt-1" />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span className="text-slate-500">
            Ventas: <b className="text-slate-800">{resumen.n}</b>
          </span>
          <span className="text-slate-500">
            Unidades: <b className="text-slate-800">{resumen.unidades}</b>
          </span>
          <span className="text-slate-500">
            Total vendido: <b className="text-emerald-700">{money(resumen.total)}</b>
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow tabla-scroll anim-in">
        <table className="w-full text-sm min-w-[620px]">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="w-8"></th>
              <th className="text-left px-3 py-2">N° venta</th>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-right px-3 py-2">Ítems</th>
              <th className="text-right px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  Cargando historial…
                </td>
              </tr>
            )}
            {!cargando && error && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-red-500">
                  {error}
                </td>
              </tr>
            )}
            {!cargando && !error && filtradas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  No hay ventas registradas
                </td>
              </tr>
            )}
            {filtradas.map((v) => {
              const abierto = abierta === v.nro;
              return (
                <FilaVenta
                  key={v.nro}
                  venta={v}
                  abierto={abierto}
                  onToggle={() => setAbierta(abierto ? null : v.nro)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaVenta({
  venta: v,
  abierto,
  onToggle,
}: {
  venta: Venta;
  abierto: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t hover:bg-slate-50 cursor-pointer" onClick={onToggle}>
        <td className="px-2 text-slate-400 text-center">
          {abierto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </td>
        <td className="px-3 py-2 font-mono">{v.nro}</td>
        <td className="px-3 py-2">{v.fecha}</td>
        <td className="px-3 py-2">{v.cliente}</td>
        <td className="px-3 py-2 text-right">{v.items.length}</td>
        <td className="px-3 py-2 text-right font-semibold">{money(v.total)}</td>
      </tr>
      {abierto && (
        <tr className="bg-slate-50">
          <td></td>
          <td colSpan={5} className="px-3 py-2">
            <table className="w-full text-xs anim-pop">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left py-1">Código</th>
                  <th className="text-left py-1">Descripción</th>
                  <th className="text-right py-1">Cant.</th>
                  <th className="text-right py-1">Precio</th>
                  <th className="text-right py-1">Dscto</th>
                  <th className="text-right py-1">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {v.items.map((l, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="py-1 font-mono">{l.codigo}</td>
                    <td className="py-1">{l.descripcion}</td>
                    <td className="py-1 text-right">{l.cantidad}</td>
                    <td className="py-1 text-right">{money(l.precio)}</td>
                    <td className="py-1 text-right">{l.descuento}%</td>
                    <td className="py-1 text-right font-semibold">{money(subtotalLinea(l))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {v.vendedor && (
              <div className="text-xs text-slate-400 mt-1">Vendedor: {v.vendedor}</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
