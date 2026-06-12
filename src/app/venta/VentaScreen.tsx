"use client";

import { useState } from "react";
import { getProducto, confirmarVenta, siguienteNroVenta } from "@/lib/repo";
import { subtotalLinea, type LineaVenta, type Producto } from "@/lib/types";
import { money, hoyISO } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Ticket } from "@/components/Ticket";

export function VentaScreen() {
  const { user } = useAuth();
  const [nro, setNro] = useState("NV-—");
  const [cliente, setCliente] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [descuento, setDescuento] = useState(0);
  const [encontrado, setEncontrado] = useState<Producto | null>(null);
  const [items, setItems] = useState<LineaVenta[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const total = items.reduce((s, l) => s + subtotalLinea(l), 0);

  async function buscar(cod: string) {
    setCodigo(cod);
    setEncontrado(null);
    const c = cod.trim();
    if (!c) return;
    const p = await getProducto(c);
    setEncontrado(p);
  }

  function agregar() {
    setMsg("");
    const c = codigo.trim();
    if (!c) return setMsg("Ingrese un código de producto.");
    if (cantidad <= 0) return setMsg("Cantidad inválida.");
    const p = encontrado;
    const linea: LineaVenta = {
      codigo: c,
      descripcion: p?.descripcion ?? "⚠️ Manual",
      precio: p?.precio ?? 0,
      cantidad,
      descuento,
    };
    if (p && cantidad > p.stockActual) {
      setMsg(`⚠️ Stock insuficiente: quedan ${p.stockActual} unid. de ${c}.`);
      return;
    }
    setItems((prev) => [...prev, linea]);
    setCodigo("");
    setCantidad(1);
    setDescuento(0);
    setEncontrado(null);
  }

  function quitar(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function confirmar() {
    if (items.length === 0) return setMsg("No hay productos en el carrito.");
    setBusy(true);
    setMsg("");
    try {
      const nuevoNro = await siguienteNroVenta();
      await confirmarVenta({
        nro: nuevoNro,
        fecha: hoyISO(),
        cliente: cliente || "Consumidor Final",
        items,
        total,
        vendedor: user?.email ?? "",
      });
      setNro(nuevoNro);
      setMsg(`✅ Venta ${nuevoNro} registrada y stock descontado.`);
    } catch (e) {
      setMsg("Error al registrar la venta. Revise su conexión o reglas de Firestore.");
    } finally {
      setBusy(false);
    }
  }

  function nuevaVenta() {
    setItems([]);
    setCliente("");
    setCodigo("");
    setCantidad(1);
    setDescuento(0);
    setEncontrado(null);
    setNro("NV-—");
    setMsg("");
  }

  const precioActual = encontrado?.precio ?? 0;
  const subtotalPrev = cantidad * precioActual * (1 - descuento / 100);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Columna izquierda: búsqueda + carrito */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-900">🛍️ Panel de venta</h1>
            <div className="text-sm text-slate-500">
              <span className="font-mono">{nro}</span> · {hoyISO()}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <label className="text-sm">
              <span className="text-slate-500">Cliente</span>
              <input
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Consumidor Final"
                className="mt-1 w-full border rounded px-3 py-2"
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
            <div className="grid sm:grid-cols-4 gap-3 items-end">
              <label className="text-sm sm:col-span-2">
                <span className="text-slate-500">🔍 Código producto</span>
                <input
                  value={codigo}
                  onChange={(e) => buscar(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregar()}
                  placeholder="ej: CANE0056"
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
                <span className="text-slate-500">Descuento %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={descuento}
                  onChange={(e) => setDescuento(Number(e.target.value))}
                  className="mt-1 w-full border rounded px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <div className="text-slate-600">
                {codigo.trim() === "" ? (
                  "— ingrese código —"
                ) : encontrado ? (
                  <>
                    <span className="font-semibold">{encontrado.descripcion}</span> ·{" "}
                    {money(encontrado.precio)} · Stock: {encontrado.stockActual}
                  </>
                ) : (
                  <span className="text-amber-600">⚠️ Código no está en STOCK (venta manual)</span>
                )}
              </div>
              <div className="text-slate-500">Subtotal: {money(subtotalPrev)}</div>
            </div>

            <button
              onClick={agregar}
              className="mt-3 w-full bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-semibold rounded py-2"
            >
              ➕ Agregar al carrito
            </button>
          </div>

          {msg && (
            <div className="mt-3 text-sm rounded bg-slate-100 border border-slate-200 px-3 py-2">
              {msg}
            </div>
          )}
        </div>

        {/* Carrito */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Código</th>
                <th className="text-left px-3 py-2">Descripción</th>
                <th className="text-right px-3 py-2">Cant.</th>
                <th className="text-right px-3 py-2">Precio</th>
                <th className="text-right px-3 py-2">Dscto</th>
                <th className="text-right px-3 py-2">Subtotal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    Carrito vacío
                  </td>
                </tr>
              )}
              {items.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2 font-mono">{l.codigo}</td>
                  <td className="px-3 py-2">{l.descripcion}</td>
                  <td className="px-3 py-2 text-right">{l.cantidad}</td>
                  <td className="px-3 py-2 text-right">{money(l.precio)}</td>
                  <td className="px-3 py-2 text-right">{l.descuento}%</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {money(subtotalLinea(l))}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => quitar(i)}
                      className="text-red-500 hover:text-red-700"
                      aria-label="Quitar"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Columna derecha: total + acciones + ticket */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-end justify-between">
            <span className="text-slate-500">💰 Total a pagar</span>
            <span className="text-3xl font-bold text-slate-900">{money(total)}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Precios incluyen IVA</p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={confirmar}
              disabled={busy}
              className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded py-2.5 disabled:opacity-50"
            >
              {busy ? "Registrando…" : "✅ Confirmar venta"}
            </button>
            <button
              onClick={() => window.print()}
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded py-2"
            >
              🖨️ Imprimir
            </button>
            <button
              onClick={nuevaVenta}
              className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded py-2"
            >
              🗑️ Nueva
            </button>
          </div>
        </div>

        <Ticket
          nro={nro}
          fecha={hoyISO()}
          cliente={cliente || "Consumidor Final"}
          items={items}
          total={total}
        />
      </div>
    </div>
  );
}
