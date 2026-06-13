"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Plus, Check, PackageCheck } from "lucide-react";
import {
  getEmprendedorPorToken,
  agregarProductoEmprendedor,
  productosDeEmprendedor,
} from "@/lib/repo";
import type { Emprendedor, Producto } from "@/lib/types";
import { money } from "@/lib/format";

export function AltaEmprendedorScreen({ token }: { token: string }) {
  const [emp, setEmp] = useState<Emprendedor | null>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "invalido">("cargando");
  const [productos, setProductos] = useState<Producto[]>([]);

  const [descripcion, setDescripcion] = useState("");
  const [precio, setPrecio] = useState(0);
  const [stock, setStock] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getEmprendedorPorToken(token)
      .then(async (e) => {
        if (!e) {
          setEstado("invalido");
          return;
        }
        setEmp(e);
        setEstado("ok");
        setProductos(await productosDeEmprendedor(e.id));
      })
      .catch(() => setEstado("invalido"));
  }, [token]);

  async function agregar() {
    if (!emp) return;
    if (!descripcion.trim()) return setMsg("Escribe el nombre del producto.");
    if (precio <= 0) return setMsg("Ingresa un precio válido.");
    setBusy(true);
    setMsg("");
    try {
      const cod = await agregarProductoEmprendedor(emp, {
        descripcion,
        precio,
        stock,
      });
      setMsg(`✅ "${descripcion}" agregado (código ${cod}).`);
      setDescripcion("");
      setPrecio(0);
      setStock(1);
      setProductos(await productosDeEmprendedor(emp.id));
    } catch {
      setMsg("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (estado === "cargando") {
    return <div className="mt-20 text-center text-slate-500">Cargando…</div>;
  }

  if (estado === "invalido") {
    return (
      <div className="mx-auto max-w-md mt-20 bg-white rounded-xl shadow p-6 text-center">
        <h1 className="text-lg font-bold text-slate-900">Link no válido</h1>
        <p className="text-slate-500 mt-2 text-sm">
          Este enlace no corresponde a ningún emprendedor. Pide uno nuevo al administrador de
          Patio Curauma.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-2xl px-4 h-16 flex items-center gap-3">
          <Image src="/logo.png" alt="Patio Curauma" width={36} height={48} className="h-10 w-auto" />
          <div className="leading-none">
            <div className="font-bold">Patio Curauma</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300/80">
              Carga de productos
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-4">
        <div className="bg-white rounded-xl shadow p-5 anim-in">
          <h1 className="text-xl font-bold text-slate-900">¡Hola, {emp?.nombre}! 👋</h1>
          <p className="text-slate-500 mt-1">
            Agrega aquí tus productos. Entran directo al stock de la tienda Patio Curauma.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">Nombre del producto</span>
              <input
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Ej: Collar de cobre artesanal"
                className="mt-1 w-full border rounded-lg px-3 py-2.5"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-slate-600 font-medium">Precio de venta ($)</span>
                <input
                  type="number"
                  min={0}
                  value={precio}
                  onChange={(e) => setPrecio(Number(e.target.value))}
                  className="mt-1 w-full border rounded-lg px-3 py-2.5"
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600 font-medium">Cantidad (stock)</span>
                <input
                  type="number"
                  min={0}
                  value={stock}
                  onChange={(e) => setStock(Number(e.target.value))}
                  className="mt-1 w-full border rounded-lg px-3 py-2.5"
                />
              </label>
            </div>
            <button
              onClick={agregar}
              disabled={busy}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Plus size={20} /> {busy ? "Guardando…" : "Agregar producto"}
            </button>
            {msg && (
              <div className="text-sm rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 anim-pop">
                {msg}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-5 anim-in">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-3">
            <PackageCheck className="text-emerald-600" size={20} /> Tus productos cargados (
            {productos.length})
          </h2>
          {productos.length === 0 ? (
            <p className="text-slate-400 text-sm">Aún no has agregado productos.</p>
          ) : (
            <ul className="divide-y">
              {productos.map((p) => (
                <li key={p.codigo} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-mono text-slate-400">{p.codigo}</span>{" "}
                    {p.descripcion}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-slate-500">{p.stockActual} u.</span>
                    <span className="font-semibold">{money(p.precio)}</span>
                    <Check size={16} className="text-emerald-500" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 pb-6">
          Patio Curauma · Curauma, Valparaíso
        </p>
      </main>
    </div>
  );
}
