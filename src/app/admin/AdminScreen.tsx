"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { importarCatalogo, ultimasVentas } from "@/lib/repo";
import seed from "@/data/productos.seed.json";
import type { Producto, Venta } from "@/lib/types";
import { money } from "@/lib/format";

export function AdminScreen() {
  const [prog, setProg] = useState<{ hechos: number; total: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function importar() {
    if (!confirm(`Se cargarán ${(seed as Producto[]).length} productos a Firestore. ¿Continuar?`))
      return;
    setBusy(true);
    setMsg("");
    try {
      await importarCatalogo(seed as Producto[], (hechos, total) =>
        setProg({ hechos, total })
      );
      setMsg("✅ Catálogo importado correctamente.");
    } catch (e) {
      setMsg("Error al importar. Revise conexión y reglas de Firestore.");
    } finally {
      setBusy(false);
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
      <div className="bg-white rounded-xl shadow p-4">
        <h1 className="text-lg font-bold text-slate-900 mb-1">⚙️ Administración</h1>
        <p className="text-sm text-slate-500">
          Carga inicial del catálogo y respaldos a archivo.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow p-4 space-y-3">
        <h2 className="font-semibold text-slate-800">1. Importar catálogo a Firestore</h2>
        <p className="text-sm text-slate-500">
          Sube los {(seed as Producto[]).length} productos extraídos del Excel original a la
          colección <code className="bg-slate-100 px-1 rounded">productos</code>. Solo se hace
          una vez (o cuando actualices precios).
        </p>
        <button
          onClick={importar}
          disabled={busy}
          className="bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-semibold rounded px-4 py-2 disabled:opacity-50"
        >
          {busy && prog ? `Importando ${prog.hechos}/${prog.total}…` : "Importar catálogo"}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow p-4 space-y-3">
        <h2 className="font-semibold text-slate-800">2. Respaldos a archivo (.xlsx)</h2>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={exportarVentas}
            disabled={busy}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded px-4 py-2 disabled:opacity-50"
          >
            Exportar ventas
          </button>
          <button
            onClick={exportarCatalogo}
            className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded px-4 py-2"
          >
            Exportar catálogo
          </button>
        </div>
      </div>

      {msg && (
        <div className="text-sm rounded bg-slate-100 border border-slate-200 px-3 py-2">{msg}</div>
      )}
    </div>
  );
}
