"use client";

import { useState } from "react";
import { buscarProductos } from "@/lib/repo";
import type { Producto } from "@/lib/types";
import { money } from "@/lib/format";

export function StockScreen() {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Producto[]>([]);
  const [busy, setBusy] = useState(false);

  async function buscar(t: string) {
    setTerm(t);
    if (t.trim().length < 1) {
      setRows([]);
      return;
    }
    setBusy(true);
    try {
      setRows(await buscarProductos(t, 50));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4">
        <h1 className="text-lg font-bold text-slate-900 mb-2">📦 Stock</h1>
        <input
          value={term}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Buscar por código (ej: PATI, CANE0056)…"
          className="w-full border rounded px-3 py-2 font-mono uppercase"
        />
        <p className="text-xs text-slate-400 mt-1">
          Búsqueda por prefijo de código. Muestra hasta 50 resultados.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Código</th>
              <th className="text-left px-3 py-2">Descripción</th>
              <th className="text-right px-3 py-2">Stock</th>
              <th className="text-right px-3 py-2">Costo</th>
              <th className="text-right px-3 py-2">Precio</th>
            </tr>
          </thead>
          <tbody>
            {busy && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Buscando…
                </td>
              </tr>
            )}
            {!busy && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Escriba un código para buscar
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.codigo} className="border-t">
                <td className="px-3 py-2 font-mono">{p.codigo}</td>
                <td className="px-3 py-2">{p.descripcion}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    p.stockActual <= 0 ? "text-red-500" : "text-slate-800"
                  }`}
                >
                  {p.stockActual}
                </td>
                <td className="px-3 py-2 text-right text-slate-500">{money(p.costo)}</td>
                <td className="px-3 py-2 text-right">{money(p.precio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
