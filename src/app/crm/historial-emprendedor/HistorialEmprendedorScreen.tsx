"use client";

import { useEffect, useMemo, useState } from "react";
import { History, RefreshCw, Loader2, Filter } from "lucide-react";
import {
  listarEmprendedores,
  movimientosDeEmprendedor,
} from "@/lib/repo";
import type {
  AccionMovEmprendedor,
  Emprendedor,
  MovimientoEmprendedor,
} from "@/lib/types";
import { CrmTabs } from "../CrmTabs";
import { HistorialMovs } from "@/components/HistorialMovs";

type FiltroOrigen = "todos" | "admin" | "emprendedor";

const ACCION_LABEL: Record<AccionMovEmprendedor, string> = {
  producto_agregado: "Productos agregados",
  producto_eliminado: "Productos eliminados",
  precio_cambiado: "Cambios de precio",
  stock_cambiado: "Cambios de stock",
  descripcion_cambiada: "Cambios de descripción",
  barcode_cambiado: "Cambios de código de barras",
  codigo_renombrado: "Códigos renombrados",
  costo_cambiado: "Cambios de costo",
  vencimiento_cambiado: "Cambios de vencimiento",
  emprendedor_creado: "Emprendedor creado",
  emprendedor_editado: "Datos editados",
  emprendedor_activado: "Reactivado",
  emprendedor_pausado: "Pausado",
};

export function HistorialEmprendedorScreen() {
  const [emps, setEmps] = useState<Emprendedor[]>([]);
  const [empId, setEmpId] = useState<string>("");
  const [movs, setMovs] = useState<MovimientoEmprendedor[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [cargandoMovs, setCargandoMovs] = useState(false);
  const [error, setError] = useState("");
  const [filtroOrigen, setFiltroOrigen] = useState<FiltroOrigen>("todos");

  // Carga inicial: lista de emprendedores. Selecciona el primero por defecto
  // para que la página no quede vacía al entrar.
  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargandoLista(true);
      try {
        const lista = await listarEmprendedores();
        if (!vivo) return;
        setEmps(lista);
        if (lista.length > 0 && !empId) setEmpId(lista[0].id);
      } catch (e) {
        if (vivo) setError((e as Error).message || "No se pudo cargar la lista.");
      } finally {
        if (vivo) setCargandoLista(false);
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carga la bitácora del emprendedor seleccionado.
  useEffect(() => {
    if (!empId) return;
    let vivo = true;
    (async () => {
      setCargandoMovs(true);
      setError("");
      try {
        const ms = await movimientosDeEmprendedor(empId, 500);
        if (vivo) setMovs(ms);
      } catch (e) {
        if (vivo) setError((e as Error).message || "No se pudo cargar el historial.");
      } finally {
        if (vivo) setCargandoMovs(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [empId]);

  async function refrescar() {
    if (!empId) return;
    setCargandoMovs(true);
    try {
      const ms = await movimientosDeEmprendedor(empId, 500);
      setMovs(ms);
    } finally {
      setCargandoMovs(false);
    }
  }

  const movsFiltrados = useMemo(() => {
    if (filtroOrigen === "todos") return movs;
    return movs.filter((m) => m.origen === filtroOrigen);
  }, [movs, filtroOrigen]);

  // Conteo por acción para el resumen del panel.
  const resumen = useMemo(() => {
    const m = new Map<AccionMovEmprendedor, number>();
    for (const x of movsFiltrados) {
      m.set(x.accion, (m.get(x.accion) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [movsFiltrados]);

  const empSeleccionado = emps.find((e) => e.id === empId);

  return (
    <div className="space-y-4">
      <CrmTabs />

      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <History className="text-violet-600" size={22} /> Historial del emprendedor
          </h1>
          <button
            onClick={refrescar}
            disabled={cargandoMovs || !empId}
            className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          >
            <RefreshCw size={16} className={cargandoMovs ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>

        <p className="text-sm text-slate-500 mt-1">
          Registro de todo lo que se hace sobre los productos del emprendedor: altas,
          ediciones de precio, stock, descripción, y cambios sobre su ficha. Se muestran
          tanto las acciones del propio emprendedor como las del administrador.
        </p>

        <div className="mt-3 grid sm:grid-cols-[1fr_auto] gap-3 items-end">
          <label className="block text-sm">
            <span className="text-slate-600 font-semibold">Emprendedor</span>
            {cargandoLista ? (
              <div className="mt-1 text-slate-400 text-sm">Cargando…</div>
            ) : emps.length === 0 ? (
              <div className="mt-1 text-slate-400 text-sm">
                No hay emprendedores cargados.
              </div>
            ) : (
              <select
                value={empId}
                onChange={(e) => setEmpId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 bg-white"
              >
                {emps.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre} · {e.prefijo}
                    {e.activo === false ? " (inactivo)" : ""}
                  </option>
                ))}
              </select>
            )}
          </label>

          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            {(["todos", "admin", "emprendedor"] as FiltroOrigen[]).map((o) => (
              <button
                key={o}
                onClick={() => setFiltroOrigen(o)}
                className={`px-3 py-2 font-semibold ${
                  filtroOrigen === o
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {o === "todos" ? (
                  <span className="flex items-center gap-1"><Filter size={14} />Todos</span>
                ) : o === "admin" ? "Admin" : "Emprendedor"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}

      {/* Resumen rápido por tipo de acción */}
      {empSeleccionado && (
        <div className="bg-white rounded-xl shadow p-4 anim-in">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
            Resumen ({movsFiltrados.length} movimiento{movsFiltrados.length === 1 ? "" : "s"})
          </div>
          {resumen.length === 0 ? (
            <div className="text-slate-400 text-sm">Sin movimientos para este filtro.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {resumen.map(([accion, n]) => (
                <span
                  key={accion}
                  className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 rounded-lg px-2.5 py-1 text-xs"
                >
                  <span className="font-semibold">{ACCION_LABEL[accion]}</span>
                  <span className="bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono text-[10px]">
                    {n}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bitácora */}
      <div className="bg-white rounded-xl shadow p-5 anim-in">
        {cargandoMovs ? (
          <div className="p-6 text-center text-slate-500 flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin" /> Cargando historial…
          </div>
        ) : (
          <HistorialMovs
            movs={movsFiltrados}
            vacio={
              empSeleccionado
                ? "Aún no hay movimientos para este emprendedor."
                : "Selecciona un emprendedor."
            }
          />
        )}
      </div>
    </div>
  );
}
