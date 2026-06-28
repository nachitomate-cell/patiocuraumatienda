"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ShoppingBag,
  Search,
  Plus,
  X,
  Check,
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
  Minimize2,
  Maximize2,
  Wallet,
  PlayCircle,
  StopCircle,
} from "lucide-react";
import Link from "next/link";
import {
  buscarParaVenta,
  confirmarVenta,
  siguienteNroVenta,
  listarClientes,
  crearCliente,
  todosLosProductos,
  cajaAbierta,
  ventasEnRango,
  abrirCaja,
  escucharCajaAbierta,
} from "@/lib/repo";
import {
  subtotalLinea,
  type LineaVenta,
  type Producto,
  type Cliente,
  type MedioPago,
  type Caja,
} from "@/lib/types";
import { money, hoyISO } from "@/lib/format";
import { useVendedor } from "@/lib/vendedor";
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
  const vendedor = useVendedor();
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
  // Folio externo de boleta. Se pide en un panel ANTES de registrar la venta,
  // así entra en la misma escritura a Firestore.
  const [codigoBoleta, setCodigoBoleta] = useState("");
  const [pidiendoCod, setPidiendoCod] = useState(false);
  // Alerta de exceso de efectivo en caja. Se setea cuando una venta cruza el
  // umbralRetiro definido al abrir la caja (default $200.000). Persiste en
  // pantalla hasta que el cajero la descarte.
  const [alertaCaja, setAlertaCaja] = useState<{ saldo: number; umbral: number } | null>(null);
  const [alertaMinimizada, setAlertaMinimizada] = useState(false);
  // Eliminada por el cajero. Vuelve a aparecer recién cuando un retiro baja el
  // saldo bajo el umbral y una venta posterior lo cruza de nuevo.
  const [alertaDescartada, setAlertaDescartada] = useState(false);
  // Caja del turno actual (null = no hay caja abierta). Si no hay caja, se
  // muestra un banner para abrirla desde aquí sin tener que ir a /caja.
  const [cajaActiva, setCajaActiva] = useState<Caja | null>(null);
  const [abrirCajaModal, setAbrirCajaModal] = useState(false);
  const [fondoApertura, setFondoApertura] = useState(0);
  const [umbralApertura, setUmbralApertura] = useState(200000);
  const [abriendoCaja, setAbriendoCaja] = useState(false);
  const [errorCaja, setErrorCaja] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const codInputRef = useRef<HTMLInputElement>(null);

  const total = items.reduce((s, l) => s + subtotalLinea(l), 0);

  useEffect(() => {
    listarClientes()
      .then(setClientes)
      .catch(() => {});
  }, []);

  // Pedir permiso de notificaciones del sistema al entrar a la pantalla.
  // Si el navegador no lo soporta o el usuario lo niega, igual mostramos el
  // banner en pantalla, así nunca se pierde la alerta.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Al cargar la pantalla, evalúa el estado actual de la caja para mostrar la
  // alarma si el efectivo ya viene sobre el umbral de un turno anterior, y se
  // suscribe en vivo a la caja activa para que aperturas/cierres hechos en
  // otro PC se reflejen al instante en este equipo.
  useEffect(() => {
    evaluarCaja().catch(() => {});
    const unsub = escucharCajaAbierta((c) => {
      setCajaActiva(c);
      // Si otro PC abrió/cerró caja, recalculamos por si cambia el saldo o
      // el umbral relevante para la alarma.
      evaluarCaja().catch(() => {});
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abre la caja del turno con el vendedor del header. No pedimos el nombre:
  // viene del chip de vendedor del header (useVendedor). El listener en vivo
  // se encarga de propagar la apertura al estado local sin refetch.
  async function confirmarAbrirCaja() {
    if (abriendoCaja) return;
    setErrorCaja("");
    setAbriendoCaja(true);
    try {
      await abrirCaja(fondoApertura, umbralApertura, vendedor);
      setAbrirCajaModal(false);
      setMsg(`Caja abierta por ${vendedor || "sin vendedor"}.`);
    } catch (e) {
      setErrorCaja((e as Error).message || "No se pudo abrir la caja.");
    } finally {
      setAbriendoCaja(false);
    }
  }

  // Calcula el saldo actual de la caja abierta y actualiza la alerta:
  // - Si supera el umbral, mantiene el banner visible con el saldo al día.
  // - Si bajó (por un retiro) o no hay caja, lo limpia.
  // Retorna el saldo previo (sin contar montoVenta) para que el caller decida
  // si dispara una notificación del sistema en el momento del cruce.
  async function evaluarCaja(montoVenta = 0): Promise<{ antes: number; ahora: number; umbral: number } | null> {
    const caja = await cajaAbierta();
    if (!caja || !caja.umbralRetiro || caja.umbralRetiro <= 0) {
      setAlertaCaja(null);
      return null;
    }
    const vs = await ventasEnRango(caja.aperturaEn, Date.now());
    const ingresoEf = vs
      .filter((v) => v.medioPago === "efectivo")
      .reduce((s, v) => s + v.total, 0);
    const totalRetiros = (caja.retiros ?? []).reduce((s, r) => s + r.monto, 0);
    const totalIngresos = (caja.ingresos ?? []).reduce((s, i) => s + i.monto, 0);
    const totalDev = (caja.devoluciones ?? []).reduce((s, d) => s + d.monto, 0);
    const ahora = caja.fondoInicial + ingresoEf + totalIngresos - totalRetiros - totalDev;
    const antes = ahora - montoVenta;
    const supera = ahora > caja.umbralRetiro;
    setAlertaCaja((prev) => {
      // Transición no-alerta → alerta: reseteamos los estados de visibilidad
      // para que el banner grande vuelva a aparecer en todo su tamaño.
      if (supera && !prev) {
        setAlertaMinimizada(false);
        setAlertaDescartada(false);
      }
      // Si dejó de superar el umbral, también reseteamos descartada para que
      // el próximo cruce se muestre de nuevo.
      if (!supera && prev) setAlertaDescartada(false);
      return supera ? { saldo: ahora, umbral: caja.umbralRetiro } : null;
    });
    return { antes, ahora, umbral: caja.umbralRetiro };
  }

  // Después de una venta en efectivo: refresca el banner y, sólo si la venta
  // cruzó el umbral en este momento, dispara la notificación del sistema.
  async function chequearAlertaCaja(montoVenta: number) {
    try {
      const r = await evaluarCaja(montoVenta);
      if (!r) return;
      if (r.antes <= r.umbral && r.ahora > r.umbral) {
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("Saca efectivo de la caja", {
              body: `Saldo ${money(r.ahora)} · supera el umbral de ${money(r.umbral)}.`,
              tag: "alerta-caja-umbral",
              requireInteraction: true,
            });
          } catch {}
        }
      }
    } catch {
      // Silencioso: si falla la consulta no rompemos el flujo de venta.
    }
  }

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
  // Se permite vender bajo stock (el stockActual queda en negativo al
  // confirmar): solo se avisa, no se bloquea. Casos típicos: la mercadería ya
  // llegó pero todavía no se registró, o el ítem está en exhibición pero el
  // resto está en bodega.
  function agregarRapido(p: Producto): boolean {
    const yaEnCarrito = enCarritoPorCodigo.get(p.codigo) ?? 0;
    if (yaEnCarrito + 1 > p.stockActual) {
      setMsg(
        `Aviso: ${p.descripcion} sin stock suficiente (quedan ${p.stockActual}). Se agrega igual; el stock quedará en negativo.`
      );
    } else {
      setMsg("");
    }
    agregarLinea({
      codigo: p.codigo,
      descripcion: p.descripcion,
      precio: p.precio,
      cantidad: 1,
      descuento: 0,
    });
    return true;
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
      // Se permite vender bajo stock: solo avisar.
      setMsg(
        `Aviso: ${seleccionado.descripcion} sin stock suficiente (quedan ${seleccionado.stockActual}). Se agrega igual; el stock quedará en negativo.`
      );
    } else {
      setMsg("");
    }
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
      // Aviso, no bloqueo: la venta procede aunque el stock quede negativo.
      setMsg(
        `Aviso: ${p.descripcion} sin stock suficiente (quedan ${p.stockActual}). Se agrega igual; el stock quedará en negativo.`
      );
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

  // Edita una línea del carrito directamente (cantidad, precio o descuento).
  function editarLinea(i: number, cambios: Partial<LineaVenta>) {
    setItems((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...cambios } : l)));
  }

  // Valida y abre el panel de cierre. La venta NO se registra todavía: se
  // espera a que el cajero ingrese el código de boleta para escribir todo
  // junto en una sola operación.
  function abrirCierre() {
    if (busy || pidiendoCod) return;
    if (items.length === 0) return setMsg("No hay productos en el carrito.");
    if (medioPago === "fiado" && !clienteId)
      return setMsg("Seleccione o cree un cliente para fiar.");
    setMsg("");
    // En transferencia no hay boleta física que tenga folio asociado, así que
    // saltamos el panel y registramos directamente.
    if (medioPago === "transferencia") {
      setCodigoBoleta("");
      confirmarYImprimir();
      return;
    }
    setPidiendoCod(true);
    setTimeout(() => codInputRef.current?.focus(), 50);
  }

  // Registra la venta con el código de boleta ya ingresado, imprime y arranca
  // una venta nueva. Una única escritura a Firestore por venta.
  async function confirmarYImprimir() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const nuevoNro = await siguienteNroVenta();
      const cli = clientes.find((c) => c.id === clienteId);
      const codBoleta = codigoBoleta.trim();
      const base = {
        nro: nuevoNro,
        fecha: hoyISO(),
        cliente: cliente || "Consumidor Final",
        items,
        total,
        vendedor,
        medioPago,
        codigoBoleta: codBoleta,
      };
      await confirmarVenta(
        medioPago === "fiado"
          ? { ...base, clienteId, clienteNombre: cli?.nombre ?? "" }
          : base
      );
      setNro(nuevoNro);
      setPidiendoCod(false);
      setMsg(
        medioPago === "fiado"
          ? `Venta ${nuevoNro} fiada a ${cli?.nombre ?? "cliente"}.`
          : `Venta ${nuevoNro} registrada (${medioPago}).`
      );
      // Si fue venta en efectivo, chequea si la caja cruzó el umbral. No
      // bloquea la impresión: corre en paralelo.
      if (medioPago === "efectivo") {
        chequearAlertaCaja(total);
      }
      // Esperar a que React pinte la boleta con el nro nuevo y el modal se
      // haya cerrado del DOM, imprimir y, al cerrar el diálogo (impreso o
      // cancelado), arrancar una venta nueva. Doble RAF + timeout extra para
      // que el navegador no descarte el print por timing.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            const onAfter = () => {
              window.removeEventListener("afterprint", onAfter);
              nuevaVenta();
            };
            window.addEventListener("afterprint", onAfter);
            try {
              window.print();
            } catch {
              setMsg("No se pudo abrir el diálogo de impresión. Imprimí desde el menú del navegador (Ctrl+P).");
              window.removeEventListener("afterprint", onAfter);
            }
          }, 120);
        });
      });
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
    setCodigoBoleta("");
    setPidiendoCod(false);
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
    "alt+g": () => abrirCierre(),
    "alt+n": nuevaVenta,
  });

  return (
    <div className="space-y-4">
      {!cajaActiva && (
        <div className="rounded-2xl border-2 border-cyan-400 bg-gradient-to-r from-cyan-50 to-sky-50 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow no-print">
          <Wallet size={48} className="text-cyan-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-slate-900 text-xl leading-tight">
              No hay caja abierta
            </div>
            <div className="text-sm text-slate-700 mt-0.5">
              Hoy trabaja: <strong>{vendedor || "Sin vendedor"}</strong>. Abre la caja para llevar el control del efectivo del turno.
            </div>
          </div>
          <button
            onClick={() => {
              setFondoApertura(0);
              setUmbralApertura(200000);
              setErrorCaja("");
              setAbrirCajaModal(true);
            }}
            className="btn-accion bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl px-5 py-3 flex items-center gap-2 shrink-0 shadow"
          >
            <PlayCircle size={20} /> Abrir caja
          </button>
        </div>
      )}

      {cajaActiva && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 flex flex-wrap items-center gap-3 text-sm no-print">
          <Wallet size={18} className="text-emerald-700 shrink-0" />
          <span className="text-emerald-900 flex-1 min-w-0">
            Caja abierta por <strong>{cajaActiva.abridoPor || "—"}</strong> · fondo {money(cajaActiva.fondoInicial)} · umbral {money(cajaActiva.umbralRetiro)}
          </span>
          <Link
            href="/caja"
            className="text-emerald-800 hover:text-white hover:bg-emerald-700 border border-emerald-400 hover:border-emerald-700 rounded-lg px-3 py-1.5 font-semibold flex items-center gap-1.5 shrink-0"
          >
            <StopCircle size={16} /> Cerrar caja
          </Link>
        </div>
      )}

      {alertaCaja && !alertaDescartada && (
        alertaMinimizada ? (
          <div className="w-full rounded-xl border-2 border-red-500 bg-red-600 text-white px-3 py-2 flex items-center gap-2 shadow-md no-print">
            <button
              onClick={() => setAlertaMinimizada(false)}
              className="flex-1 flex items-center gap-3 text-left min-w-0 hover:opacity-90"
              title="Mostrar alarma"
            >
              <AlertTriangle size={20} className="shrink-0 animate-pulse" />
              <span className="font-bold flex-1 truncate">
                Caja sobre umbral: {money(alertaCaja.saldo)} (límite {money(alertaCaja.umbral)})
              </span>
              <Maximize2 size={16} className="shrink-0 opacity-80" />
            </button>
            <button
              onClick={() => setAlertaDescartada(true)}
              className="shrink-0 text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg p-1.5"
              aria-label="Eliminar alarma"
              title="Eliminar (reaparece sólo si baja del umbral y vuelve a cruzarlo)"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="relative rounded-2xl border-4 border-red-500 bg-gradient-to-r from-red-600 to-red-700 p-6 flex items-center gap-5 shadow-2xl animate-pulse no-print">
            <div className="absolute top-2 right-2 flex items-center gap-1">
              <button
                onClick={() => setAlertaMinimizada(true)}
                className="text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg p-1.5"
                aria-label="Minimizar alarma"
                title="Minimizar"
              >
                <Minimize2 size={18} />
              </button>
              <button
                onClick={() => setAlertaDescartada(true)}
                className="text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg p-1.5"
                aria-label="Eliminar alarma"
                title="Eliminar (reaparece sólo si baja del umbral y vuelve a cruzarlo)"
              >
                <X size={18} />
              </button>
            </div>
            <AlertTriangle size={64} className="text-white shrink-0 drop-shadow" />
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-white text-3xl sm:text-4xl leading-tight tracking-tight drop-shadow">
                ¡SACA EFECTIVO DE LA CAJA!
              </div>
              <div className="text-white/95 text-lg sm:text-xl font-bold mt-2">
                Saldo {money(alertaCaja.saldo)} · supera el umbral de {money(alertaCaja.umbral)}
              </div>
              <div className="text-white/80 text-sm mt-1">
                Anda a <span className="font-mono">/caja</span> y registra un retiro para volver a un saldo seguro.
              </div>
            </div>
          </div>
        )
      )}

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
                      if (e.key !== "Enter") return;
                      // Escáner: agrega por código exacto. Búsqueda normal:
                      // Enter agrega el primer resultado y limpia para el siguiente.
                      if (modoEscaner) {
                        agregarPorCodigo(term);
                      } else if (resultados.length > 0) {
                        if (agregarRapido(resultados[0])) setTerm("");
                      }
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
                                  {/* Botón +: agrega 1 y deja la lista abierta (agregar varios).
                                      Sin stock no se bloquea (se vende bajo stock,
                                      el stockActual queda en negativo): solo cambia el
                                      color para que el cajero lo note. */}
                                  <button
                                    onClick={() => agregarRapido(p)}
                                    title={
                                      sinStock
                                        ? "Sin stock — se agrega igual (quedará negativo)"
                                        : "Agregar 1 al carrito"
                                    }
                                    aria-label={`Agregar ${p.descripcion} al carrito`}
                                    className={`shrink-0 w-16 flex items-center justify-center text-white ${
                                      sinStock
                                        ? "bg-amber-500 hover:bg-amber-600 active:bg-amber-700"
                                        : "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800"
                                    }`}
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
                  <td className="px-2 py-1.5">
                    <input
                      value={l.descripcion}
                      onChange={(e) => editarLinea(i, { descripcion: e.target.value })}
                      className="w-full min-w-[9rem] border rounded-lg px-2 py-1"
                      aria-label="Descripción"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={l.cantidad}
                      onChange={(e) =>
                        editarLinea(i, { cantidad: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="w-16 border rounded-lg px-2 py-1 text-right"
                      aria-label="Cantidad"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={l.precio}
                      onChange={(e) =>
                        editarLinea(i, { precio: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-24 border rounded-lg px-2 py-1 text-right"
                      aria-label="Precio"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        inputMode="numeric"
                        value={l.descuento}
                        onChange={(e) =>
                          editarLinea(i, {
                            descuento: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                          })
                        }
                        className="w-14 border rounded-lg px-2 py-1 text-right"
                        aria-label="Descuento %"
                      />
                      <span className="text-slate-400 text-xs">%</span>
                    </div>
                  </td>
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

          <div className="mt-4 space-y-2">
            <button
              onClick={abrirCierre}
              disabled={busy || pidiendoCod}
              className="btn-accion btn-brillo w-full bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold rounded-2xl py-8 text-3xl flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg ring-2 ring-cyan-400/40"
            >
              <Check size={40} /> Confirmar venta
            </button>
            <button
              onClick={() => setVerBoleta((v) => !v)}
              className="btn-accion w-full border-2 border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg py-2.5 flex items-center justify-center gap-2"
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
            codigoBoleta={codigoBoleta}
          />
        </div>
      </div>
      </div>

      {abrirCajaModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => !abriendoCaja && setAbrirCajaModal(false)}
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl anim-pop p-6">
            <button
              onClick={() => !abriendoCaja && setAbrirCajaModal(false)}
              disabled={abriendoCaja}
              className="absolute top-2 right-2 text-slate-400 hover:text-slate-700 p-1 rounded disabled:opacity-30"
              aria-label="Cancelar"
              title="Cancelar"
            >
              <X size={16} />
            </button>
            <h3 className="text-2xl font-extrabold text-slate-900 mb-1 flex items-center gap-2">
              <Wallet size={26} className="text-cyan-600" /> Abrir caja
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Se abre como <strong className="text-slate-800">{vendedor || "Sin vendedor"}</strong>{" "}
              (cámbialo en el chip del header si te equivocaste).
            </p>
            <label className="block mb-3">
              <span className="text-sm text-slate-600 font-medium">Fondo inicial</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                autoFocus
                value={fondoApertura || ""}
                onChange={(e) => setFondoApertura(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0"
                className="mt-1 w-full border-2 rounded-xl px-4 py-3 text-xl"
              />
            </label>
            <label className="block mb-3">
              <span className="text-sm text-slate-600 font-medium">
                Umbral de retiro (alerta sobre este saldo)
              </span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={umbralApertura || ""}
                onChange={(e) => setUmbralApertura(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0 = sin alerta"
                className="mt-1 w-full border-2 rounded-xl px-4 py-3 text-xl"
              />
            </label>
            {errorCaja && (
              <div className="mb-3 text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">
                {errorCaja}
              </div>
            )}
            <button
              onClick={confirmarAbrirCaja}
              disabled={abriendoCaja || !vendedor}
              className="btn-accion w-full bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold rounded-xl py-4 text-xl flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <PlayCircle size={24} />
              {abriendoCaja ? "Abriendo…" : "Abrir caja"}
            </button>
            {!vendedor && (
              <p className="text-[11px] text-red-600 mt-2 text-center">
                Necesitas indicar tu nombre en el chip del header antes de abrir la caja.
              </p>
            )}
          </div>
        </div>
      )}

      {pidiendoCod && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl anim-pop p-6">
            <button
              onClick={() => !busy && setPidiendoCod(false)}
              disabled={busy}
              className="absolute top-2 right-2 text-slate-400 hover:text-slate-700 p-1 rounded disabled:opacity-30"
              aria-label="Cancelar"
              title="Cancelar"
            >
              <X size={14} />
            </button>
            <div className="text-xs uppercase tracking-wide text-cyan-700 font-bold mb-1">
              Total {money(total)}
            </div>
            <h3 className="text-2xl font-extrabold text-slate-900 mb-1">Código de boleta</h3>
            <p className="text-sm text-slate-500 mb-4">
              Ingrese el folio de la boleta para registrar esta venta.
            </p>
            <input
              ref={codInputRef}
              value={codigoBoleta}
              onChange={(e) => setCodigoBoleta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmarYImprimir();
              }}
              placeholder="Folio de la boleta"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              className="w-full border-2 rounded-xl px-4 py-3 text-2xl font-mono text-center disabled:bg-slate-100"
            />
            <button
              onClick={confirmarYImprimir}
              disabled={busy}
              className="btn-accion mt-4 w-full bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold rounded-xl py-4 text-xl flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Check size={24} /> {busy ? "Registrando…" : "Confirmar e imprimir"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
