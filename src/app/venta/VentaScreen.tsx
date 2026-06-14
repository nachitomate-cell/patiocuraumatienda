"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  WalletCards,
  ArrowLeftRight,
  Notebook,
  UserPlus,
} from "lucide-react";
import {
  buscarParaVenta,
  confirmarVenta,
  siguienteNroVenta,
  listarClientes,
  crearCliente,
  todosLosProductos,
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
import { useAtajos } from "@/lib/useAtajos";
import { Ticket } from "@/components/Ticket";
import { EscanerCamara } from "@/components/EscanerCamara";

// Normaliza texto para buscar sin distinguir mayúsculas ni acentos
// ("Café" y "cafe" coinciden).
function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function VentaScreen() {
  const { user } = useAuth();
  const [nro, setNro] = useState("NV-—");
  const [cliente, setCliente] = useState("");
  const [term, setTerm] = useState("");
  const [catalogo, setCatalogo] = useState<Producto[]>([]);
  const [cargandoCat, setCargandoCat] = useState(true);
  const [seleccionado, setSeleccionado] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState(1);
  // Producto manual (fuera de catálogo): descripción y precio a mano.
  const [modoManual, setModoManual] = useState(false);
  const [manualDesc, setManualDesc] = useState("");
  const [manualPrecio, setManualPrecio] = useState(0);
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

  // Carga el catálogo una vez (Firestore lo sirve luego desde su cache local).
  // La búsqueda por nombre se hace en memoria: instantánea y sin costo.
  useEffect(() => {
    todosLosProductos()
      .then(setCatalogo)
      .catch(() => {})
      .finally(() => setCargandoCat(false));
  }, []);

  // Coincidencias por nombre o código, ignorando mayúsculas y acentos.
  const resultados = useMemo(() => {
    const t = norm(term.trim());
    if (!t) return [];
    return catalogo
      .filter((p) => norm(p.descripcion).includes(t) || norm(p.codigo).includes(t))
      .slice(0, 12);
  }, [term, catalogo]);

  // Cuántas unidades de cada código hay ya en el carrito (para mostrarlo).
  const enCarritoPorCodigo = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of items) m.set(l.codigo, (m.get(l.codigo) ?? 0) + l.cantidad);
    return m;
  }, [items]);

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

  // Agrega una línea al carrito; si el producto ya está, suma cantidades.
  // Los manuales (sin código) nunca se fusionan: cada uno es independiente.
  function agregarLinea(linea: LineaVenta) {
    setItems((prev) => {
      const idx =
        linea.manual || !linea.codigo
          ? -1
          : prev.findIndex(
              (l) => l.codigo === linea.codigo && l.descuento === linea.descuento
            );
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + linea.cantidad };
        return copia;
      }
      return [...prev, linea];
    });
  }

  // Paso 1: el usuario toca un producto de la lista de resultados.
  function elegir(p: Producto) {
    setSeleccionado(p);
    setCantidad(1);
    setTerm("");
    setMsg("");
  }

  // Agregado rápido: suma 1 al carrito SIN cerrar la lista, para ir
  // agregando varios productos seguidos sin volver a buscar.
  function agregarRapido(p: Producto) {
    const yaEnCarrito = enCarritoPorCodigo.get(p.codigo) ?? 0;
    if (yaEnCarrito + 1 > p.stockActual) {
      setMsg(`Stock insuficiente: quedan ${p.stockActual} de ${p.descripcion}.`);
      return;
    }
    setMsg("");
    agregarLinea({
      codigo: p.codigo,
      descripcion: p.descripcion,
      precio: p.precio,
      cantidad: 1,
      descuento: 0,
    });
  }

  // Abre el formulario de producto manual (no está en el catálogo o la
  // descripción no corresponde). Prellena con lo que ya venía escribiendo.
  function abrirManual() {
    setModoManual(true);
    setManualDesc(term.trim());
    setManualPrecio(0);
    setCantidad(1);
    setMsg("");
  }

  function cerrarManual() {
    setModoManual(false);
    setManualDesc("");
    setManualPrecio(0);
  }

  // Agrega un producto manual al carrito (no descuenta stock al confirmar).
  function agregarManual() {
    const desc = manualDesc.trim();
    if (!desc) return setMsg("Escriba la descripción del producto.");
    if (manualPrecio <= 0) return setMsg("Escriba el precio del producto.");
    if (cantidad <= 0) return setMsg("Cantidad inválida.");
    setMsg("");
    agregarLinea({
      codigo: "",
      descripcion: desc,
      precio: manualPrecio,
      cantidad,
      descuento: 0,
      manual: true,
    });
    cerrarManual();
    setTerm("");
    setCantidad(1);
  }

  // Paso 2: confirma la cantidad y lo manda al carrito.
  function agregarSeleccion() {
    if (!seleccionado) return;
    if (cantidad <= 0) return setMsg("Cantidad inválida.");
    if (cantidad > seleccionado.stockActual) {
      setMsg(
        `Stock insuficiente: quedan ${seleccionado.stockActual} de ${seleccionado.descripcion}.`
      );
      return;
    }
    setMsg("");
    agregarLinea({
      codigo: seleccionado.codigo,
      descripcion: seleccionado.descripcion,
      precio: seleccionado.precio,
      cantidad,
      descuento: 0,
    });
    setSeleccionado(null);
    setCantidad(1);
    setTerm("");
    if (modoEscaner) inputRef.current?.focus();
  }

  // Agrega por código exacto (lector USB o cámara), buscándolo en Firestore.
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
    agregarLinea({
      codigo: p?.codigo ?? c,
      descripcion: p?.descripcion ?? "Manual",
      precio: p?.precio ?? 0,
      cantidad: cant,
      descuento: desc,
    });
    setTerm("");
    setCantidad(1);
    if (modoEscaner) inputRef.current?.focus();
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
    setTerm("");
    setSeleccionado(null);
    setCantidad(1);
    cerrarManual();
    setNro("NV-—");
    setMsg("");
    setMedioPago("efectivo");
    setClienteId("");
  }

  // Atajos de teclado de la pantalla de venta.
  useAtajos({
    "alt+b": () => {
      setSeleccionado(null);
      setModoManual(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    "alt+s": activarEscaner,
    "alt+e": () => setMedioPago("efectivo"),
    "alt+d": () => setMedioPago("debito"),
    "alt+c": () => setMedioPago("credito"),
    "alt+t": () => setMedioPago("transferencia"),
    "alt+f": () => setMedioPago("fiado"),
    "alt+g": () => confirmar(),
    "alt+n": nuevaVenta,
  });

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
            {modoManual ? (
              <div className="space-y-4 anim-pop">
                {/* Producto manual: fuera de catálogo, no descuenta stock */}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Plus size={20} className="text-emerald-600" /> Producto manual
                  </div>
                  <button
                    onClick={cerrarManual}
                    className="text-slate-500 hover:text-white hover:bg-slate-500 p-2 rounded-lg border border-slate-300"
                    aria-label="Cancelar"
                  >
                    <X size={20} />
                  </button>
                </div>

                <label className="block">
                  <span className="text-sm text-slate-500">Descripción</span>
                  <input
                    value={manualDesc}
                    onChange={(e) => setManualDesc(e.target.value)}
                    placeholder="Ej: Bebida 1.5 litros"
                    className="mt-1 w-full border-2 rounded-xl px-4 py-3 text-lg"
                  />
                </label>

                <label className="block">
                  <span className="text-sm text-slate-500">Precio (cada uno)</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={manualPrecio || ""}
                    onChange={(e) => setManualPrecio(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="mt-1 w-full border-2 rounded-xl px-4 py-3 text-lg"
                  />
                </label>

                <div>
                  <div className="text-sm text-slate-500 mb-1">Cantidad</div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                      className="w-14 h-14 rounded-xl bg-slate-200 hover:bg-slate-300 text-3xl font-bold text-slate-700 flex items-center justify-center"
                      aria-label="Quitar uno"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={cantidad}
                      onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 h-14 border-2 rounded-xl text-center text-2xl font-bold"
                    />
                    <button
                      onClick={() => setCantidad((c) => c + 1)}
                      className="w-14 h-14 rounded-xl bg-slate-200 hover:bg-slate-300 text-3xl font-bold text-slate-700 flex items-center justify-center"
                      aria-label="Agregar uno"
                    >
                      +
                    </button>
                    <div className="ml-auto text-right">
                      <div className="text-xs text-slate-500">Subtotal</div>
                      <div className="text-xl font-bold text-slate-900">
                        {money(cantidad * manualPrecio)}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={agregarManual}
                  className="btn-accion w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl py-4 text-lg flex items-center justify-center gap-2"
                >
                  <Plus size={24} /> Agregar al carrito
                </button>
              </div>
            ) : !seleccionado ? (
              <>
                {/* Paso 1: buscar por nombre */}
                <label className="block">
                  <span className="text-slate-600 font-semibold flex items-center gap-1.5">
                    <Search size={18} /> Escriba el nombre del producto
                  </span>
                  <input
                    ref={inputRef}
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && modoEscaner) agregarPorCodigo(term);
                    }}
                    placeholder={modoEscaner ? "Escanee el producto…" : "Ej: coca, pan, arroz…"}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-1 w-full border-2 rounded-xl px-4 py-3 text-lg"
                  />
                </label>

                {term.trim() !== "" && !modoEscaner && (
                  <div className="mt-3 space-y-2">
                    {cargandoCat ? (
                      <div className="text-center text-slate-400 py-4">Cargando productos…</div>
                    ) : (
                      <>
                        <div className="space-y-2 max-h-72 overflow-auto">
                          {resultados.length === 0 ? (
                            <div className="text-center text-slate-500 py-4 flex flex-col items-center gap-1">
                              <AlertTriangle size={20} className="text-amber-500" />
                              No se encontró “{term.trim()}” en el catálogo.
                            </div>
                          ) : (
                            resultados.map((p) => {
                              const enCarrito = enCarritoPorCodigo.get(p.codigo) ?? 0;
                              const sinStock = p.stockActual <= 0;
                              return (
                                <div
                                  key={p.codigo}
                                  className="w-full flex items-stretch gap-px rounded-xl border-2 border-slate-200 bg-white overflow-hidden"
                                >
                                  {/* Tocar el nombre: abre el paso de cantidad */}
                                  <button
                                    onClick={() => elegir(p)}
                                    className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left px-4 py-3 hover:bg-cyan-50 active:bg-cyan-100"
                                  >
                                    <span className="min-w-0">
                                      <span className="block font-semibold text-slate-800 text-base leading-tight truncate">
                                        {p.descripcion}
                                      </span>
                                      <span className="block text-xs leading-tight">
                                        <span className="font-mono text-slate-400">{p.codigo}</span>
                                        {enCarrito > 0 && (
                                          <span className="ml-2 font-semibold text-emerald-600">
                                            ✓ {enCarrito} en carrito
                                          </span>
                                        )}
                                      </span>
                                    </span>
                                    <span className="text-right shrink-0">
                                      <span className="block font-bold text-slate-900">
                                        {money(p.precio)}
                                      </span>
                                      <span
                                        className={`text-xs ${
                                          sinStock ? "text-red-500" : "text-slate-500"
                                        }`}
                                      >
                                        Stock: {p.stockActual}
                                      </span>
                                    </span>
                                  </button>
                                  {/* Botón +: agrega 1 y deja la lista abierta (agregar varios) */}
                                  <button
                                    onClick={() => agregarRapido(p)}
                                    disabled={sinStock}
                                    title="Agregar 1 al carrito"
                                    aria-label={`Agregar ${p.descripcion} al carrito`}
                                    className="shrink-0 w-16 flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white disabled:opacity-40"
                                  >
                                    <Plus size={24} />
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* No está, o la descripción no corresponde: agregar a mano */}
                        <button
                          onClick={abrirManual}
                          className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold px-4 py-3"
                        >
                          <Plus size={18} /> No está en la lista — agregar a mano
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4 anim-pop">
                {/* Paso 2: elegir cantidad y agregar */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold text-slate-900 leading-tight">
                      {seleccionado.descripcion}
                    </div>
                    <div className="text-slate-600">
                      {money(seleccionado.precio)} · Stock: {seleccionado.stockActual}
                    </div>
                  </div>
                  <button
                    onClick={() => setSeleccionado(null)}
                    className="text-slate-500 hover:text-white hover:bg-slate-500 p-2 rounded-lg border border-slate-300"
                    aria-label="Elegir otro producto"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div>
                  <div className="text-sm text-slate-500 mb-1">Cantidad</div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                      className="w-14 h-14 rounded-xl bg-slate-200 hover:bg-slate-300 text-3xl font-bold text-slate-700 flex items-center justify-center"
                      aria-label="Quitar uno"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={cantidad}
                      onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 h-14 border-2 rounded-xl text-center text-2xl font-bold"
                    />
                    <button
                      onClick={() => setCantidad((c) => c + 1)}
                      className="w-14 h-14 rounded-xl bg-slate-200 hover:bg-slate-300 text-3xl font-bold text-slate-700 flex items-center justify-center"
                      aria-label="Agregar uno"
                    >
                      +
                    </button>
                    <div className="ml-auto text-right">
                      <div className="text-xs text-slate-500">Subtotal</div>
                      <div className="text-xl font-bold text-slate-900">
                        {money(cantidad * seleccionado.precio)}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={agregarSeleccion}
                  className="btn-accion w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl py-4 text-lg flex items-center justify-center gap-2"
                >
                  <Plus size={24} /> Agregar al carrito
                </button>
              </div>
            )}
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
                  <td className="px-3 py-2 font-mono">
                    {l.codigo || (
                      <span className="text-[11px] font-sans font-semibold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                        Manual
                      </span>
                    )}
                  </td>
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
                  { id: "debito", label: "Débito", Icon: CreditCard },
                  { id: "credito", label: "Crédito", Icon: WalletCards },
                  { id: "transferencia", label: "Transfer.", Icon: ArrowLeftRight },
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
