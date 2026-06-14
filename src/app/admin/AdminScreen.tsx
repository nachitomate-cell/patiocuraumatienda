"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings, Download, FileSpreadsheet, Store, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import { ultimasVentas } from "@/lib/repo";
import seed from "@/data/productos.seed.json";
import type { Producto, Venta } from "@/lib/types";
import { money } from "@/lib/format";

export function AdminScreen() {
  const [busy, setBusy] = useState(false);

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
      XLSX.writeFile(wb, `ventas_patio_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  function exportarCatalogo() {
    const ws = XLSX.utils.json_to_sheet(seed as Producto[]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "STOCK");
    XLSX.writeFile(wb, "catalogo_patio.xlsx");
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
