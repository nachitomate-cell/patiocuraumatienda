"use client";

import { useEffect, useRef, useState } from "react";
import {
  ShoppingBag,
  Search,
  Plus,
  X,
  Check,
  Printer,
  RotateCcw,
  Eye,
  EyeOff,
  AlertTriangle,
  ScanLine,
  Camera,
  Banknote,
  CreditCard,
  Notebook,
  UserPlus,
} from "lucide-react";
import {
  buscarParaVenta,
  confirmarVenta,
  siguienteNroVenta,
  listarClientes,
  crearCliente,
} from "@/lib/repo";
import {
  subtotalLinea,
  type LineaVenta,
  type Producto,
  type Cliente,
  type MedioPago,
} from "@/lib/types";
import { money, hoyISO } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Ticket } from "@/components/Ticket";
import { EscanerCamara } from "@/components/EscanerCamara";

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
  const [verBoleta, setVerBoleta] = useState(false);
  const [modoEscaner, setModoEscaner] = useState(false);
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [medioPago, setMedioPago] = useState<MedioPago>("efectivo");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [nuevoCliente, setNuevoCliente] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const total = items.reduce((s, l) => s + subtotalLinea(l), 0);

  useEffect(() => {
    listarClientes()
      .then(setClientes)
      .catch(() => {});
  }, []);

  async function agregarCliente() {
    const n = nuevoCliente.trim();
    if (!n) return;
    const id = await crearCliente(n);
    setClientes((prev) =>
      [...prev, { id, nombre: n, saldo: 0, creadoEn: Date.now() }].sort((a, b) =>
        a.nombre.localeCompare(b.nombre)
      )
    );
    setClienteId(id);
    setNuevoCliente("");
  }

  async function buscar(cod: string) {
    setCodigo(cod);
    setEncontrado(null);
    const c = cod.trim();
    if (!c) return;
    setEncontrado(await buscarParaVenta(c));
  }

  // Agrega un producto al carrito a partir de un código (manual, lector USB o cámara).
  async function agregarPorCodigo(cod: string, cant = 1, desc = 0) {
    setMsg("");
    const c = cod.trim();
    if (!c) return setMsg("Ingrese un código de producto.");
    if (cant <= 0) return setMsg("Cantidad inválida.");
    const p = await buscarParaVenta(c);
    if (p && cant > p.stockActual) {
      setMsg(`Stock insuficiente: quedan ${p.stockActual} unid. de ${p.descripcion}.`);
      return;
    }
    const linea: LineaVenta = {
      codigo: p?.codigo ?? c,
      descripcion: p?.descripcion ?? "Manual",
      precio: p?.precio ?? 0,
      cantidad: cant,
      descuento: desc,
    };
    // Si el mismo producto ya está en el carrito, suma cantidades.
    setItems((prev) => {
      const idx = prev.findIndex(
        (l) => l.codigo === linea.codigo && l.descuento === linea.descuento
      );
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + cant };
        return copia;
      }
      return [...prev, linea];
    });
    setCodigo("");
    setCantidad(1);
    setDescuento(0);
    setEncontrado(null);
    if (modoEscaner) inputRef.current?.focus();
  }

  function agregar() {
    agregarPorCodigo(codigo, cantidad, descuento);
  }

  function activarEscaner() {
    const n = !modoEscaner;
    setModoEscaner(n);
    if (n) setTimeout(() => inputRef.current?.focus(), 0);
  }

  function quitar(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function confirmar() {
    if (items.length === 0) return setMsg("No hay productos en el carrito.");
    if (medioPago === "fiado" && !clienteId)
      return setMsg("Seleccione o cree un cliente para fiar.");
    setBusy(true);
    setMsg("");
    try {
      const nuevoNro = await siguienteNroVenta();
      const cli = clientes.find((c) => c.id === clienteId);
      const base = {
        nro: nuevoNro,
        fecha: hoyISO(),
        cliente: cliente || "Consumidor Final",
        items,
        total,
        vendedor: user?.email ?? "",
        medioPago,
      };
      await confirmarVenta(
        medioPago === "fiado"
          ? { ...base, clienteId, clienteNombre: cli?.nombre ?? "" }
          : base
      );
      setNro(nuevoNro);
      setMsg(
        medioPago === "fiado"
          ? `Venta ${nuevoNro} fiada a ${cli?.nombre ?? "cliente"}.`
          : `Venta ${nuevoNro} registrada (${medioPago}).`
      );
    } catch {
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
    setMedioPago("efectivo");
    setClienteId("");
  }

  const precioActual = encontrado?.precio ?? 0;
  const subtotalPrev = cantidad * precioActual * (1 - descuento / 100);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {mostrarCamara && (
        <EscanerCamara
          onDetectar={(c) => agregarPorCodigo(c, 1, 0)}
          onCerrar={() => setMostrarCamara(false)}
        />
      )}

      <div className="lg:col-span-2 space-y-4 min-w-0">
        <div className="bg-white rounded-xl shadow p-4 anim-in">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ShoppingBag className="text-cyan-600" size={22} /> Panel de venta
            </h1>
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
                className="mt-1 w-full border rounded-lg px-3 py-2"
              />
            </label>
          </div>

          {/* Barra de escaneo */}
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={activarEscaner}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold border ${
                modoEscaner
                  ? "bg-cyan-600 text-white border-cyan-600"
                  : "bg-white text-cyan-700 border-cyan-300 hover:bg-cyan-50"
              }`}
            >
              <ScanLine size={18} />
              {modoEscaner ? "Modo escáner: ACTIVO" : "Modo escáner (lector USB)"}
            </button>
            <button
              onClick={() => setMostrarCamara(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold border bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            >
              <Camera size={18} /> Escanear con cámara
            </button>
          </div>

          <div
            className={`rounded-lg border p-3 ${
              modoEscaner ? "border-cyan-400 bg-cyan-50" : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="grid sm:grid-cols-4 gap-3 items-end">
              <label className="text-sm sm:col-span-2">
                <span className="text-slate-500 flex items-center gap-1">
                  <Search size={14} /> Código / código de barras
                </span>
                <input
                  ref={inputRef}
                  value={codigo}
                  onChange={(e) => buscar(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregar()}
                  placeholder={modoEscaner ? "Escanee el producto…" : "ej: CANE0056"}
                  className="mt-1 w-full border rounded-lg px-3 py-2 font-mono uppercase"
                />
              </label>
              <label className="text-sm">
                <span className="text-slate-500">Cantidad</span>
                <input
                  type="number"
                  min={1}
                  value={cantidad}
                  onChange={(e) => setCantidad(Number(e.target.value))}
                  className="mt-1 w-full border rounded-lg px-3 py-2"
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
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <div className="text-slate-600">
                {codigo.trim() === "" ? (
                  modoEscaner ? (
                    "Listo para escanear…"
                  ) : (
                    "— ingrese código —"
                  )
                ) : encontrado ? (
                  <>
                    <span className="font-semibold">{encontrado.descripcion}</span> ·{" "}
                    {money(encontrado.precio)} · Stock: {encontrado.stockActual}
                  </>
                ) : (
                  <span className="text-amber-600 flex items-center gap-1">
                    <AlertTriangle size={14} /> Código no está en STOCK (venta manual)
                  </span>
                )}
              </div>
              <div className="text-slate-500">Subtotal: {money(subtotalPrev)}</div>
            </div>

            <button
              onClick={agregar}
              className="btn-accion mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg py-2.5 flex items-center justify-center gap-2"
            >
              <Plus size={20} /> Agregar al carrito
            </button>
          </div>

          {msg && (
            <div className="mt-3 text-sm rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 anim-pop">
              {msg}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow tabla-scroll anim-in">
          <table className="w-full text-sm min-w-[680px]">
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
                <tr key={i} className="border-t anim-pop">
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

      <div className="space-y-4 min-w-0">
        <div className="panel-obsidiana p-5 anim-in">
          <div className="flex items-end justify-between">
            <span className="text-slate-500 uppercase tracking-wide text-xs font-semibold">
              Total a pagar
            </span>
            <span className="text-5xl font-bold precio-oro">{money(total)}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Precios incluyen IVA</p>

          {/* Medio de pago */}
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
              Medio de pago
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: "efectivo", label: "Efectivo", Icon: Banknote },
                  { id: "transferencia", label: "Transfer.", Icon: CreditCard },
                  { id: "fiado", label: "Fiado", Icon: Notebook },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setMedioPago(id)}
                  className={`flex flex-col items-center gap-1 rounded-lg py-2 text-sm font-semibold border ${
                    medioPago === id
                      ? "bg-cyan-600 text-white border-cyan-600"
                      : "border-slate-300 text-slate-700 hover:bg-white/5"
                  }`}
                >
                  <Icon size={20} /> {label}
                </button>
              ))}
            </div>

            {medioPago === "fiado" && (
              <div className="mt-3 rounded-xl border border-white/15 bg-white/5 p-3 space-y-2 anim-pop">
                <div className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold">
                  Cliente del fiado
                </div>
                <select
                  value={clienteId}
                  onChange={(e) => setClienteId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2.5"
                >
                  <option value="">— Elegir cliente —</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                      {c.saldo > 0 ? ` (debe ${money(c.saldo)})` : ""}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <span className="h-px flex-1 bg-white/10" />
                  <span className="text-[11px] text-slate-400">o crea uno nuevo</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <div className="flex gap-2">
                  <input
                    value={nuevoCliente}
                    onChange={(e) => setNuevoCliente(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && agregarCliente()}
                    placeholder="Nombre del cliente…"
                    className="flex-1 border rounded-lg px-3 py-2.5"
                  />
                  <button
                    onClick={agregarCliente}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 flex items-center gap-1.5 font-semibold shrink-0"
                  >
                    <UserPlus size={18} /> Crear
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={confirmar}
              disabled={busy}
              className="btn-accion btn-brillo col-span-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Check size={20} /> {busy ? "Registrando…" : "Confirmar venta"}
            </button>
            <button
              onClick={() => window.print()}
              className="btn-accion bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg py-2.5 flex items-center justify-center gap-2"
            >
              <Printer size={18} /> Imprimir
            </button>
            <button
              onClick={nuevaVenta}
              className="btn-accion bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg py-2.5 flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} /> Nueva
            </button>
            <button
              onClick={() => setVerBoleta((v) => !v)}
              className="btn-accion col-span-2 border-2 border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg py-2.5 flex items-center justify-center gap-2"
            >
              {verBoleta ? <EyeOff size={18} /> : <Eye size={18} />}
              {verBoleta ? "Ocultar vista previa" : "Ver vista previa de boleta"}
            </button>
          </div>
        </div>

        <div className={verBoleta ? "anim-in" : "solo-impresion"}>
          <Ticket
            nro={nro}
            fecha={hoyISO()}
            cliente={cliente || "Consumidor Final"}
            items={items}
            total={total}
          />
        </div>
      </div>
    </div>
  );
}
