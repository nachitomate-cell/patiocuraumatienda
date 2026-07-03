"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Plus,
  Check,
  PackageCheck,
  Pencil,
  Trash2,
  X,
  ShoppingBag,
  Download,
  Loader2,
  RefreshCw,
  History,
  Search,
  PackagePlus,
  PackageMinus,
  AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  getEmprendedorPorToken,
  agregarProductoEmprendedor,
  productosDeEmprendedor,
  ventasDeEmprendedor,
  actualizarProductoEmprendedor,
  eliminarProductoEmprendedor,
  movimientosDeEmprendedor,
} from "@/lib/repo";
import {
  subtotalLinea,
  type Emprendedor,
  type MovimientoEmprendedor,
  type Producto,
  type Venta,
} from "@/lib/types";
import { money, hoyISO } from "@/lib/format";
import { useNegocio } from "@/lib/negocio-context";
import { useAuth } from "@/lib/auth";
import { HistorialMovs } from "@/components/HistorialMovs";
import { SelectorFecha } from "@/components/SelectorFecha";
import { Modal } from "@/components/Modal";
import { estadoVence } from "@/lib/vence";

export function AltaEmprendedorScreen({ token }: { token: string }) {
  const { user, loading } = useAuth();
  const NEGOCIO = useNegocio();
  const [emp, setEmp] = useState<Emprendedor | null>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "invalido" | "inactivo">("cargando");

  // Estado del servidor (productos + ventas + bitácora del emprendedor).
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [movs, setMovs] = useState<MovimientoEmprendedor[]>([]);
  const [cargandoDatos, setCargandoDatos] = useState(false);

  // Formulario "agregar producto".
  const [descripcion, setDescripcion] = useState("");
  const [precio, setPrecio] = useState(0);
  const [stock, setStock] = useState(1);
  const [vence, setVence] = useState("");
  // Código personalizado opcional. Si queda vacío, el backend auto-genera
  // PREFIJO-NNNN; si lo escribe, valida formato y unicidad. Se trackea
  // `extrasEnSesion` para que el sugerido en placeholder avance localmente
  // tras cada alta sin refetch del emprendedor.
  const [codigoCustom, setCodigoCustom] = useState("");
  const [extrasEnSesion, setExtrasEnSesion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Edición de un producto existente.
  const [editCodigo, setEditCodigo] = useState<string | null>(null);
  const [edDescripcion, setEdDescripcion] = useState("");
  const [edPrecio, setEdPrecio] = useState(0);
  const [edStock, setEdStock] = useState(0);
  const [edVence, setEdVence] = useState("");
  const [busyEdit, setBusyEdit] = useState(false);
  const [editErr, setEditErr] = useState("");

  // Eliminación de producto: guardamos el producto candidato para pasarlo al
  // Modal de confirmación (evita window.confirm nativo).
  const [eliminarObjetivo, setEliminarObjetivo] = useState<Producto | null>(null);
  const [busyEliminar, setBusyEliminar] = useState(false);
  const [eliminarErr, setEliminarErr] = useState("");

  // Buscador y ajuste rápido de stock (recibí / retiré).
  const [busqueda, setBusqueda] = useState("");
  const [quickCodigo, setQuickCodigo] = useState<string | null>(null);
  const [quickTipo, setQuickTipo] = useState<"in" | "out">("in");
  const [quickCantidad, setQuickCantidad] = useState(1);
  const [busyQuick, setBusyQuick] = useState(false);
  const [quickErr, setQuickErr] = useState("");

  const [descargando, setDescargando] = useState(false);

  // Carga inicial: emprendedor + (si ok) sus productos y ventas.
  useEffect(() => {
    if (loading || !user) return;
    let vivo = true;
    getEmprendedorPorToken(token)
      .then(async (e) => {
        if (!vivo) return;
        if (!e) {
          setEstado("invalido");
          return;
        }
        setEmp(e);
        if (e.activo === false) {
          setEstado("inactivo");
          return;
        }
        setEstado("ok");
        await cargarDatos(e);
      })
      .catch(() => vivo && setEstado("invalido"));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, loading]);

  // Refresca solo la bitácora (tras agregar/editar): evita releer ventas y
  // catálogo cuando lo único que cambió es el log. Falla silenciosamente.
  async function refrescarHistorial(empId: string) {
    try {
      const ms = await movimientosDeEmprendedor(empId, 100);
      setMovs(ms);
    } catch {
      // no-op
    }
  }

  async function cargarDatos(e: Emprendedor) {
    setCargandoDatos(true);
    try {
      // Pasamos id + prefijo: la query usa AMBOS para alcanzar productos
      // legacy migrados sin emprendedorId estampado.
      const target = { id: e.id, prefijo: e.prefijo };
      const [prods, vs, ms] = await Promise.all([
        productosDeEmprendedor(target),
        ventasDeEmprendedor(target),
        movimientosDeEmprendedor(e.id, 100),
      ]);
      prods.sort((a, b) => a.codigo.localeCompare(b.codigo));
      setProductos(prods);
      setVentas(vs);
      setMovs(ms);
    } finally {
      setCargandoDatos(false);
    }
  }

  // ===== Métricas para mostrar y para el Excel =====
  // Unidades vendidas históricas y total ingresado por código.
  const ventasPorCodigo = useMemo(() => {
    const m = new Map<string, { unidades: number; total: number }>();
    for (const v of ventas) {
      // Anuladas no cuentan.
      if (v.anulada) continue;
      for (const l of v.items) {
        const k = l.codigo || "(manual)";
        const acc = m.get(k) || { unidades: 0, total: 0 };
        acc.unidades += l.cantidad;
        acc.total += subtotalLinea(l);
        m.set(k, acc);
      }
    }
    return m;
  }, [ventas]);

  const totales = useMemo(() => {
    let unidades = 0;
    let totalVendido = 0;
    let nVentas = 0;
    let ingresoHoy = 0;
    let ingresoMes = 0;

    // Ventana de "hoy" y "este mes" en tiempo local. Usamos límite inferior
    // como epoch ms para comparar con venta.creadoEn.
    const ahora = new Date();
    const inicioHoy = new Date(
      ahora.getFullYear(),
      ahora.getMonth(),
      ahora.getDate()
    ).getTime();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();

    for (const v of ventas) {
      if (v.anulada) continue;
      nVentas++;
      const sub = v.items.reduce((s, l) => s + subtotalLinea(l), 0);
      totalVendido += sub;
      for (const l of v.items) unidades += l.cantidad;
      if (v.creadoEn >= inicioHoy) ingresoHoy += sub;
      if (v.creadoEn >= inicioMes) ingresoMes += sub;
    }
    const stockTotal = productos.reduce((s, p) => s + (p.stockActual || 0), 0);
    return { unidades, totalVendido, nVentas, stockTotal, ingresoHoy, ingresoMes };
  }, [ventas, productos]);

  // ===== Alta =====
  async function agregar() {
    if (!emp) return;
    if (!descripcion.trim()) return setMsg("Escribe el nombre del producto.");
    if (precio <= 0) return setMsg("Ingresa un precio válido.");
    setBusy(true);
    setMsg("");
    try {
      const cod = await agregarProductoEmprendedor(
        emp,
        { descripcion, precio, stock, vence, codigo: codigoCustom },
        "emprendedor",
        emp.nombre
      );
      setMsg(`✅ "${descripcion}" agregado (código ${cod}).`);
      setProductos((prev) =>
        [
          {
            codigo: cod,
            descripcion: descripcion.trim(),
            precio,
            stockActual: stock,
            costo: 0,
            emprendedorId: emp.id,
            emprendedorNombre: emp.nombre,
            ...(vence ? { vence } : {}),
          } as Producto,
          ...prev,
        ].sort((a, b) => a.codigo.localeCompare(b.codigo))
      );
      setDescripcion("");
      setPrecio(0);
      setStock(1);
      setVence("");
      setCodigoCustom("");
      setExtrasEnSesion((x) => x + 1);
      refrescarHistorial(emp.id);
    } catch (e) {
      // Si el backend rechaza el código (formato incorrecto, ya existe),
      // su mensaje sirve para que el emprendedor corrija sin perder el form.
      setMsg(
        e instanceof Error
          ? `❌ ${e.message}`
          : "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo."
      );
    } finally {
      setBusy(false);
    }
  }

  // ===== Edición =====
  function abrirEdicion(p: Producto) {
    setEditCodigo(p.codigo);
    setEdDescripcion(p.descripcion || "");
    setEdPrecio(p.precio || 0);
    setEdStock(p.stockActual || 0);
    setEdVence(p.vence || "");
    setEditErr("");
    setQuickCodigo(null);
  }

  // Lista filtrada por el buscador. Match en código o descripción (case-insensitive).
  const productosFiltrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (!t) return productos;
    return productos.filter(
      (p) =>
        p.codigo.toLowerCase().includes(t) ||
        (p.descripcion || "").toLowerCase().includes(t)
    );
  }, [productos, busqueda]);

  // ===== Ajuste rápido de stock (recibí / retiré) =====
  function abrirQuick(p: Producto, tipo: "in" | "out") {
    setQuickCodigo(p.codigo);
    setQuickTipo(tipo);
    setQuickCantidad(1);
    setQuickErr("");
    setEditCodigo(null);
  }

  async function confirmarQuick(p: Producto) {
    if (!emp) return;
    const n = Math.max(0, Math.round(quickCantidad || 0));
    if (n <= 0) {
      setQuickErr("Ingresa una cantidad mayor a 0.");
      return;
    }
    const actual = p.stockActual || 0;
    const nuevo = quickTipo === "in" ? actual + n : actual - n;
    if (nuevo < 0) {
      setQuickErr(`No puedes retirar ${n}: solo tienes ${actual} en stock.`);
      return;
    }
    setBusyQuick(true);
    setQuickErr("");
    try {
      await actualizarProductoEmprendedor(
        emp,
        p.codigo,
        { stockActual: nuevo },
        "emprendedor",
        emp.nombre
      );
      setProductos((prev) =>
        prev.map((x) => (x.codigo === p.codigo ? { ...x, stockActual: nuevo } : x))
      );
      setQuickCodigo(null);
      refrescarHistorial(emp.id);
    } catch (e) {
      setQuickErr(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusyQuick(false);
    }
  }

  async function guardarEdicion() {
    if (!emp || !editCodigo) return;
    setBusyEdit(true);
    setEditErr("");
    try {
      await actualizarProductoEmprendedor(
        emp,
        editCodigo,
        {
          descripcion: edDescripcion,
          precio: edPrecio,
          stockActual: edStock,
          vence: edVence,
        },
        "emprendedor",
        emp.nombre
      );
      setProductos((prev) =>
        prev.map((p) =>
          p.codigo === editCodigo
            ? {
                ...p,
                descripcion: edDescripcion.trim(),
                precio: Math.max(0, Math.round(edPrecio || 0)),
                stockActual: Math.max(0, Math.round(edStock || 0)),
                vence: edVence.trim() || undefined,
              }
            : p
        )
      );
      setEditCodigo(null);
      refrescarHistorial(emp.id);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusyEdit(false);
    }
  }

  // ===== Eliminación =====
  // Confirma el soft-delete del producto en curso. El backend valida
  // pertenencia (por emprendedorId o prefijo) y tira si no matchea; la UI se
  // limita a actualizar el estado local optimista tras un OK.
  async function confirmarEliminar() {
    if (!emp || !eliminarObjetivo) return;
    setBusyEliminar(true);
    setEliminarErr("");
    try {
      await eliminarProductoEmprendedor(
        emp,
        eliminarObjetivo.codigo,
        "emprendedor",
        emp.nombre
      );
      const nombre = eliminarObjetivo.descripcion || eliminarObjetivo.codigo;
      setProductos((prev) => prev.filter((p) => p.codigo !== eliminarObjetivo.codigo));
      // Si el producto eliminado era el que estaba en edición o en quick-
      // ajuste, cerramos esos paneles para no dejar UI colgando.
      if (editCodigo === eliminarObjetivo.codigo) setEditCodigo(null);
      if (quickCodigo === eliminarObjetivo.codigo) setQuickCodigo(null);
      setEliminarObjetivo(null);
      setMsg(`🗑️ "${nombre}" fue eliminado de tu inventario.`);
      refrescarHistorial(emp.id);
    } catch (e) {
      setEliminarErr(
        e instanceof Error ? e.message : "No se pudo eliminar el producto."
      );
    } finally {
      setBusyEliminar(false);
    }
  }

  // ===== Excel =====
  // rango: "hoy" = solo ventas del día actual; "mes" = del mes en curso;
  // "todo" = histórico cargado en memoria. Productos siempre se incluyen
  // completos (filtrar el catálogo por ventas del rango no aporta).
  function descargarReporte(rango: "hoy" | "mes" | "todo") {
    if (!emp) return;
    setDescargando(true);
    try {
      const ahora = new Date();
      const inicioHoy = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate()
      ).getTime();
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
      const ventasRango = ventas.filter((v) => {
        if (rango === "hoy") return v.creadoEn >= inicioHoy;
        if (rango === "mes") return v.creadoEn >= inicioMes;
        return true;
      });

      // Stats por código limitadas al rango: el catálogo muestra "unidades
      // vendidas" e "ingresos generados" del mismo período del reporte.
      const statsRango = new Map<string, { unidades: number; total: number }>();
      for (const v of ventasRango) {
        if (v.anulada) continue;
        for (const l of v.items) {
          const k = l.codigo || "(manual)";
          const acc = statsRango.get(k) || { unidades: 0, total: 0 };
          acc.unidades += l.cantidad;
          acc.total += subtotalLinea(l);
          statsRango.set(k, acc);
        }
      }

      const productosRows = productos.map((p) => {
        const stats = statsRango.get(p.codigo) || { unidades: 0, total: 0 };
        return {
          Codigo: p.codigo,
          Descripcion: p.descripcion,
          "Precio actual": p.precio,
          "Stock actual": p.stockActual,
          Vence: p.vence || "",
          "Unidades vendidas": stats.unidades,
          "Ingresos generados": stats.total,
        };
      });

      const ventasRows = ventasRango.flatMap((v) =>
        v.items.map((l) => ({
          "Nro venta": v.nro,
          Fecha: v.fecha,
          Hora: new Date(v.creadoEn).toLocaleTimeString("es-CL", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          Anulada: v.anulada ? "Sí" : "",
          Codigo: l.codigo,
          Descripcion: l.descripcion,
          Cantidad: l.cantidad,
          "Valor unidad": l.precio,
          "Dscto%": l.descuento,
          Subtotal: subtotalLinea(l),
        }))
      );

      // Totales recalculados sobre el rango (no usa `totales` global, que
      // representa el histórico completo).
      let unidadesR = 0;
      let totalR = 0;
      let nVentasR = 0;
      for (const v of ventasRango) {
        if (v.anulada) continue;
        nVentasR++;
        for (const l of v.items) {
          unidadesR += l.cantidad;
          totalR += subtotalLinea(l);
        }
      }

      const periodo =
        rango === "hoy"
          ? hoyISO()
          : rango === "mes"
          ? `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`
          : "histórico";

      const resumenRows = [
        {
          Emprendedor: emp.nombre,
          Negocio: NEGOCIO.nombre || NEGOCIO.slug,
          Generado: new Date().toLocaleString("es-CL"),
          Período: periodo,
          "Productos (catálogo)": productos.length,
          "Stock total (unidades)": totales.stockTotal,
          "Ventas en el período (no anuladas)": nVentasR,
          "Unidades vendidas en el período": unidadesR,
          "Total ingresado en el período": totalR,
        },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenRows), "Resumen");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          productosRows.length ? productosRows : [{ Aviso: "Sin productos" }]
        ),
        "Productos"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          ventasRows.length ? ventasRows : [{ Aviso: "Sin ventas registradas" }]
        ),
        "Ventas"
      );

      const slugEmp = (emp.nombre || emp.prefijo)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      XLSX.writeFile(wb, `reporte_${slugEmp}_${rango}_${periodo}.xlsx`);
    } finally {
      setDescargando(false);
    }
  }

  // ===== Estados de carga =====
  if (estado === "cargando") {
    return <div className="mt-20 text-center text-slate-500">Cargando…</div>;
  }

  if (estado === "invalido") {
    return (
      <div className="mx-auto max-w-md mt-20 bg-white rounded-xl shadow p-6 text-center">
        <h1 className="text-lg font-bold text-slate-900">Link no válido</h1>
        <p className="text-slate-500 mt-2 text-sm">
          Este enlace no corresponde a ningún emprendedor. Pide uno nuevo al administrador de
          {" "}{NEGOCIO.nombre}.
        </p>
      </div>
    );
  }

  if (estado === "inactivo") {
    return (
      <div className="mx-auto max-w-md mt-20 bg-white rounded-xl shadow p-6 text-center">
        <h1 className="text-lg font-bold text-slate-900">Cuenta inactiva</h1>
        <p className="text-slate-500 mt-2 text-sm">
          La cuenta de <strong>{emp?.nombre}</strong> está pausada y no admite carga de productos.
          Contacta al administrador de {NEGOCIO.nombre} si necesitas reactivarla.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-3xl px-4 h-16 flex items-center gap-3">
          <Image src={NEGOCIO.logo} alt={NEGOCIO.nombre} width={36} height={48} className="h-10 w-auto" />
          <div className="leading-none">
            <div className="font-bold">{NEGOCIO.nombre}</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300/80">
              Portal del emprendedor
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        {/* Bienvenida + resumen */}
        <div className="bg-white rounded-xl shadow p-5 anim-in">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900">¡Hola, {emp?.nombre}! 👋</h1>
              <p className="text-slate-500 mt-1 text-sm">
                Gestiona tu catálogo, revisa tus ventas y descarga tu reporte.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => emp && cargarDatos(emp)}
                disabled={cargandoDatos}
                title="Refrescar datos"
                className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                <RefreshCw size={14} className={cargandoDatos ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => descargarReporte("hoy")}
                disabled={descargando || cargandoDatos}
                title="Excel con las ventas de hoy"
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {descargando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Excel diario
              </button>
              <button
                onClick={() => descargarReporte("mes")}
                disabled={descargando || cargandoDatos}
                title="Excel con las ventas del mes en curso"
                className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {descargando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Excel mensual
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Mini label="Productos" valor={productos.length.toString()} />
            <Mini label="Stock total" valor={`${totales.stockTotal} u.`} />
            <Mini label="Ventas" valor={totales.nVentas.toString()} />
          </div>

          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
              Ingresos
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Mini
                label="Hoy"
                valor={money(totales.ingresoHoy)}
                acento="emerald"
              />
              <Mini
                label="Este mes"
                valor={money(totales.ingresoMes)}
                acento="cyan"
              />
              <Mini label="Total" valor={money(totales.totalVendido)} />
            </div>
          </div>
        </div>

        {/* Alta de producto */}
        <div className="bg-white rounded-xl shadow p-5 anim-in">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-3">
            <Plus className="text-emerald-600" size={20} /> Cargar nuevo producto
          </h2>
          <div className="space-y-3">
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
                  value={precio || ""}
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
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">
                Vencimiento <span className="text-slate-400 font-normal">(opcional)</span>
              </span>
              <SelectorFecha
                value={vence}
                onChange={setVence}
                placeholder="Sin vencimiento"
                className="mt-1"
              />
            </label>
            {/* Código personalizado: opcional. Si lo dejan vacío se auto-
                genera con el prefijo del emprendedor. Sugerimos el próximo
                correlativo como placeholder. */}
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">
                Código <span className="text-slate-400 font-normal">(opcional)</span>
              </span>
              <input
                value={codigoCustom}
                onChange={(e) => setCodigoCustom(e.target.value.toUpperCase())}
                placeholder={
                  emp
                    ? `Sugerido: ${emp.prefijo}-${String(
                        (emp.productosCount || 0) + extrasEnSesion + 1
                      ).padStart(4, "0")}`
                    : ""
                }
                className="mt-1 w-full border rounded-lg px-3 py-2.5 font-mono uppercase"
              />
              <span className="block text-[11px] text-slate-500 mt-1">
                Déjalo vacío para que se genere automáticamente. Si lo escribes,
                debe empezar con <b className="font-mono">{emp?.prefijo}-</b>.
              </span>
            </label>
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

        {/* Inventario editable */}
        <div className="bg-white rounded-xl shadow p-5 anim-in">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-3">
            <PackageCheck className="text-emerald-600" size={20} /> Mi inventario (
            {productos.length})
          </h2>
          {productos.length > 0 && (
            <div className="relative mb-3">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o código…"
                className="w-full border rounded-lg pl-9 pr-9 py-2 text-sm"
              />
              {busqueda && (
                <button
                  type="button"
                  onClick={() => setBusqueda("")}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          {cargandoDatos && productos.length === 0 ? (
            <p className="text-slate-400 text-sm py-3 text-center">Cargando…</p>
          ) : productos.length === 0 ? (
            <p className="text-slate-400 text-sm py-3 text-center">
              Aún no tienes productos cargados.
            </p>
          ) : productosFiltrados.length === 0 ? (
            <p className="text-slate-400 text-sm py-3 text-center">
              Ningún producto coincide con &quot;{busqueda}&quot;.
            </p>
          ) : (
            <ul className="divide-y">
              {productosFiltrados.map((p) => {
                const enEdicion = editCodigo === p.codigo;
                const stats = ventasPorCodigo.get(p.codigo) || { unidades: 0, total: 0 };
                if (enEdicion) {
                  return (
                    <li key={p.codigo} className="py-3 anim-pop">
                      <div className="text-xs text-slate-400 font-mono mb-2">{p.codigo}</div>
                      <input
                        value={edDescripcion}
                        onChange={(e) => setEdDescripcion(e.target.value)}
                        placeholder="Descripción"
                        className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs">
                          <span className="text-slate-500">Precio ($)</span>
                          <input
                            type="number"
                            min={0}
                            value={edPrecio || ""}
                            onChange={(e) => setEdPrecio(Number(e.target.value) || 0)}
                            className="mt-1 w-full border rounded-lg px-3 py-2"
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="text-slate-500">Stock</span>
                          <input
                            type="number"
                            min={0}
                            value={edStock}
                            onChange={(e) => setEdStock(Number(e.target.value) || 0)}
                            className="mt-1 w-full border rounded-lg px-3 py-2"
                          />
                        </label>
                      </div>
                      <label className="block text-xs mt-2">
                        <span className="text-slate-500">Vencimiento (opcional)</span>
                        <SelectorFecha
                          value={edVence}
                          onChange={setEdVence}
                          placeholder="Sin vencimiento"
                          className="mt-1"
                        />
                      </label>
                      {editErr && (
                        <p className="mt-2 text-xs text-red-600">{editErr}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={guardarEdicion}
                          disabled={busyEdit}
                          className="flex items-center gap-1.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg px-3 py-2 disabled:opacity-50"
                        >
                          {busyEdit ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                          Guardar
                        </button>
                        <button
                          onClick={() => setEditCodigo(null)}
                          disabled={busyEdit}
                          className="flex items-center gap-1.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-3 py-2 disabled:opacity-50"
                        >
                          <X size={14} /> Cancelar
                        </button>
                      </div>
                    </li>
                  );
                }
                const ev = estadoVence(p.vence);
                const enQuick = quickCodigo === p.codigo;
                return (
                  <li key={p.codigo} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 truncate">
                          {p.descripcion}
                        </div>
                        <div className="text-xs text-slate-500 flex flex-wrap gap-x-2 items-center">
                          <span className="font-mono">{p.codigo}</span>
                          <span>· {p.stockActual} u.</span>
                          <span>· {money(p.precio)}</span>
                          {stats.unidades > 0 && (
                            <span className="text-emerald-700">
                              · vendidas {stats.unidades}
                            </span>
                          )}
                          {ev && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ev.bgText}`}>
                              {ev.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => abrirQuick(p, "in")}
                          title="Recibí más unidades"
                          className="flex items-center gap-1 border border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-lg px-2 py-1.5 text-xs"
                        >
                          <PackagePlus size={14} /> Recibí
                        </button>
                        <button
                          onClick={() => abrirQuick(p, "out")}
                          title="Me llevé / retiré unidades"
                          className="flex items-center gap-1 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg px-2 py-1.5 text-xs"
                        >
                          <PackageMinus size={14} /> Retiré
                        </button>
                        <button
                          onClick={() => abrirEdicion(p)}
                          title="Editar ficha completa"
                          className="flex items-center gap-1 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg px-2 py-1.5 text-xs"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setEliminarErr("");
                            setEliminarObjetivo(p);
                          }}
                          title="Eliminar producto del inventario"
                          className="flex items-center gap-1 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg px-2 py-1.5 text-xs"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {enQuick && (
                      <div className="mt-2 flex items-center gap-2 anim-pop">
                        <span className="text-xs text-slate-600">
                          {quickTipo === "in" ? "Recibí" : "Retiré"}
                        </span>
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          autoFocus
                          value={quickCantidad || ""}
                          onChange={(e) => setQuickCantidad(Number(e.target.value) || 0)}
                          className="w-20 border rounded-lg px-2 py-1.5 text-sm"
                        />
                        <span className="text-xs text-slate-500">
                          → quedará {Math.max(
                            0,
                            (p.stockActual || 0) +
                              (quickTipo === "in" ? quickCantidad : -quickCantidad)
                          )} u.
                        </span>
                        <button
                          onClick={() => confirmarQuick(p)}
                          disabled={busyQuick}
                          className={`ml-auto flex items-center gap-1 text-white text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50 ${
                            quickTipo === "in"
                              ? "bg-emerald-600 hover:bg-emerald-700"
                              : "bg-amber-600 hover:bg-amber-700"
                          }`}
                        >
                          {busyQuick ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                          Confirmar
                        </button>
                        <button
                          onClick={() => setQuickCodigo(null)}
                          disabled={busyQuick}
                          className="border border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    {enQuick && quickErr && (
                      <p className="mt-1 text-xs text-red-600">{quickErr}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Ventas */}
        <div className="bg-white rounded-xl shadow p-5 anim-in">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-3">
            <ShoppingBag className="text-cyan-600" size={20} /> Mis ventas (
            {totales.nVentas})
          </h2>
          {cargandoDatos && ventas.length === 0 ? (
            <p className="text-slate-400 text-sm py-3 text-center">Cargando…</p>
          ) : ventas.length === 0 ? (
            <p className="text-slate-400 text-sm py-3 text-center">
              Aún no se han vendido productos tuyos.
            </p>
          ) : (
            <ul className="divide-y">
              {ventas.map((v) => {
                const subtotalV = v.items.reduce((s, l) => s + subtotalLinea(l), 0);
                const hora = new Date(v.creadoEn).toLocaleTimeString("es-CL", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <li key={v.nro} className="py-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>
                        <span className="font-mono text-slate-400">{v.nro}</span>{" "}
                        <span className="text-slate-600">
                          {v.fecha} · {hora}
                        </span>
                        {v.anulada && (
                          <span className="ml-1.5 text-[10px] font-bold uppercase bg-red-600 text-white rounded px-1.5 py-0.5">
                            ANULADA
                          </span>
                        )}
                      </span>
                      <span
                        className={`font-semibold ${
                          v.anulada ? "text-slate-400 line-through" : "text-emerald-700"
                        }`}
                      >
                        {money(subtotalV)}
                      </span>
                    </div>
                    <ul className="mt-1 text-xs text-slate-500 space-y-0.5">
                      {v.items.map((l, i) => (
                        <li key={i} className="flex justify-between">
                          <span className="truncate pr-2">
                            <span className="font-mono">{l.codigo}</span> {l.descripcion}
                            {l.cantidad > 1 && ` × ${l.cantidad}`}
                          </span>
                          <span className="shrink-0">{money(subtotalLinea(l))}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Historial de cambios */}
        <div className="bg-white rounded-xl shadow p-5 anim-in">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-3">
            <History className="text-violet-600" size={20} /> Historial de cambios (
            {movs.length})
          </h2>
          {cargandoDatos && movs.length === 0 ? (
            <p className="text-slate-400 text-sm py-3 text-center">Cargando…</p>
          ) : (
            <HistorialMovs
              movs={movs}
              vacio="Aún no hay movimientos registrados."
            />
          )}
        </div>

        <p className="text-center text-xs text-slate-400 pb-6">
          {NEGOCIO.nombre}
          {NEGOCIO.ubicacion && ` · ${NEGOCIO.ubicacion}`}
        </p>
      </main>

      <Modal
        abierto={!!eliminarObjetivo}
        onCerrar={busyEliminar ? () => {} : () => setEliminarObjetivo(null)}
        titulo={eliminarObjetivo ? `Eliminar · ${eliminarObjetivo.codigo}` : ""}
        maxW="max-w-md"
      >
        {eliminarObjetivo && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-3 text-sm">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle size={16} /> ¿Estás seguro de que deseas eliminar este producto del inventario?
              </div>
              <p className="mt-1 text-xs">
                Esta acción no se puede deshacer. El producto dejará de aparecer
                en tu inventario y en la caja del negocio. Las ventas anteriores
                que lo incluyen se mantienen en el historial.
              </p>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
              <div className="font-semibold text-slate-800 truncate">
                {eliminarObjetivo.descripcion || "(sin descripción)"}
              </div>
              <div className="text-xs text-slate-500 font-mono">
                {eliminarObjetivo.codigo} · {eliminarObjetivo.stockActual} u. ·{" "}
                {money(eliminarObjetivo.precio)}
              </div>
            </div>

            {eliminarErr && <p className="text-sm text-red-600">{eliminarErr}</p>}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEliminarObjetivo(null)}
                disabled={busyEliminar}
                className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarEliminar}
                disabled={busyEliminar}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
              >
                {busyEliminar ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                Eliminar producto
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Mini({
  label,
  valor,
  acento,
}: {
  label: string;
  valor: string;
  // "emerald" o "cyan" colorean el valor; sin acento queda en slate-800.
  acento?: "emerald" | "cyan";
}) {
  const valorCls =
    acento === "emerald"
      ? "text-emerald-700"
      : acento === "cyan"
      ? "text-cyan-700"
      : "text-slate-800";
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-base font-bold mt-0.5 ${valorCls}`}>{valor}</div>
    </div>
  );
}
