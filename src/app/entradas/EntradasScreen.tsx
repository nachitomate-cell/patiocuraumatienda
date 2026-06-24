"use client";

import { useEffect, useState } from "react";
import { PackagePlus, Plus, X, Check, AlertTriangle } from "lucide-react";
import {
  getProducto,
  registrarEntrada,
  siguienteNroEntrada,
  ultimasEntradas,
} from "@/lib/repo";
import type { Entrada, LineaEntrada, Producto } from "@/lib/types";
import { hoyISO } from "@/lib/format";
import { useVendedor } from "@/lib/vendedor";
import { SelectorFecha } from "@/components/SelectorFecha";

export function EntradasScreen() {
  const vendedor = useVendedor();
  const [fecha, setFecha] = useState(hoyISO());
  const [codigo, setCodigo] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [lote, setLote] = useState("");
  const [encontrado, setEncontrado] = useState<Producto | null>(null);
  const [items, setItems] = useState<LineaEntrada[]>([]);
  const [historial, setHistorial] = useState<Entrada[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function cargarHistorial() {
    try {
      setHistorial(await ultimasEntradas(20));
    } catch {
      /* sin conexión o sin permisos: se ignora */
    }
  }

  useEffect(() => {
    cargarHistorial();
  }, []);

  async function buscar(cod: string) {
    setCodigo(cod);
    setEncontrado(null);
    const c = cod.trim();
    if (!c) return;
    setEncontrado(await getProducto(c));
  }

  function agregar() {
    setMsg("");
    const c = codigo.trim();
    if (!c) return setMsg("Ingrese un código de producto.");
    if (cantidad <= 0) return setMsg("Cantidad inválida.");
    setItems((prev) => [
      ...prev,
      {
        codigo: c,
        descripcion: encontrado?.descripcion ?? "(producto nuevo)",
        lote: lote.trim(),
        cantidad,
      },
    ]);
    setCodigo("");
    setCantidad(1);
    setLote("");
    setEncontrado(null);
  }

  function quitar(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function registrar() {
    if (items.length === 0) return setMsg("No hay productos para ingresar.");
    setBusy(true);
    setMsg("");
    try {
      const nro = await siguienteNroEntrada();
      await registrarEntrada(nro, fecha, items, vendedor);
      setMsg(`✅ Entrada ${nro} registrada. Stock actualizado.`);
      setItems([]);
      cargarHistorial();
    } catch {
      setMsg("Error al registrar. Revise conexión o reglas de Firestore.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4 min-w-0">
        <div className="bg-white rounded-xl shadow p-4 anim-in">
          <h1 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
            <PackagePlus className="text-cyan-600" size={22} /> Entrada de productos
          </h1>

          <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
            <div className="grid sm:grid-cols-5 gap-3 items-end">
              <label className="text-sm sm:col-span-2">
                <span className="text-slate-500">Código producto</span>
                <input
                  value={codigo}
                  onChange={(e) => buscar(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregar()}
                  placeholder="ej: ALFO-0001"
                  className="mt-1 w-full border rounded px-3 py-2 font-mono uppercase"
                />
              </label>
              <label className="text-sm">
                <span className="text-slate-500">Cantidad</span>
                <input
                  type="number"
                  min={1}
                  value={cantidad}
                  onChange={(e) => setCantidad(Number(e.target.value))}
                  className="mt-1 w-full border rounded px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="text-slate-500">Lote (opcional)</span>
                <input
                  value={lote}
                  onChange={(e) => setLote(e.target.value)}
                  className="mt-1 w-full border rounded px-3 py-2"
                />
              </label>
              <div className="text-sm">
                <span className="text-slate-500">Fecha</span>
                <SelectorFecha value={fecha} onChange={setFecha} className="mt-1" />
              </div>
            </div>

            <div className="mt-3 text-sm text-slate-600">
              {codigo.trim() === "" ? (
                "— ingrese código —"
              ) : encontrado ? (
                <>
                  <span className="font-semibold">{encontrado.descripcion}</span> · Stock actual:{" "}
                  {encontrado.stockActual} → quedará {encontrado.stockActual + cantidad}
                </>
              ) : (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={14} /> Código nuevo: se creará el producto al registrar
                </span>
              )}
            </div>

            <button
              onClick={agregar}
              className="btn-accion mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg py-2.5 flex items-center justify-center gap-2"
            >
              <Plus size={20} /> Agregar a la entrada
            </button>
          </div>

          {msg && (
            <div className="mt-3 text-sm rounded bg-slate-100 border border-slate-200 px-3 py-2">
              {msg}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow tabla-scroll">
          <table className="w-full text-sm min-w-[620px]">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Código</th>
                <th className="text-left px-3 py-2">Descripción</th>
                <th className="text-left px-3 py-2">Lote</th>
                <th className="text-right px-3 py-2">Cantidad</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Sin productos en esta entrada
                  </td>
                </tr>
              )}
              {items.map((l, i) => (
                <tr key={i} className="border-t anim-pop">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2 font-mono">{l.codigo}</td>
                  <td className="px-3 py-2">{l.descripcion}</td>
                  <td className="px-3 py-2">{l.lote || "-"}</td>
                  <td className="px-3 py-2 text-right font-semibold">+{l.cantidad}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => quitar(i)}
                      className="icon-btn inline-flex items-center justify-center text-red-600 hover:text-white hover:bg-red-600 p-1.5 rounded-lg border border-transparent hover:border-red-600"
                      aria-label="Quitar"
                    >
                      <X size={18} />
                      <span className="solo-grande">Quitar</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Columna derecha: registrar + historial */}
      <div className="space-y-4 min-w-0">
        <div className="panel-obsidiana p-5 anim-in">
          <div className="flex items-end justify-between">
            <span className="text-slate-500 uppercase tracking-wide text-xs font-semibold">
              Productos a ingresar
            </span>
            <span className="text-4xl font-bold precio-oro">
              {items.reduce((s, l) => s + l.cantidad, 0)}
            </span>
          </div>
          <button
            onClick={registrar}
            disabled={busy}
            className="btn-accion mt-3 w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check size={20} /> {busy ? "Registrando…" : "Registrar entrada"}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-4 anim-in">
          <h2 className="font-semibold text-slate-800 mb-2">Últimas entradas</h2>
          <ul className="text-sm divide-y">
            {historial.length === 0 && (
              <li className="py-2 text-slate-400">Sin entradas registradas</li>
            )}
            {historial.map((e, i) => (
              <li key={i} className="py-2 flex justify-between gap-2">
                <span className="truncate">
                  <span className="font-mono text-slate-500">{e.nro}</span> {e.descripcion}
                </span>
                <span className="text-emerald-600 font-semibold whitespace-nowrap">
                  +{e.cantidad}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
