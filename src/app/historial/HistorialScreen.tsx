"use client";

import { useEffect, useMemo, useState } from "react";
import {
  History,
  Search,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  Undo2,
  Plus,
  Minus,
  Loader2,
  AlertTriangle,
  FileSpreadsheet,
  CalendarDays,
  CalendarRange,
  Printer,
} from "lucide-react";
import { Ticket } from "@/components/Ticket";
import * as XLSX from "xlsx";
import {
  ultimasVentas,
  ultimasDevoluciones,
  registrarDevolucion,
  cajaAbierta,
  ventasEnRango,
  devolucionesEnRango,
} from "@/lib/repo";
import {
  subtotalLinea,
  type Devolucion,
  type LineaVenta,
  type Venta,
} from "@/lib/types";
import { money, hoyISO } from "@/lib/format";
import { SelectorFecha } from "@/components/SelectorFecha";
import { Modal } from "@/components/Modal";
import { useNegocio } from "@/lib/negocio-context";
import { useVendedor } from "@/lib/vendedor";

export function HistorialScreen() {
  const NEGOCIO = useNegocio();
  const vendedor = useVendedor();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [devolver, setDevolver] = useState<Venta | null>(null);
  const [imprimir, setImprimir] = useState<Venta | null>(null);
  const [descargando, setDescargando] = useState<"diario" | "semanal" | null>(null);
  const [reporteErr, setReporteErr] = useState("");

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const [vs, ds] = await Promise.all([ultimasVentas(300), ultimasDevoluciones(300)]);
      setVentas(vs);
      setDevoluciones(ds);
    } catch {
      setError("No se pudo cargar el historial. Revise conexión o reglas de Firestore.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  // Devoluciones agrupadas por nro de venta para no buscar linealmente en cada
  // render: O(1) por fila para el badge y el detalle.
  const devolucionesPorVenta = useMemo(() => {
    const m = new Map<string, Devolucion[]>();
    for (const d of devoluciones) {
      const arr = m.get(d.ventaNro) || [];
      arr.push(d);
      m.set(d.ventaNro, arr);
    }
    return m;
  }, [devoluciones]);

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
      unidades = 0,
      devuelto = 0;
    for (const v of filtradas) {
      total += v.total || 0;
      unidades += v.items.reduce((s, l) => s + l.cantidad, 0);
      const devs = devolucionesPorVenta.get(v.nro) || [];
      for (const d of devs) devuelto += d.total || 0;
    }
    return { total, unidades, n: filtradas.length, devuelto };
  }, [filtradas, devolucionesPorVenta]);

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
    XLSX.writeFile(wb, `ventas_${NEGOCIO.slug}_${hoyISO()}.xlsx`);
  }

  // Reporte diario (hoy) o semanal (últimos 7 días incluyendo hoy). Consulta
  // Firestore por rango: no depende de las "últimas 300" del listado. Genera
  // un Excel con 3 hojas (Ventas / Devoluciones / Resumen).
  async function descargarReporte(modo: "diario" | "semanal") {
    setDescargando(modo);
    setReporteErr("");
    try {
      const ahora = new Date();
      const fin = new Date(ahora);
      fin.setHours(23, 59, 59, 999);
      const inicio = new Date(ahora);
      inicio.setHours(0, 0, 0, 0);
      if (modo === "semanal") inicio.setDate(inicio.getDate() - 6);

      const [vs, ds] = await Promise.all([
        ventasEnRango(inicio.getTime(), fin.getTime()),
        devolucionesEnRango(inicio.getTime(), fin.getTime()),
      ]);

      const ventasRows = vs.flatMap((v) =>
        v.items.map((l) => ({
          Nro: v.nro,
          Fecha: v.fecha,
          Hora: new Date(v.creadoEn).toLocaleTimeString("es-CL", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          Cliente: v.cliente,
          Vendedor: v.vendedor ?? "",
          "Medio de pago": v.medioPago ?? "",
          Codigo: l.codigo,
          Descripcion: l.descripcion,
          Emprendedor: l.emprendedorNombre ?? "",
          Cantidad: l.cantidad,
          "Valor venta": l.precio,
          "Dscto%": l.descuento,
          Subtotal: subtotalLinea(l),
        }))
      );

      const devsRows = ds.flatMap((d) =>
        d.items.map((l) => ({
          "Nro devolución": d.nro,
          "Nro venta": d.ventaNro,
          Fecha: d.fecha,
          Hora: new Date(d.creadoEn).toLocaleTimeString("es-CL", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          Vendedor: d.vendedor ?? "",
          "Medio original": d.medioPagoOriginal,
          Motivo: d.motivo,
          Codigo: l.codigo,
          Descripcion: l.descripcion,
          Cantidad: l.cantidad,
          "Valor unidad": l.precio,
          "Dscto%": l.descuento,
          "Subtotal devuelto": subtotalLinea(l),
        }))
      );

      const totalBruto = vs.reduce((s, v) => s + (v.total || 0), 0);
      const totalDevuelto = ds.reduce((s, d) => s + (d.total || 0), 0);
      const unidades = vs.reduce(
        (s, v) => s + v.items.reduce((ss, l) => ss + l.cantidad, 0),
        0
      );
      const resumenRows = [
        {
          Periodo:
            modo === "diario"
              ? hoyISO()
              : `${isoOf(inicio)} a ${hoyISO()}`,
          Negocio: NEGOCIO.nombre || NEGOCIO.slug,
          "Ventas (N°)": vs.length,
          "Unidades vendidas": unidades,
          "Total bruto": totalBruto,
          "Devoluciones (N°)": ds.length,
          "Total devuelto": totalDevuelto,
          "Neto": totalBruto - totalDevuelto,
        },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenRows), "Resumen");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(ventasRows.length ? ventasRows : [{ Aviso: "Sin ventas en el periodo" }]),
        "Ventas"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(devsRows.length ? devsRows : [{ Aviso: "Sin devoluciones en el periodo" }]),
        "Devoluciones"
      );
      XLSX.writeFile(
        wb,
        `reporte_${modo}_${NEGOCIO.slug}_${hoyISO()}.xlsx`
      );
    } catch (e) {
      setReporteErr(e instanceof Error ? e.message : "No se pudo generar el reporte.");
    } finally {
      setDescargando(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Reportes: ataja la búsqueda manual por fecha. Consulta Firestore por
          rango y arma un Excel con resumen + ventas + devoluciones del periodo. */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-1">
          <FileSpreadsheet className="text-emerald-600" size={20} /> Reportes
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Descarga un Excel con todas las ventas y devoluciones del periodo. Incluye una hoja
          Resumen con el total bruto, devuelto y neto.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          <button
            onClick={() => descargarReporte("diario")}
            disabled={descargando !== null}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            {descargando === "diario" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <CalendarDays size={18} />
            )}
            Reporte de hoy
          </button>
          <button
            onClick={() => descargarReporte("semanal")}
            disabled={descargando !== null}
            className="flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            {descargando === "semanal" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <CalendarRange size={18} />
            )}
            Reporte semanal (últimos 7 días)
          </button>
        </div>
        {reporteErr && (
          <p className="mt-2 text-sm text-red-600">{reporteErr}</p>
        )}
      </div>

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
          {resumen.devuelto > 0 && (
            <span className="text-slate-500">
              Devuelto: <b className="text-red-600">−{money(resumen.devuelto)}</b>
            </span>
          )}
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
                  devoluciones={devolucionesPorVenta.get(v.nro) || []}
                  abierto={abierto}
                  onToggle={() => setAbierta(abierto ? null : v.nro)}
                  onDevolver={() => setDevolver(v)}
                  onImprimir={() => setImprimir(v)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <ModalDevolucion
        venta={devolver}
        devolucionesPrevias={devolver ? devolucionesPorVenta.get(devolver.nro) || [] : []}
        vendedor={vendedor}
        onCerrar={() => setDevolver(null)}
        onConfirmada={async () => {
          setDevolver(null);
          await cargar();
        }}
      />

      <ModalImprimirBoleta venta={imprimir} onCerrar={() => setImprimir(null)} />
    </div>
  );
}

function FilaVenta({
  venta: v,
  devoluciones,
  abierto,
  onToggle,
  onDevolver,
  onImprimir,
}: {
  venta: Venta;
  devoluciones: Devolucion[];
  abierto: boolean;
  onToggle: () => void;
  onDevolver: () => void;
  onImprimir: () => void;
}) {
  // Cuánto se ha devuelto por cada línea (por código, suma de cantidades).
  // Para líneas manuales (sin código) usamos la descripción como clave.
  const devueltoPorClave = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of devoluciones) {
      for (const l of d.items) {
        const k = claveLinea(l);
        m.set(k, (m.get(k) || 0) + l.cantidad);
      }
    }
    return m;
  }, [devoluciones]);

  const totalDevuelto = devoluciones.reduce((s, d) => s + (d.total || 0), 0);
  const completaDevuelta = totalDevuelto >= v.total - 0.5; // tolerancia centavos

  return (
    <>
      <tr className="border-t hover:bg-slate-50 cursor-pointer" onClick={onToggle}>
        <td className="px-2 text-slate-400 text-center">
          {abierto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </td>
        <td className="px-3 py-2 font-mono">{v.nro}</td>
        <td className="px-3 py-2">{v.fecha}</td>
        <td className="px-3 py-2">
          {v.cliente}
          {totalDevuelto > 0 && (
            <span
              className={`ml-2 text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                completaDevuelta
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700"
              }`}
              title={`Devuelto ${money(totalDevuelto)}`}
            >
              {completaDevuelta ? "DEV total" : `DEV −${money(totalDevuelto)}`}
            </span>
          )}
        </td>
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
                  <th className="text-right py-1">Devuelta</th>
                  <th className="text-right py-1">Precio</th>
                  <th className="text-right py-1">Dscto</th>
                  <th className="text-right py-1">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {v.items.map((l, i) => {
                  const dev = devueltoPorClave.get(claveLinea(l)) || 0;
                  return (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="py-1 font-mono">{l.codigo}</td>
                      <td className="py-1">{l.descripcion}</td>
                      <td className="py-1 text-right">{l.cantidad}</td>
                      <td className="py-1 text-right text-red-600">
                        {dev > 0 ? `−${dev}` : "—"}
                      </td>
                      <td className="py-1 text-right">{money(l.precio)}</td>
                      <td className="py-1 text-right">{l.descuento}%</td>
                      <td className="py-1 text-right font-semibold">
                        {money(subtotalLinea(l))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {devoluciones.length > 0 && (
              <div className="mt-3 border-t border-slate-200 pt-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 mb-1">
                  Devoluciones ({devoluciones.length})
                </div>
                <ul className="space-y-1 text-xs">
                  {devoluciones.map((d) => (
                    <li key={d.nro} className="flex items-center justify-between gap-3">
                      <span className="font-mono text-slate-600">
                        {d.nro} · {d.fecha}
                        {d.vendedor && ` · ${d.vendedor}`}
                        {d.motivo && ` · ${d.motivo}`}
                      </span>
                      <span className="font-semibold text-red-600">−{money(d.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              {v.vendedor && (
                <span className="text-slate-400">Vendedor: {v.vendedor}</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onImprimir();
                  }}
                  className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg px-3 py-1.5 text-xs"
                >
                  <Printer size={14} /> Reimprimir boleta
                </button>
                {completaDevuelta ? (
                  <span className="text-xs text-red-600 font-semibold">
                    Venta completamente devuelta
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDevolver();
                    }}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-3 py-1.5 text-xs"
                  >
                    <Undo2 size={14} /> Devolver productos
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Clave estable de una línea de venta para cruzar con devoluciones. Para
// productos de catálogo es el código; para manuales (sin código) usamos la
// descripción + precio (un manual es una "etiqueta libre" en la venta).
function claveLinea(l: LineaVenta): string {
  if (l.codigo) return `c:${l.codigo}`;
  return `m:${l.descripcion}|${l.precio}`;
}

// Fecha local en formato ISO yyyy-mm-dd (sin desfase UTC).
function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// ===== Modal de reimpresión de boleta =====
// Reusa el componente Ticket (mismo formato que la venta original) y dispara
// window.print(). El CSS global oculta todo menos #ticket al imprimir.

function ModalImprimirBoleta({
  venta,
  onCerrar,
}: {
  venta: Venta | null;
  onCerrar: () => void;
}) {
  return (
    <Modal
      abierto={!!venta}
      onCerrar={onCerrar}
      titulo={venta ? `Boleta · ${venta.nro}` : ""}
      maxW="max-w-md"
    >
      {venta && (
        <div className="space-y-3">
          <div className="flex justify-center">
            <Ticket
              nro={venta.nro}
              fecha={venta.fecha}
              cliente={venta.cliente || "Consumidor Final"}
              items={venta.items}
              total={venta.total}
              vendedor={venta.vendedor}
              medioPago={venta.medioPago}
            />
          </div>
          <p className="text-xs text-slate-500 text-center">
            La vista de arriba es lo que se enviará a la impresora. Al imprimir
            sólo se imprime esta boleta (el resto de la pantalla queda fuera).
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCerrar}
              className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100"
            >
              Cerrar
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg px-4 py-2"
            >
              <Printer size={16} /> Imprimir
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ===== Modal de devolución =====

interface FilaDev {
  linea: LineaVenta;
  vendida: number;
  yaDevuelta: number;
  aDevolver: number;
}

function ModalDevolucion({
  venta,
  devolucionesPrevias,
  vendedor,
  onCerrar,
  onConfirmada,
}: {
  venta: Venta | null;
  devolucionesPrevias: Devolucion[];
  vendedor: string;
  onCerrar: () => void;
  onConfirmada: () => Promise<void>;
}) {
  const [filas, setFilas] = useState<FilaDev[]>([]);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Caja abierta: necesaria si la venta fue en efectivo. Se chequea al abrir
  // el modal para mostrar la advertencia antes de que el usuario seleccione.
  const [hayCaja, setHayCaja] = useState<boolean | null>(null);

  useEffect(() => {
    if (!venta) return;
    const devueltoPorClave = new Map<string, number>();
    for (const d of devolucionesPrevias) {
      for (const l of d.items) {
        const k = claveLinea(l);
        devueltoPorClave.set(k, (devueltoPorClave.get(k) || 0) + l.cantidad);
      }
    }
    setFilas(
      venta.items.map((linea) => {
        const yaDevuelta = devueltoPorClave.get(claveLinea(linea)) || 0;
        return {
          linea,
          vendida: linea.cantidad,
          yaDevuelta,
          aDevolver: 0,
        };
      })
    );
    setMotivo("");
    setErr("");
    setBusy(false);

    // Solo necesitamos saber si hay caja para el medio efectivo.
    if (venta.medioPago === "efectivo") {
      setHayCaja(null);
      cajaAbierta()
        .then((c) => setHayCaja(!!c))
        .catch(() => setHayCaja(false));
    } else {
      setHayCaja(true); // no aplica
    }
  }, [venta, devolucionesPrevias]);

  function setCantidad(idx: number, valor: number) {
    setFilas((arr) =>
      arr.map((f, i) => {
        if (i !== idx) return f;
        const max = f.vendida - f.yaDevuelta;
        const v = Math.max(0, Math.min(max, Math.floor(valor)));
        return { ...f, aDevolver: v };
      })
    );
  }

  const totalADevolver = useMemo(() => {
    return filas.reduce((s, f) => {
      if (f.aDevolver <= 0) return s;
      const linea: LineaVenta = { ...f.linea, cantidad: f.aDevolver };
      return s + subtotalLinea(linea);
    }, 0);
  }, [filas]);

  const algoSeleccionado = filas.some((f) => f.aDevolver > 0);
  const necesitaCaja = venta?.medioPago === "efectivo";
  const bloqueadoPorCaja = necesitaCaja && hayCaja === false;

  async function confirmar() {
    if (!venta) return;
    if (!motivo.trim()) {
      setErr("Indica el motivo de la devolución.");
      return;
    }
    if (!algoSeleccionado) {
      setErr("Marca al menos una línea para devolver.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const itemsADevolver: LineaVenta[] = filas
        .filter((f) => f.aDevolver > 0)
        .map((f) => ({ ...f.linea, cantidad: f.aDevolver }));
      await registrarDevolucion({
        fecha: hoyISO(),
        ventaNro: venta.nro,
        vendedor: vendedor || venta.vendedor || "",
        motivo: motivo.trim(),
        items: itemsADevolver,
        medioPagoOriginal: venta.medioPago || "efectivo",
        clienteId: venta.clienteId,
      });
      await onConfirmada();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo registrar la devolución.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      abierto={!!venta}
      onCerrar={busy ? () => {} : onCerrar}
      titulo={venta ? `Devolver productos · ${venta.nro}` : ""}
      maxW="max-w-2xl"
    >
      {venta && (
        <div className="space-y-4">
          {/* Resumen de la venta */}
          <div className="bg-slate-50 rounded-lg p-3 text-sm grid sm:grid-cols-3 gap-2">
            <span>
              <span className="text-slate-500">Cliente:</span>{" "}
              <b className="text-slate-800">{venta.cliente || "—"}</b>
            </span>
            <span>
              <span className="text-slate-500">Medio:</span>{" "}
              <b className="text-slate-800 capitalize">{venta.medioPago || "—"}</b>
            </span>
            <span>
              <span className="text-slate-500">Total:</span>{" "}
              <b className="text-slate-800">{money(venta.total)}</b>
            </span>
          </div>

          {bloqueadoPorCaja && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                Para devolver una venta en <b>efectivo</b> debe haber una caja abierta.
                Ve a Caja, abre el turno y vuelve.
              </div>
            </div>
          )}

          {necesitaCaja && hayCaja === null && (
            <div className="bg-slate-50 text-slate-500 rounded-lg px-3 py-2 text-xs">
              Verificando caja…
            </div>
          )}

          {venta.medioPago && venta.medioPago !== "efectivo" && venta.medioPago !== "fiado" && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs">
              Esta venta se cobró por <b>{venta.medioPago}</b>: la devolución dejará registro
              pero el chargeback al cliente se hace por el medio externo (POS/banco).
            </div>
          )}

          {venta.medioPago === "fiado" && (
            <div className="bg-cyan-50 border border-cyan-200 text-cyan-800 rounded-lg px-3 py-2 text-xs">
              Venta a fiado: la devolución reducirá automáticamente la deuda de{" "}
              <b>{venta.clienteNombre || venta.cliente || "el cliente"}</b>.
            </div>
          )}

          {/* Líneas con stepper */}
          <div className="border rounded-lg divide-y">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
              <div className="col-span-6">Producto</div>
              <div className="col-span-1 text-right">Vend.</div>
              <div className="col-span-1 text-right">Dev.</div>
              <div className="col-span-2 text-center">A devolver</div>
              <div className="col-span-2 text-right">Subtotal</div>
            </div>
            {filas.map((f, i) => {
              const max = f.vendida - f.yaDevuelta;
              const subt = f.aDevolver
                ? subtotalLinea({ ...f.linea, cantidad: f.aDevolver })
                : 0;
              const disabled = max <= 0;
              return (
                <div key={i} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm items-center">
                  <div className="col-span-6">
                    <div className="font-medium text-slate-800 truncate">
                      {f.linea.descripcion}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">{f.linea.codigo || "manual"}</div>
                  </div>
                  <div className="col-span-1 text-right text-slate-600">{f.vendida}</div>
                  <div className="col-span-1 text-right text-red-600">
                    {f.yaDevuelta || "—"}
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <button
                      onClick={() => setCantidad(i, f.aDevolver - 1)}
                      disabled={disabled || f.aDevolver <= 0}
                      className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-100 flex items-center justify-center disabled:opacity-30"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={max}
                      disabled={disabled}
                      value={f.aDevolver}
                      onChange={(e) => setCantidad(i, Number(e.target.value) || 0)}
                      className="w-12 text-center border rounded px-1 py-1 text-sm disabled:bg-slate-50"
                    />
                    <button
                      onClick={() => setCantidad(i, f.aDevolver + 1)}
                      disabled={disabled || f.aDevolver >= max}
                      className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-100 flex items-center justify-center disabled:opacity-30"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="col-span-2 text-right font-semibold text-slate-700">
                    {subt > 0 ? money(subt) : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">Motivo</span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: producto defectuoso, cliente cambió de opinión…"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <div className="text-sm">
              <div className="text-slate-500">Total a devolver</div>
              <div className="text-2xl font-bold text-red-600 mt-0.5">
                −{money(totalADevolver)}
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Devuelve: <b>{vendedor || "Sin vendedor"}</b> (cámbialo en el chip del header).
          </p>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCerrar}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={confirmar}
              disabled={busy || !algoSeleccionado || bloqueadoPorCaja || !motivo.trim()}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
              Confirmar devolución
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
