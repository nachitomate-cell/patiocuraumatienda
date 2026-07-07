"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Search, Plus, X, Printer, Trash2, Layers } from "lucide-react";
import { todosLosProductos } from "@/lib/repo";
import type { Producto } from "@/lib/types";
import { money } from "@/lib/format";
import { CodigoBarra } from "@/components/CodigoBarra";
import { useAtajos } from "@/lib/useAtajos";

const MAX_ETIQUETAS = 200;

export function EtiquetasScreen() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [term, setTerm] = useState("");
  const [prefijo, setPrefijo] = useState("");
  // selección: codigo -> cantidad de etiquetas
  const [sel, setSel] = useState<Record<string, number>>({});
  const buscarRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    todosLosProductos()
      .then(setProductos)
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  const porCodigo = useMemo(() => {
    const m = new Map<string, Producto>();
    for (const p of productos) m.set(p.codigo, p);
    return m;
  }, [productos]);

  const resultados = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return productos
      .filter(
        (p) =>
          (p.codigo || "").toLowerCase().includes(t) ||
          (p.descripcion || "").toLowerCase().includes(t)
      )
      .slice(0, 30);
  }, [productos, term]);

  function agregar(cod: string) {
    setSel((s) => ({ ...s, [cod]: s[cod] ? s[cod] : 1 }));
  }
  function setCantidad(cod: string, n: number) {
    setSel((s) => ({ ...s, [cod]: Math.max(1, n) }));
  }
  function quitar(cod: string) {
    setSel((s) => {
      const c = { ...s };
      delete c[cod];
      return c;
    });
  }

  // Productos cuyo código empieza con el prefijo (ej. ACAI, AMON).
  const prefijoNorm = prefijo.trim().toUpperCase();
  const coincidenPrefijo = useMemo(() => {
    if (!prefijoNorm) return [];
    return productos.filter((p) => p.codigo.toUpperCase().startsWith(prefijoNorm));
  }, [productos, prefijoNorm]);

  // Agrega de una vez todos los productos del prefijo (1 etiqueta c/u).
  function agregarPrefijo() {
    if (coincidenPrefijo.length === 0) return;
    setSel((s) => {
      const c = { ...s };
      for (const p of coincidenPrefijo) if (!c[p.codigo]) c[p.codigo] = 1;
      return c;
    });
    setPrefijo("");
  }

  const seleccionados = Object.keys(sel);
  const totalEtiquetas = seleccionados.reduce((n, c) => n + (sel[c] || 0), 0);

  // Lista expandida (cada etiqueta repetida según cantidad), con tope.
  const etiquetas: Producto[] = [];
  for (const cod of seleccionados) {
    const p = porCodigo.get(cod);
    if (!p) continue;
    for (let i = 0; i < (sel[cod] || 0) && etiquetas.length < MAX_ETIQUETAS; i++) {
      etiquetas.push(p);
    }
  }

  useAtajos({
    "alt+b": () => buscarRef.current?.focus(),
    "alt+i": () => {
      if (etiquetas.length > 0) window.print();
    },
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 anim-in no-print">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Barcode className="text-cyan-600" size={22} /> Imprimir etiquetas
          </h1>
          <button
            onClick={() => window.print()}
            disabled={etiquetas.length === 0}
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-50"
          >
            <Printer size={18} /> Imprimir ({etiquetas.length})
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Busca productos, elige cuántas etiquetas de cada uno y pulsa Imprimir. Pega la
          etiqueta en el producto: al escanearla, el sistema lo reconoce solo.
        </p>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={buscarRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={cargando ? "Cargando catálogo…" : "Buscar por código o descripción…"}
            className="w-full border rounded-lg pl-9 pr-3 py-2"
          />
        </div>

        {/* Agregar todos los de una inicial (prefijo de código) */}
        <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3">
          <div className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
            <Layers size={16} className="text-cyan-600" /> Agregar todos de una inicial (ej: ACAI,
            AMON)
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={prefijo}
              onChange={(e) => setPrefijo(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && agregarPrefijo()}
              placeholder="Ej: ACAI"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 min-w-[140px] border rounded-lg px-3 py-2 font-mono uppercase"
            />
            <button
              onClick={agregarPrefijo}
              disabled={coincidenPrefijo.length === 0}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50 shrink-0"
            >
              <Plus size={18} /> Agregar todos ({coincidenPrefijo.length})
            </button>
          </div>
          {prefijoNorm && (
            <p className="text-xs text-slate-500 mt-1.5">
              {coincidenPrefijo.length} producto(s) empiezan con “{prefijoNorm}”.
            </p>
          )}
        </div>

        {resultados.length > 0 && (
          <ul className="mt-2 border rounded-lg divide-y max-h-72 overflow-auto">
            {resultados.map((p) => (
              <li key={p.codigo} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-mono text-slate-500">{p.codigo}</span>{" "}
                  <span className="text-slate-800">{p.descripcion}</span>
                </span>
                <button
                  onClick={() => agregar(p.codigo)}
                  className="flex items-center gap-1 bg-emerald-600 text-white rounded-lg px-3 py-1.5 font-semibold shrink-0"
                >
                  <Plus size={16} /> Agregar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Selección */}
      {seleccionados.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4 anim-in no-print">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-slate-800">
              Seleccionados ({totalEtiquetas} etiquetas)
            </h2>
            <button
              onClick={() => setSel({})}
              className="text-sm text-red-600 flex items-center gap-1 hover:underline"
            >
              <Trash2 size={16} /> Vaciar
            </button>
          </div>
          <ul className="divide-y">
            {seleccionados.map((cod) => {
              const p = porCodigo.get(cod);
              return (
                <li key={cod} className="flex items-center justify-between py-2 text-sm gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-slate-500">{cod}</span>{" "}
                    {p?.descripcion}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-slate-500">Cant.</span>
                    <input
                      type="number"
                      min={1}
                      value={sel[cod]}
                      onChange={(e) => setCantidad(cod, Number(e.target.value))}
                      className="w-20 border rounded-lg px-2 py-1 text-right"
                    />
                    <button
                      onClick={() => quitar(cod)}
                      className="text-red-500 hover:text-red-700 p-1"
                      aria-label="Quitar"
                    >
                      <X size={18} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {totalEtiquetas > MAX_ETIQUETAS && (
            <p className="text-xs text-amber-600 mt-2">
              Se imprimirán las primeras {MAX_ETIQUETAS} etiquetas (límite por hoja).
            </p>
          )}
        </div>
      )}

      {/* Vista previa / área de impresión */}
      {etiquetas.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4 anim-in">
          <h2 className="font-semibold text-slate-800 mb-3 no-print">Vista previa</h2>
          <div id="etiquetas-print">
            {etiquetas.map((p, i) => (
              <div key={i} className="etiqueta">
                <div className="et-top">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="" className="et-logo" />
                  <span className="et-desc">{p.descripcion}</span>
                </div>
                <CodigoBarra value={p.barcode?.trim() || p.codigo} height={34} />
                <div className="et-precio">{money(p.precio)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
