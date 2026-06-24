"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Download,
  Loader2,
  Calendar,
} from "lucide-react";
import { ventasEnRango } from "@/lib/repo";
import type { Venta } from "@/lib/types";
import { money } from "@/lib/format";
import { useNegocio } from "@/lib/negocio-context";
import { CrmTabs } from "../CrmTabs";

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];
const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

type Granularidad = "mensual" | "semanal";

interface Punto {
  label: string;
  inicio: number;
  fin: number;
  total: number;
  nVentas: number;
}

// Genera los últimos N meses (más antiguo primero).
function ultimosMeses(n: number): { y: number; m: number }[] {
  const ahora = new Date();
  const arr: { y: number; m: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    arr.push({ y: d.getFullYear(), m: d.getMonth() });
  }
  return arr;
}

// Genera las últimas N semanas terminadas hoy. Semana = lunes a domingo (es-CL).
function ultimasSemanas(n: number): { inicio: Date; fin: Date }[] {
  const ahora = new Date();
  const ini = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  // Mover al lunes de esta semana.
  const offsetLunes = (ini.getDay() + 6) % 7; // 0 si es lunes
  ini.setDate(ini.getDate() - offsetLunes);
  const arr: { inicio: Date; fin: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const inicio = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() - i * 7);
    const fin = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 6, 23, 59, 59, 999);
    arr.push({ inicio, fin });
  }
  return arr;
}

function fmtSemana(s: { inicio: Date; fin: Date }): string {
  const i = s.inicio, f = s.fin;
  const mismoMes = i.getMonth() === f.getMonth();
  if (mismoMes) return `${i.getDate()}–${f.getDate()} ${MESES[i.getMonth()]}`;
  return `${i.getDate()} ${MESES[i.getMonth()]} – ${f.getDate()} ${MESES[f.getMonth()]}`;
}

export function VariacionScreen() {
  const NEGOCIO = useNegocio();
  const [gran, setGran] = useState<Granularidad>("mensual");
  const [nPeriodos, setNPeriodos] = useState(12);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Calcula rango total para una sola consulta.
  const { rangoDesde, rangoHasta, buckets } = useMemo(() => {
    if (gran === "mensual") {
      const meses = ultimosMeses(nPeriodos);
      const desde = new Date(meses[0].y, meses[0].m, 1, 0, 0, 0, 0).getTime();
      const ultimo = meses[meses.length - 1];
      const hasta = new Date(ultimo.y, ultimo.m + 1, 0, 23, 59, 59, 999).getTime();
      const buckets: Punto[] = meses.map(({ y, m }) => ({
        label: `${MESES[m]} ${String(y).slice(2)}`,
        inicio: new Date(y, m, 1, 0, 0, 0, 0).getTime(),
        fin: new Date(y, m + 1, 0, 23, 59, 59, 999).getTime(),
        total: 0,
        nVentas: 0,
      }));
      return { rangoDesde: desde, rangoHasta: hasta, buckets };
    } else {
      const semanas = ultimasSemanas(nPeriodos);
      const desde = semanas[0].inicio.getTime();
      const hasta = semanas[semanas.length - 1].fin.getTime();
      const buckets: Punto[] = semanas.map((s) => ({
        label: fmtSemana(s),
        inicio: s.inicio.getTime(),
        fin: s.fin.getTime(),
        total: 0,
        nVentas: 0,
      }));
      return { rangoDesde: desde, rangoHasta: hasta, buckets };
    }
  }, [gran, nPeriodos]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setVentas(await ventasEnRango(rangoDesde, rangoHasta));
    } catch (e) {
      setError((e as Error).message || "No se pudieron cargar las ventas.");
    } finally {
      setCargando(false);
    }
  }, [rangoDesde, rangoHasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Distribuye las ventas en los buckets calculados arriba.
  const puntos = useMemo(() => {
    const arr = buckets.map((b) => ({ ...b }));
    for (const v of ventas) {
      for (const b of arr) {
        if (v.creadoEn >= b.inicio && v.creadoEn <= b.fin) {
          b.total += v.total;
          b.nVentas++;
          break;
        }
      }
    }
    return arr;
  }, [ventas, buckets]);

  const total = puntos.reduce((s, p) => s + p.total, 0);
  const max = Math.max(1, ...puntos.map((p) => p.total));
  const ultimo = puntos[puntos.length - 1];
  const penultimo = puntos[puntos.length - 2];
  const deltaUltimo =
    penultimo && penultimo.total > 0
      ? ((ultimo.total - penultimo.total) / penultimo.total) * 100
      : 0;
  const promedio = puntos.length > 0 ? total / puntos.length : 0;
  const mejor = puntos.reduce((a, b) => (b.total > a.total ? b : a), puntos[0]);

  function exportar() {
    const filas = puntos.map((p, i) => {
      const prev = i > 0 ? puntos[i - 1].total : 0;
      const delta = prev > 0 ? ((p.total - prev) / prev) * 100 : 0;
      return {
        Periodo: p.label,
        Ventas: p.nVentas,
        Total: p.total,
        "Δ vs anterior ($)": p.total - prev,
        "Δ %": Number(delta.toFixed(1)),
      };
    });
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Variación ${gran}`);
    XLSX.writeFile(wb, `variacion_${gran}_${NEGOCIO.slug}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <CrmTabs />

      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="text-cyan-600" size={22} /> Variación de ventas
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
              onClick={exportar}
              disabled={cargando || puntos.length === 0}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              <Download size={16} /> Exportar Excel
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-100 rounded-lg p-1">
            {(["mensual", "semanal"] as Granularidad[]).map((g) => (
              <button
                key={g}
                onClick={() => setGran(g)}
                className={`px-4 py-1.5 rounded text-sm font-semibold ${
                  gran === g ? "bg-white text-cyan-700 shadow" : "text-slate-600"
                }`}
              >
                {g === "mensual" ? "Mensual" : "Semanal"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <Calendar size={16} className="text-slate-400" />
            <span className="text-slate-500">Mostrar:</span>
            <select
              value={nPeriodos}
              onChange={(e) => setNPeriodos(Number(e.target.value))}
              className="border rounded-lg px-2 py-1.5 text-sm"
            >
              {(gran === "mensual"
                ? [6, 12, 18, 24]
                : [4, 8, 12, 24, 52]
              ).map((n) => (
                <option key={n} value={n}>
                  últimos {n} {gran === "mensual" ? "meses" : "semanas"}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label={gran === "mensual" ? "Mes actual" : "Semana actual"}
          valor={ultimo ? money(ultimo.total) : "—"}
          sub={ultimo ? ultimo.label : ""}
          cargando={cargando}
        />
        <KpiDelta label="vs período anterior" delta={deltaUltimo} cargando={cargando} />
        <Kpi label="Promedio" valor={money(promedio)} cargando={cargando} />
        <Kpi
          label="Mejor período"
          valor={mejor ? money(mejor.total) : "—"}
          sub={mejor ? mejor.label : ""}
          cargando={cargando}
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}

      {/* Gráfico */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h2 className="font-semibold text-slate-800 mb-3">Tendencia</h2>
        {cargando ? (
          <div className="h-44 flex items-center justify-center text-slate-400">
            <Loader2 size={18} className="animate-spin mr-2" /> Cargando…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="flex items-end gap-1.5 h-44"
              style={{ minWidth: puntos.length * 40 }}
            >
              {puntos.map((p, i) => {
                const prev = i > 0 ? puntos[i - 1].total : 0;
                const delta = prev > 0 ? p.total - prev : 0;
                const color =
                  delta > 0 ? "from-emerald-500 to-emerald-300"
                  : delta < 0 ? "from-red-500 to-red-300"
                  : "from-cyan-500 to-cyan-300";
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group min-w-[20px]">
                    <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 whitespace-nowrap">
                      {money(p.total)}
                    </span>
                    <div
                      className={`w-full rounded-t bg-gradient-to-t ${color}`}
                      style={{ height: `${(p.total / max) * 100}%`, minHeight: p.total > 0 ? 4 : 0 }}
                      title={`${p.label}: ${money(p.total)}`}
                    />
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">{p.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl shadow overflow-hidden anim-in">
        {cargando ? (
          <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin" /> Cargando…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Período</th>
                  <th className="px-4 py-2 text-right font-semibold">Ventas</th>
                  <th className="px-4 py-2 text-right font-semibold">Total</th>
                  <th className="px-4 py-2 text-right font-semibold">Δ vs anterior</th>
                  <th className="px-4 py-2 text-right font-semibold">Δ %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {puntos.map((p, i) => {
                  const prev = i > 0 ? puntos[i - 1].total : 0;
                  const deltaAbs = p.total - prev;
                  const delta = prev > 0 ? (deltaAbs / prev) * 100 : 0;
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-800 capitalize">
                        {gran === "mensual" ? labelMesCompleto(p.label) : p.label}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                        {p.nVentas.toLocaleString("es-CL")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">
                        {money(p.total)}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${
                        deltaAbs > 0 ? "text-emerald-600" : deltaAbs < 0 ? "text-red-600" : "text-slate-400"
                      }`}>
                        {i === 0 ? "—" : (deltaAbs > 0 ? "+" : "") + money(deltaAbs)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {i === 0 ? <span className="text-slate-300">—</span>
                          : <Delta v={delta} hayPrev={prev > 0} hayActual={p.total > 0} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr>
                  <td className="px-4 py-2 font-bold text-slate-800">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {puntos.reduce((s, p) => s + p.nVentas, 0).toLocaleString("es-CL")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-bold text-slate-900">
                    {money(total)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label, valor, sub, cargando,
}: { label: string; valor: string; sub?: string; cargando: boolean }) {
  return (
    <div className="bg-white rounded-xl shadow p-4 anim-in">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 leading-tight">
        {cargando ? "…" : valor}
      </div>
      {sub && <div className="text-xs text-slate-400 mt-0.5 capitalize">{sub}</div>}
    </div>
  );
}

function KpiDelta({ label, delta, cargando }: { label: string; delta: number; cargando: boolean }) {
  const positivo = delta > 0;
  const negativo = delta < 0;
  return (
    <div className="bg-white rounded-xl shadow p-4 anim-in">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
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

function labelMesCompleto(label: string): string {
  // "ene 26" → "enero 2026"
  const [m, y2] = label.split(" ");
  const idx = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"].indexOf(m);
  if (idx < 0) return label;
  return `${MESES_LARGO[idx]} 20${y2}`;
}
