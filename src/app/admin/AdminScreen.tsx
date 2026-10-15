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
  FlaskConical,
  CalendarRange,
  AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  ultimasVentas,
  getMetaDiaria,
  guardarMetaDiaria,
  ventasEnRango,
  devolucionesEnRango,
  listarEmprendedores,
} from "@/lib/repo";
import { armarReporteVentas, describirRango, nombreArchivoReporte } from "@/lib/reporteVentas";
import { SelectorFecha } from "@/components/SelectorFecha";
import seed from "@/data/productos.seed.json";
import type { Producto, Venta } from "@/lib/types";
import { money } from "@/lib/format";
import { useNegocio } from "@/lib/negocio-context";

type Atajo = "semana_pasada" | "esta_semana" | "mes_pasado" | "este_mes" | "otro";

const ATAJOS: { id: Atajo; label: string }[] = [
  { id: "semana_pasada", label: "Semana pasada (lun–dom)" },
  { id: "esta_semana", label: "Esta semana" },
  { id: "mes_pasado", label: "Mes pasado" },
  { id: "este_mes", label: "Este mes" },
  { id: "otro", label: "Otro período" },
];

function aIso(f: Date): string {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

// Rango del atajo en días del calendario local (el local está en Chile).
function rangoDeAtajo(atajo: Atajo, hoy = new Date()): { desde: string; hasta: string } | null {
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const lunes = hoy.getDate() - ((hoy.getDay() + 6) % 7); // lunes de esta semana
  switch (atajo) {
    case "semana_pasada":
      return { desde: aIso(new Date(y, m, lunes - 7)), hasta: aIso(new Date(y, m, lunes - 1)) };
    case "esta_semana":
      return { desde: aIso(new Date(y, m, lunes)), hasta: aIso(hoy) };
    case "mes_pasado":
      return { desde: aIso(new Date(y, m - 1, 1)), hasta: aIso(new Date(y, m, 0)) };
    case "este_mes":
      return { desde: aIso(new Date(y, m, 1)), hasta: aIso(hoy) };
    default:
      return null;
  }
}

// ms de `creadoEn`: desde 00:00:00.000 del primer día hasta 23:59:59.999 del
// último, en hora local del navegador.
function rangoMs(desdeIso: string, hastaIso: string): { desde: number; hasta: number } {
  const [y1, m1, d1] = desdeIso.split("-").map(Number);
  const [y2, m2, d2] = hastaIso.split("-").map(Number);
  return {
    desde: new Date(y1, m1 - 1, d1, 0, 0, 0, 0).getTime(),
    hasta: new Date(y2, m2 - 1, d2, 23, 59, 59, 999).getTime(),
  };
}

export function AdminScreen() {
  const NEGOCIO = useNegocio();
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(0);
  const [cargandoMeta, setCargandoMeta] = useState(true);
  const [guardandoMeta, setGuardandoMeta] = useState(false);
  const [metaGuardada, setMetaGuardada] = useState(false);
  const [atajo, setAtajo] = useState<Atajo>("semana_pasada");
  const [otroDesde, setOtroDesde] = useState("");
  const [otroHasta, setOtroHasta] = useState("");
  const [generando, setGenerando] = useState(false);
  const [errorReporte, setErrorReporte] = useState("");
  const [listoReporte, setListoReporte] = useState("");

  const rango =
    atajo === "otro"
      ? otroDesde && otroHasta && otroDesde <= otroHasta
        ? { desde: otroDesde, hasta: otroHasta }
        : null
      : rangoDeAtajo(atajo);

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

  async function descargarReporte() {
    if (!rango) return;
    setGenerando(true);
    setErrorReporte("");
    setListoReporte("");
    try {
      const { desde, hasta } = rangoMs(rango.desde, rango.hasta);
      const [ventas, devoluciones, emprendedores] = await Promise.all([
        ventasEnRango(desde, hasta),
        devolucionesEnRango(desde, hasta),
        listarEmprendedores(true),
      ]);
      const negocio = NEGOCIO.nombre || NEGOCIO.slug;
      const r = armarReporteVentas({
        negocio,
        desde: rango.desde,
        hasta: rango.hasta,
        ventas,
        devoluciones,
        emprendedores,
      });
      XLSX.writeFile(r.libro, nombreArchivoReporte(negocio, rango.desde, rango.hasta));
      const n = r.sinIdentificar.lineas;
      const sinId = n
        ? ` · ${n} ${n === 1 ? "línea" : "líneas"} sin emprendedor identificado (${money(r.sinIdentificar.monto)})`
        : "";
      setListoReporte(
        `Descargado: ${r.ventasValidas} ${r.ventasValidas === 1 ? "venta" : "ventas"}, neto ${money(r.neto)}${sinId}.`
      );
    } catch (e) {
      const detalle = e instanceof Error && e.message ? ` (${e.message})` : "";
      setErrorReporte(`No se pudo generar el reporte. Revisa la conexión e inténtalo de nuevo.${detalle}`);
    } finally {
      setGenerando(false);
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
          Emprendedores, reporte de ventas y respaldos de tus datos a archivo.
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

      <Link
        href="/admin/pruebas"
        className="bg-white rounded-xl shadow p-4 anim-in flex items-center justify-between hover:bg-slate-50"
      >
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-cyan-100 text-cyan-700">
            <FlaskConical size={22} />
          </span>
          <span>
            <span className="block font-semibold text-slate-800">Módulo de pruebas</span>
            <span className="block text-sm text-slate-500">
              Diagnóstico de la app: conexión, catálogo, ventas, formatos y navegador
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

      {/* Reporte de ventas por período (el Excel para liquidar a cada emprendedor) */}
      <div className="bg-white rounded-xl shadow p-4 space-y-3 anim-in">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <CalendarRange size={18} className="text-cyan-600" /> Reporte de ventas
        </h2>
        <p className="text-sm text-slate-500">
          Excel con el resumen, lo vendido por cada emprendedor y el detalle de cada venta del
          período. En las ventas manuales el emprendedor se deduce de lo escrito en la venta.
        </p>
        <div className="flex gap-2 flex-wrap">
          {ATAJOS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setAtajo(a.id);
                setErrorReporte("");
                setListoReporte("");
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold border-2 ${
                atajo === a.id
                  ? "border-cyan-600 bg-cyan-50 text-cyan-800"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        {atajo === "otro" && (
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <label className="text-sm">
              <span className="text-slate-500">Desde</span>
              <SelectorFecha value={otroDesde} onChange={setOtroDesde} className="mt-1" />
            </label>
            <label className="text-sm">
              <span className="text-slate-500">Hasta</span>
              <SelectorFecha value={otroHasta} onChange={setOtroHasta} className="mt-1" />
            </label>
          </div>
        )}
        <p className="text-sm text-slate-700">
          {rango ? (
            <>
              Período: <strong>{describirRango(rango.desde, rango.hasta)}</strong>
            </>
          ) : otroDesde && otroHasta ? (
            <span className="text-amber-600">La fecha “Desde” es posterior a “Hasta”.</span>
          ) : (
            <span className="text-slate-500">Elige las fechas desde y hasta.</span>
          )}
        </p>
        <button
          onClick={descargarReporte}
          disabled={!rango || generando}
          className="btn-accion bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2.5 flex items-center gap-2 disabled:opacity-50"
        >
          <Download size={18} /> {generando ? "Generando…" : "Descargar Excel"}
        </button>
        {errorReporte && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>{errorReporte}</span>
          </div>
        )}
        {listoReporte && !errorReporte && (
          <p className="text-sm text-emerald-700 flex items-center gap-1.5">
            <Check size={16} className="shrink-0" /> {listoReporte}
          </p>
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
