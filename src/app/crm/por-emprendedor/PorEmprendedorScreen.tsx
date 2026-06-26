"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Store,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  Loader2,
  Calendar,
} from "lucide-react";
import {
  listarEmprendedores,
  todosLosProductos,
  ventasEnRango,
} from "@/lib/repo";
import { subtotalLinea, type Emprendedor, type LineaVenta, type Producto, type Venta } from "@/lib/types";
import { money } from "@/lib/format";
import { useNegocio } from "@/lib/negocio-context";
import { Modal } from "@/components/Modal";
import { SelectorFecha } from "@/components/SelectorFecha";
import { CrmTabs } from "../CrmTabs";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Suma por emprendedor del rango dado, usando snapshot en la línea cuando está
// y, si no, cruzando por código contra el catálogo (fallback para ventas
// históricas anteriores al snapshot).
function agregarPorEmprendedor(
  ventas: Venta[],
  porCodigo: Map<string, Producto>
): Map<string, { nombre: string; monto: number; unidades: number; nVentas: Set<string> }> {
  const out = new Map<
    string,
    { nombre: string; monto: number; unidades: number; nVentas: Set<string> }
  >();
  const SIN = "__sin__";
  for (const v of ventas) {
    for (const l of v.items) {
      const { id, nombre } = resolverEmp(l, porCodigo);
      const key = id ?? SIN;
      const sub = subtotalLinea(l);
      const cur = out.get(key) ?? { nombre, monto: 0, unidades: 0, nVentas: new Set<string>() };
      cur.monto += sub;
      cur.unidades += l.cantidad;
      cur.nVentas.add(v.nro);
      out.set(key, cur);
    }
  }
  return out;
}

function resolverEmp(
  l: LineaVenta,
  porCodigo: Map<string, Producto>
): { id: string | null; nombre: string } {
  if (l.emprendedorId) return { id: l.emprendedorId, nombre: l.emprendedorNombre ?? l.emprendedorId };
  const p = porCodigo.get(l.codigo);
  if (p?.emprendedorId) return { id: p.emprendedorId, nombre: p.emprendedorNombre ?? p.emprendedorId };
  return { id: null, nombre: "Sin emprendedor" };
}

// Inicio del mes (00:00:00) y fin del mes (23:59:59.999) según índice (0..11).
function inicioMes(y: number, mIdx: number): number {
  return new Date(y, mIdx, 1, 0, 0, 0, 0).getTime();
}
function finMes(y: number, mIdx: number): number {
  return new Date(y, mIdx + 1, 0, 23, 59, 59, 999).getTime();
}
function prevMes(y: number, mIdx: number): { y: number; m: number } {
  return mIdx === 0 ? { y: y - 1, m: 11 } : { y, m: mIdx - 1 };
}

function inicioDia(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function finDia(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}
function hoyIso(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function PorEmprendedorScreen() {
  const NEGOCIO = useNegocio();
  const ahora = new Date();
  const [year, setYear] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth());

  const [ventasMes, setVentasMes] = useState<Venta[]>([]);
  const [ventasPrev, setVentasPrev] = useState<Venta[]>([]);
  const [ventasAnio, setVentasAnio] = useState<Venta[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [emprendedores, setEmprendedores] = useState<Emprendedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [dlgDia, setDlgDia] = useState(false);
  const [fechaDia, setFechaDia] = useState<string>(hoyIso);
  const [expDia, setExpDia] = useState(false);
  const [errDia, setErrDia] = useState("");

  const porCodigo = useMemo(() => {
    const m = new Map<string, Producto>();
    for (const p of productos) m.set(p.codigo, p);
    return m;
  }, [productos]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const desdeMes = inicioMes(year, mes);
      const hastaMes = finMes(year, mes);
      const prev = prevMes(year, mes);
      const desdePrev = inicioMes(prev.y, prev.m);
      const hastaPrev = finMes(prev.y, prev.m);
      const desdeAnio = inicioMes(year, 0);
      const hastaAnio = finMes(year, 11);

      const [vMes, vPrev, vAnio, prods, emps] = await Promise.all([
        ventasEnRango(desdeMes, hastaMes),
        ventasEnRango(desdePrev, hastaPrev),
        ventasEnRango(desdeAnio, hastaAnio),
        todosLosProductos(),
        listarEmprendedores(),
      ]);
      setVentasMes(vMes);
      setVentasPrev(vPrev);
      setVentasAnio(vAnio);
      setProductos(prods);
      setEmprendedores(emps);
    } catch (e) {
      setError((e as Error).message || "No se pudieron cargar las ventas.");
    } finally {
      setCargando(false);
    }
  }, [year, mes]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Calcula filas: cada emprendedor con monto del mes, mes anterior, año y delta.
  const filas = useMemo(() => {
    const A = agregarPorEmprendedor(ventasMes, porCodigo);
    const B = agregarPorEmprendedor(ventasPrev, porCodigo);
    const C = agregarPorEmprendedor(ventasAnio, porCodigo);

    // Unión de IDs (incluye emprendedores listados aunque sin ventas).
    const ids = new Set<string>([...A.keys(), ...B.keys(), ...C.keys()]);
    for (const e of emprendedores) ids.add(e.id);

    const nombreDe = (id: string): string => {
      if (id === "__sin__") return "Sin emprendedor";
      const e = emprendedores.find((x) => x.id === id);
      return e?.nombre ?? A.get(id)?.nombre ?? B.get(id)?.nombre ?? C.get(id)?.nombre ?? id;
    };

    const arr = Array.from(ids).map((id) => {
      const a = A.get(id);
      const b = B.get(id);
      const c = C.get(id);
      const mesMonto = a?.monto ?? 0;
      const prevMonto = b?.monto ?? 0;
      const anioMonto = c?.monto ?? 0;
      const delta = prevMonto > 0 ? ((mesMonto - prevMonto) / prevMonto) * 100 : (mesMonto > 0 ? 100 : 0);
      return {
        id,
        nombre: nombreDe(id),
        mesMonto,
        prevMonto,
        anioMonto,
        delta,
        unidadesMes: a?.unidades ?? 0,
        nVentasMes: a?.nVentas.size ?? 0,
      };
    });
    arr.sort((x, y) => y.mesMonto - x.mesMonto);
    return arr;
  }, [ventasMes, ventasPrev, ventasAnio, porCodigo, emprendedores]);

  const totalMes = filas.reduce((s, f) => s + f.mesMonto, 0);
  const totalPrev = filas.reduce((s, f) => s + f.prevMonto, 0);
  const deltaTotal = totalPrev > 0 ? ((totalMes - totalPrev) / totalPrev) * 100 : 0;

  function navegar(dir: -1 | 1) {
    const nuevo = new Date(year, mes + dir, 1);
    setYear(nuevo.getFullYear());
    setMes(nuevo.getMonth());
  }

  function exportarMes() {
    const filasXls = filas.map((f) => ({
      Emprendedor: f.nombre,
      "Mes": f.mesMonto,
      "Mes anterior": f.prevMonto,
      "Δ %": Number(f.delta.toFixed(1)),
      "Acumulado año": f.anioMonto,
      "Ventas (n°)": f.nVentasMes,
      "Unidades": f.unidadesMes,
      "% del total mes": totalMes > 0 ? Number(((f.mesMonto / totalMes) * 100).toFixed(1)) : 0,
    }));
    const ws = XLSX.utils.json_to_sheet(filasXls);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${MESES[mes]} ${year}`);
    XLSX.writeFile(wb, `ventas_por_emprendedor_${NEGOCIO.slug}_${year}-${String(mes + 1).padStart(2, "0")}.xlsx`);
  }

  async function exportarDia() {
    if (!fechaDia) return;
    setExpDia(true);
    setErrDia("");
    try {
      const vDia = await ventasEnRango(inicioDia(fechaDia), finDia(fechaDia));
      const agg = agregarPorEmprendedor(vDia, porCodigo);
      const nombreDe = (id: string): string => {
        if (id === "__sin__") return "Sin emprendedor";
        const e = emprendedores.find((x) => x.id === id);
        return e?.nombre ?? agg.get(id)?.nombre ?? id;
      };
      const filasDia = Array.from(agg.entries())
        .map(([id, v]) => ({
          id,
          nombre: nombreDe(id),
          monto: v.monto,
          unidades: v.unidades,
          nVentas: v.nVentas.size,
        }))
        .sort((a, b) => b.monto - a.monto);

      if (filasDia.length === 0) {
        setErrDia("Sin ventas registradas en esa fecha.");
        return;
      }

      const totalDia = filasDia.reduce((s, f) => s + f.monto, 0);
      const [yy, mm, dd] = fechaDia.split("-");
      const filasXls = filasDia.map((f) => ({
        Emprendedor: f.nombre,
        Día: `${dd}/${mm}/${yy}`,
        "Ventas (n°)": f.nVentas,
        Unidades: f.unidades,
        Monto: f.monto,
        "% del total día": totalDia > 0 ? Number(((f.monto / totalDia) * 100).toFixed(1)) : 0,
      }));
      const ws = XLSX.utils.json_to_sheet(filasXls);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `${dd}-${mm}-${yy}`);
      XLSX.writeFile(wb, `ventas_por_emprendedor_${NEGOCIO.slug}_dia_${yy}-${mm}-${dd}.xlsx`);
      setDlgDia(false);
    } catch (e) {
      setErrDia((e as Error).message || "No se pudo exportar.");
    } finally {
      setExpDia(false);
    }
  }

  return (
    <div className="space-y-4">
      <CrmTabs />

      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Store className="text-cyan-600" size={22} /> Ventas por emprendedor
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={cargar}
              className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm"
              title="Actualizar"
            >
              <RefreshCw size={16} /> Actualizar
            </button>
            <button
              onClick={exportarMes}
              disabled={cargando || filas.length === 0}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
              title="Exportar el mes seleccionado"
            >
              <Download size={16} /> Excel mes
            </button>
            <button
              onClick={() => {
                setErrDia("");
                setFechaDia(hoyIso());
                setDlgDia(true);
              }}
              disabled={cargando}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
              title="Exportar un día puntual"
            >
              <Calendar size={16} /> Excel día
            </button>
          </div>
        </div>

        {/* Selector de mes */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => navegar(-1)}
            className="p-2 rounded-lg border border-slate-300 hover:bg-slate-100"
            aria-label="Mes anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="bg-slate-100 rounded-lg px-4 py-2 font-semibold text-slate-800 min-w-[200px] text-center">
            {MESES[mes]} {year}
          </div>
          <button
            onClick={() => navegar(1)}
            className="p-2 rounded-lg border border-slate-300 hover:bg-slate-100"
            aria-label="Mes siguiente"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => {
              const n = new Date();
              setYear(n.getFullYear());
              setMes(n.getMonth());
            }}
            className="text-sm font-semibold text-cyan-700 hover:text-cyan-800 ml-1"
          >
            Hoy
          </button>
        </div>
      </div>

      {/* KPIs del mes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total del mes" valor={money(totalMes)} color="emerald" cargando={cargando} />
        <Kpi label="Mes anterior" valor={money(totalPrev)} color="slate" cargando={cargando} />
        <KpiDelta label="Variación" delta={deltaTotal} cargando={cargando} />
        <Kpi label="Emprendedores con venta" valor={String(filas.filter((f) => f.mesMonto > 0).length)} color="cyan" cargando={cargando} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-xl shadow overflow-hidden anim-in">
        {cargando ? (
          <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin" /> Cargando…
          </div>
        ) : filas.length === 0 ? (
          <div className="p-8 text-center text-slate-400">Sin datos para este mes.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Emprendedor</th>
                  <th className="px-4 py-2 text-right font-semibold">Mes</th>
                  <th className="px-4 py-2 text-right font-semibold">Anterior</th>
                  <th className="px-4 py-2 text-right font-semibold">Δ %</th>
                  <th className="px-4 py-2 text-right font-semibold">Año</th>
                  <th className="px-4 py-2 text-right font-semibold">% mes</th>
                  <th className="px-4 py-2 text-right font-semibold hidden sm:table-cell">Vts/Un</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((f) => {
                  const pct = totalMes > 0 ? (f.mesMonto / totalMes) * 100 : 0;
                  return (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-800">{f.nombre}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">
                        {money(f.mesMonto)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                        {money(f.prevMonto)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Delta v={f.delta} hayPrev={f.prevMonto > 0} hayActual={f.mesMonto > 0} />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                        {money(f.anioMonto)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                        {pct.toFixed(0)}%
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500 hidden sm:table-cell">
                        {f.nVentasMes} / {f.unidadesMes}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr>
                  <td className="px-4 py-2 font-bold text-slate-800">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums font-bold text-slate-900">
                    {money(totalMes)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {money(totalPrev)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Delta v={deltaTotal} hayPrev={totalPrev > 0} hayActual={totalMes > 0} />
                  </td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Modal
        abierto={dlgDia}
        onCerrar={() => setDlgDia(false)}
        titulo="Exportar Excel de un día"
        maxW="max-w-sm"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Día a exportar
            </label>
            <SelectorFecha value={fechaDia} onChange={setFechaDia} />
          </div>
          {errDia && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 text-sm">
              {errDia}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setDlgDia(false)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              onClick={exportarDia}
              disabled={!fechaDia || expDia}
              className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              {expDia ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              Exportar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Kpi({
  label, valor, color, cargando,
}: {
  label: string; valor: string;
  color: "emerald" | "slate" | "cyan";
  cargando: boolean;
}) {
  const colores: Record<string, string> = {
    emerald: "text-emerald-700 bg-emerald-50",
    slate: "text-slate-700 bg-slate-100",
    cyan: "text-cyan-700 bg-cyan-50",
  };
  return (
    <div className="bg-white rounded-xl shadow p-4 anim-in">
      <div className={`inline-block text-[10px] uppercase tracking-wider font-bold rounded px-2 py-0.5 mb-2 ${colores[color]}`}>
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 leading-tight">
        {cargando ? "…" : valor}
      </div>
    </div>
  );
}

function KpiDelta({ label, delta, cargando }: { label: string; delta: number; cargando: boolean }) {
  const positivo = delta > 0;
  const negativo = delta < 0;
  return (
    <div className="bg-white rounded-xl shadow p-4 anim-in">
      <div className="inline-block text-[10px] uppercase tracking-wider font-bold rounded px-2 py-0.5 mb-2 bg-violet-50 text-violet-700">
        {label}
      </div>
      <div className={`text-2xl font-bold leading-tight flex items-center gap-2 ${
        positivo ? "text-emerald-600" : negativo ? "text-red-600" : "text-slate-500"
      }`}>
        {cargando ? "…" : (
          <>
            {positivo ? <TrendingUp size={22} /> : negativo ? <TrendingDown size={22} /> : <Minus size={22} />}
            {(positivo ? "+" : "") + delta.toFixed(1) + "%"}
          </>
        )}
      </div>
    </div>
  );
}

function Delta({ v, hayPrev, hayActual }: { v: number; hayPrev: boolean; hayActual: boolean }) {
  if (!hayPrev && !hayActual) return <span className="text-slate-300">—</span>;
  if (!hayPrev) return <span className="text-emerald-600 font-semibold text-xs">nuevo</span>;
  const positivo = v > 0;
  const negativo = v < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${
      positivo ? "text-emerald-600" : negativo ? "text-red-600" : "text-slate-500"
    }`}>
      {positivo ? <TrendingUp size={14} /> : negativo ? <TrendingDown size={14} /> : <Minus size={14} />}
      {(positivo ? "+" : "") + v.toFixed(1) + "%"}
    </span>
  );
}
