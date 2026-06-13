"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Search,
  RefreshCw,
  AlertTriangle,
  PackageX,
  Wallet,
  Layers,
  Pencil,
  Check,
  X,
  Download,
  Info,
} from "lucide-react";
import * as XLSX from "xlsx";
import { todosLosProductos, ajustarProducto } from "@/lib/repo";
import type { Producto } from "@/lib/types";
import { money } from "@/lib/format";

type Filtro = "todos" | "con" | "bajo" | "sin";

export function StockScreen() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [umbral, setUmbral] = useState(5);
  const [verResumen, setVerResumen] = useState(false);

  // Edición inline
  const [editando, setEditando] = useState<string | null>(null);
  const [edStock, setEdStock] = useState(0);
  const [edPrecio, setEdPrecio] = useState(0);
  const [edBarcode, setEdBarcode] = useState("");

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      setProductos(await todosLosProductos());
    } catch {
      setError("No se pudo cargar el inventario. Revise conexión o que ya importó el catálogo.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const kpis = useMemo(() => {
    let unidades = 0,
      valorCosto = 0,
      valorVenta = 0,
      sin = 0,
      bajo = 0;
    for (const p of productos) {
      const s = p.stockActual || 0;
      unidades += Math.max(s, 0);
      valorCosto += Math.max(s, 0) * (p.costo || 0);
      valorVenta += Math.max(s, 0) * (p.precio || 0);
      if (s <= 0) sin++;
      else if (s <= umbral) bajo++;
    }
    return { unidades, valorCosto, valorVenta, sin, bajo, total: productos.length };
  }, [productos, umbral]);

  const filtrados = useMemo(() => {
    const t = term.trim().toLowerCase();
    return productos.filter((p) => {
      const s = p.stockActual || 0;
      const okFiltro =
        filtro === "todos" ||
        (filtro === "con" && s > 0) ||
        (filtro === "bajo" && s > 0 && s <= umbral) ||
        (filtro === "sin" && s <= 0);
      if (!okFiltro) return false;
      if (!t) return true;
      return (
        p.codigo.toLowerCase().includes(t) ||
        (p.descripcion || "").toLowerCase().includes(t)
      );
    });
  }, [productos, term, filtro, umbral]);

  const visibles = filtrados.slice(0, 300);

  function iniciarEdicion(p: Producto) {
    setEditando(p.codigo);
    setEdStock(p.stockActual || 0);
    setEdPrecio(p.precio || 0);
    setEdBarcode(p.barcode ?? "");
  }

  async function guardarEdicion(p: Producto) {
    const cambios = { stockActual: edStock, precio: edPrecio, barcode: edBarcode.trim() };
    await ajustarProducto(p.codigo, cambios);
    setProductos((prev) =>
      prev.map((x) => (x.codigo === p.codigo ? { ...x, ...cambios } : x))
    );
    setEditando(null);
  }

  function exportar() {
    const filas = filtrados.map((p) => ({
      Codigo: p.codigo,
      Descripcion: p.descripcion,
      Stock: p.stockActual,
      Costo: p.costo,
      Precio: p.precio,
      "Importe inventario": Math.max(p.stockActual || 0, 0) * (p.costo || 0),
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "INVENTARIO");
    XLSX.writeFile(wb, `inventario_patio_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const TABS: { id: Filtro; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "con", label: "Con stock" },
    { id: "bajo", label: "Stock bajo" },
    { id: "sin", label: "Sin stock" },
  ];

  return (
    <div className="space-y-4">
      {/* Resumen / KPIs (oculto por defecto, se abre con el botón de información) */}
      {verResumen && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 anim-in">
          <Kpi icon={<Layers size={20} />} label="Productos" valor={kpis.total.toLocaleString("es-CL")} color="slate" />
          <Kpi icon={<Boxes size={20} />} label="Unidades en stock" valor={kpis.unidades.toLocaleString("es-CL")} color="cyan" />
          <Kpi icon={<Wallet size={20} />} label="Valor inventario (costo)" valor={money(kpis.valorCosto)} color="emerald" />
          <Kpi icon={<AlertTriangle size={20} />} label={`Stock bajo (≤${umbral})`} valor={kpis.bajo.toLocaleString("es-CL")} color="amber" />
          <Kpi icon={<PackageX size={20} />} label="Sin stock" valor={kpis.sin.toLocaleString("es-CL")} color="red" />
        </div>
      )}

      {/* Controles */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Boxes className="text-cyan-600" size={22} /> Inventario
            </h1>
            <button
              onClick={() => setVerResumen((v) => !v)}
              title="Mostrar/ocultar resumen del inventario"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold border ${
                verResumen
                  ? "bg-cyan-600 text-white border-cyan-600"
                  : "bg-white text-cyan-700 border-cyan-300 hover:bg-cyan-50"
              }`}
            >
              <Info size={16} /> {verResumen ? "Ocultar resumen" : "Ver resumen"}
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-slate-600 flex items-center gap-1">
              Umbral bajo:
              <input
                type="number"
                min={0}
                value={umbral}
                onChange={(e) => setUmbral(Number(e.target.value))}
                className="w-16 border rounded-lg px-2 py-1"
              />
            </label>
            <button
              onClick={exportar}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-3 py-2 text-sm"
            >
              <Download size={16} /> Exportar
            </button>
            <button
              onClick={cargar}
              className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm"
              title="Recargar inventario"
            >
              <RefreshCw size={16} /> Refrescar
            </button>
          </div>
        </div>

        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por código o descripción…"
            className="w-full border rounded-lg pl-9 pr-3 py-2"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setFiltro(tb.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                filtro === tb.id
                  ? "bg-cyan-600 text-white border-cyan-600"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl shadow tabla-scroll anim-in">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Código</th>
              <th className="text-left px-3 py-2">Descripción</th>
              <th className="text-left px-3 py-2">Cód. barras</th>
              <th className="text-right px-3 py-2">Stock</th>
              <th className="text-right px-3 py-2">Costo</th>
              <th className="text-right px-3 py-2">Precio</th>
              <th className="text-right px-3 py-2">Importe</th>
              <th className="text-right px-3 py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Cargando inventario…
                </td>
              </tr>
            )}
            {!cargando && error && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-red-500">
                  {error}
                </td>
              </tr>
            )}
            {!cargando && !error && visibles.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Sin resultados
                </td>
              </tr>
            )}
            {visibles.map((p) => {
              const s = p.stockActual || 0;
              const editar = editando === p.codigo;
              return (
                <tr key={p.codigo} className="border-t">
                  <td className="px-3 py-2 font-mono">{p.codigo}</td>
                  <td className="px-3 py-2">{p.descripcion}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {editar ? (
                      <input
                        value={edBarcode}
                        onChange={(e) => setEdBarcode(e.target.value)}
                        placeholder="EAN…"
                        className="w-32 border rounded px-2 py-1"
                      />
                    ) : (
                      p.barcode || "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editar ? (
                      <input
                        type="number"
                        value={edStock}
                        onChange={(e) => setEdStock(Number(e.target.value))}
                        className="w-20 border rounded px-2 py-1 text-right"
                      />
                    ) : (
                      <span
                        className={`font-semibold px-2 py-0.5 rounded ${
                          s <= 0
                            ? "bg-red-100 text-red-700"
                            : s <= umbral
                            ? "bg-amber-100 text-amber-700"
                            : "text-slate-800"
                        }`}
                      >
                        {s}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">{money(p.costo)}</td>
                  <td className="px-3 py-2 text-right">
                    {editar ? (
                      <input
                        type="number"
                        value={edPrecio}
                        onChange={(e) => setEdPrecio(Number(e.target.value))}
                        className="w-24 border rounded px-2 py-1 text-right"
                      />
                    ) : (
                      money(p.precio)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">
                    {money(Math.max(s, 0) * (p.costo || 0))}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {editar ? (
                      <span className="inline-flex gap-1">
                        <button
                          onClick={() => guardarEdicion(p)}
                          className="text-emerald-600 hover:text-white hover:bg-emerald-600 p-1.5 rounded-lg border border-transparent hover:border-emerald-600"
                          aria-label="Guardar"
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={() => setEditando(null)}
                          className="text-slate-500 hover:text-white hover:bg-slate-500 p-1.5 rounded-lg border border-transparent hover:border-slate-500"
                          aria-label="Cancelar"
                        >
                          <X size={18} />
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => iniciarEdicion(p)}
                        className="icon-btn inline-flex items-center gap-1 text-cyan-700 hover:text-white hover:bg-cyan-600 px-2 py-1.5 rounded-lg border border-transparent hover:border-cyan-600"
                      >
                        <Pencil size={16} />
                        <span className="solo-grande">Ajustar</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!cargando && filtrados.length > visibles.length && (
          <div className="px-3 py-2 text-center text-xs text-slate-400 border-t">
            Mostrando {visibles.length} de {filtrados.length.toLocaleString("es-CL")} — afine la
            búsqueda para ver el resto.
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  valor,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  valor: string;
  color: "slate" | "cyan" | "emerald" | "amber" | "red";
}) {
  const colores: Record<string, string> = {
    slate: "text-white bg-gradient-to-br from-slate-500 to-slate-700",
    cyan: "text-white bg-gradient-to-br from-cyan-400 to-cyan-600",
    emerald: "text-white bg-gradient-to-br from-emerald-400 to-emerald-600",
    amber: "text-white bg-gradient-to-br from-amber-400 to-amber-600",
    red: "text-white bg-gradient-to-br from-red-400 to-red-600",
  };
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div
        className={`inline-flex items-center justify-center w-11 h-11 rounded-xl mb-3 shadow-md ${colores[color]}`}
      >
        {icon}
      </div>
      <div className="text-2xl font-bold text-slate-900 leading-tight">{valor}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
