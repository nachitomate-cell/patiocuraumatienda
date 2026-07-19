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
  Send,
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
  devolucionesEnRango,
} from "@/lib/repo";
import {
  subtotalLinea,
  type Devolucion,
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

  // Modal grande "Ingreso" / "Retiro": buscador sobre el propio inventario para
  // registrar movimientos rápidamente sin depender del scroll de la lista.
  const [ajusteTipo, setAjusteTipo] = useState<"in" | "out" | null>(null);
  const [ajusteBusqueda, setAjusteBusqueda] = useState("");
  const [ajusteProd, setAjusteProd] = useState<Producto | null>(null);
  const [ajusteCantidad, setAjusteCantidad] = useState(1);
  const [ajusteBusy, setAjusteBusy] = useState(false);
  const [ajusteErr, setAjusteErr] = useState("");
  const [ajusteOk, setAjusteOk] = useState("");
  // Contador de movimientos hechos en esta apertura de la modal. Cuando > 0
  // aparece el CTA para enviar el reporte al administrador.
  const [ajusteHechos, setAjusteHechos] = useState(0);

  const [descargando, setDescargando] = useState(false);
  // "enviando" es visual solo: si estamos generando/compartiendo el Excel.
  const [enviando, setEnviando] = useState(false);
  const [enviarErr, setEnviarErr] = useState("");

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

  // Próximo correlativo sugerido para el placeholder de código. El contador
  // productosCount puede quedar por debajo de los códigos reales (seed inicial
  // impreciso, imports masivos), así que se toma también el mayor correlativo
  // PREFIJO-NNNN presente en el inventario cargado. Los productos agregados en
  // esta sesión ya entran a `productos` con su código real, por eso el máximo
  // con `extrasEnSesion` no double-cuenta.
  const proximoSugerido = useMemo(() => {
    if (!emp) return 1;
    let maxN = (emp.productosCount || 0) + extrasEnSesion;
    const re = new RegExp(`^${emp.prefijo}-(\\d+)$`);
    for (const p of productos) {
      const m = (p.codigo || "").match(re);
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
    return maxN + 1;
  }, [emp, productos, extrasEnSesion]);

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
        (p.codigo || "").toLowerCase().includes(t) ||
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

  // ===== Modal grande de Ingreso / Retiro con buscador =====
  function abrirAjuste(tipo: "in" | "out") {
    setAjusteTipo(tipo);
    setAjusteBusqueda("");
    setAjusteProd(null);
    setAjusteCantidad(1);
    setAjusteErr("");
    setAjusteOk("");
    setAjusteHechos(0);
    setEnviarErr("");
  }

  function cerrarAjuste() {
    if (ajusteBusy) return;
    setAjusteTipo(null);
    setAjusteProd(null);
    setAjusteErr("");
    setAjusteOk("");
  }

  const ajusteResultados = useMemo(() => {
    const t = ajusteBusqueda.trim().toLowerCase();
    if (!t) return productos.slice(0, 30);
    return productos
      .filter(
        (p) =>
          (p.codigo || "").toLowerCase().includes(t) ||
          (p.descripcion || "").toLowerCase().includes(t)
      )
      .slice(0, 30);
  }, [productos, ajusteBusqueda]);

  async function confirmarAjuste() {
    if (!emp || !ajusteProd || !ajusteTipo) return;
    const n = Math.max(0, Math.round(ajusteCantidad || 0));
    if (n <= 0) {
      setAjusteErr("Ingresa una cantidad mayor a 0.");
      return;
    }
    const actual = ajusteProd.stockActual || 0;
    const nuevo = ajusteTipo === "in" ? actual + n : actual - n;
    if (nuevo < 0) {
      setAjusteErr(`No puedes retirar ${n}: solo tienes ${actual} en stock.`);
      return;
    }
    setAjusteBusy(true);
    setAjusteErr("");
    setAjusteOk("");
    try {
      await actualizarProductoEmprendedor(
        emp,
        ajusteProd.codigo,
        { stockActual: nuevo },
        "emprendedor",
        emp.nombre
      );
      setProductos((prev) =>
        prev.map((x) =>
          x.codigo === ajusteProd.codigo ? { ...x, stockActual: nuevo } : x
        )
      );
      setAjusteOk(
        `${ajusteTipo === "in" ? "Ingreso" : "Retiro"} de ${n} u. de "${
          ajusteProd.descripcion || ajusteProd.codigo
        }" registrado. Quedan ${nuevo} u.`
      );
      // Deja la modal abierta para hacer varios ingresos/retiros seguidos:
      // limpia el producto elegido y el buscador para el siguiente.
      setAjusteProd(null);
      setAjusteBusqueda("");
      setAjusteCantidad(1);
      setAjusteHechos((n) => n + 1);
      refrescarHistorial(emp.id);
    } catch (e) {
      setAjusteErr(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setAjusteBusy(false);
    }
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
  //
  // Async: para "hoy" y "mes" fetcheamos las devoluciones del rango desde
  // Firestore (no viven en state). Movimientos ya están en `movs`.
  //
  // Devuelve el WorkBook + filename listo, para que tanto la descarga como el
  // "Enviar al administrador" (Web Share) compartan la misma lógica de armado.
  async function construirExcelReporte(
    rango: "hoy" | "mes" | "todo"
  ): Promise<{ wb: XLSX.WorkBook; filename: string; periodo: string } | null> {
    if (!emp) return null;
    const ahora = new Date();
      const inicioHoy = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate()
      ).getTime();
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
      const inicioRango =
        rango === "hoy" ? inicioHoy : rango === "mes" ? inicioMes : 0;
      const finRango = Date.now();

      const ventasRango = ventas.filter((v) => v.creadoEn >= inicioRango);

      // Devoluciones del rango: se filtran a las que tocan códigos del
      // emprendedor (por emprendedorId estampado o por prefijo). Failsafe:
      // si la consulta falla, seguimos con el resto del Excel.
      let devsRango: Devolucion[] = [];
      try {
        const todas = await devolucionesEnRango(inicioRango, finRango);
        devsRango = todas
          .map((d) => ({
            ...d,
            items: d.items.filter(
              (l) =>
                l.emprendedorId === emp.id ||
                (!!l.codigo && l.codigo.startsWith(emp.prefijo + "-"))
            ),
          }))
          .filter((d) => d.items.length > 0);
      } catch {
        // Silencioso: el Excel se genera igual sin la hoja Devoluciones.
      }

      // Movimientos de stock del emprendedor (bitácora) filtrados al rango.
      const movsRango = movs.filter((m) => m.en >= inicioRango);

      // Stats por código: unidades y $ vendidos + devueltos (para neto).
      const statsRango = new Map<
        string,
        { unidades: number; total: number; devueltas: number; devTotal: number }
      >();
      for (const v of ventasRango) {
        if (v.anulada) continue;
        for (const l of v.items) {
          const k = l.codigo || "(manual)";
          const acc =
            statsRango.get(k) ||
            { unidades: 0, total: 0, devueltas: 0, devTotal: 0 };
          acc.unidades += l.cantidad;
          acc.total += subtotalLinea(l);
          statsRango.set(k, acc);
        }
      }
      for (const d of devsRango) {
        for (const l of d.items) {
          const k = l.codigo || "(manual)";
          const acc =
            statsRango.get(k) ||
            { unidades: 0, total: 0, devueltas: 0, devTotal: 0 };
          acc.devueltas += l.cantidad;
          acc.devTotal += subtotalLinea(l);
          statsRango.set(k, acc);
        }
      }

      const productosRows = productos.map((p) => {
        const stats =
          statsRango.get(p.codigo) ||
          { unidades: 0, total: 0, devueltas: 0, devTotal: 0 };
        const ev = estadoVence(p.vence);
        return {
          Codigo: p.codigo,
          Descripcion: p.descripcion,
          "Precio actual": p.precio,
          "Stock actual": p.stockActual,
          Agotado: (p.stockActual || 0) === 0 ? "Sí" : "",
          Vence: p.vence || "",
          "Estado vencimiento": ev ? ev.label : "",
          "Unidades vendidas": stats.unidades,
          "Ingresos generados": stats.total,
          "Unidades devueltas": stats.devueltas,
          "Devuelto ($)": stats.devTotal,
          "Ingresos netos": stats.total - stats.devTotal,
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
          Vendedor: v.vendedor ?? "",
          "Medio de pago": v.medioPago ?? "",
          Cliente: v.medioPago === "fiado" ? (v.clienteNombre ?? "") : "",
          Codigo: l.codigo,
          Descripcion: l.descripcion,
          Cantidad: l.cantidad,
          "Valor unidad": l.precio,
          "Dscto%": l.descuento,
          Subtotal: subtotalLinea(l),
        }))
      );

      const devolucionesRows = devsRango.flatMap((d) =>
        d.items.map((l) => ({
          "Nro devolución": d.nro,
          "Nro venta": d.ventaNro,
          Fecha: d.fecha,
          Hora: new Date(d.creadoEn).toLocaleTimeString("es-CL", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          Vendedor: d.vendedor ?? "",
          "Medio original": d.medioPagoOriginal,
          Motivo: d.motivo,
          Codigo: l.codigo,
          Descripcion: l.descripcion,
          Cantidad: l.cantidad,
          "Valor unidad": l.precio,
          "Dscto%": l.descuento,
          Subtotal: subtotalLinea(l),
        }))
      );

      // Bitácora: incluye altas / eliminaciones / cambios de stock, precio,
      // descripción, etc. Delta se calcula cuando aplica (numérico).
      const movsRows = movsRango.map((m) => {
        const antesN = Number(m.antes);
        const despuesN = Number(m.despues);
        const numeric =
          m.accion === "producto_agregado" ||
          m.accion === "stock_cambiado" ||
          m.accion === "precio_cambiado" ||
          m.accion === "costo_cambiado";
        const delta =
          m.accion === "producto_agregado"
            ? Number(m.despues || 0)
            : numeric && !Number.isNaN(antesN) && !Number.isNaN(despuesN)
            ? despuesN - antesN
            : "";
        return {
          Fecha: new Date(m.en).toLocaleDateString("es-CL"),
          Hora: new Date(m.en).toLocaleTimeString("es-CL", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          Acción: m.accion,
          Codigo: m.codigo ?? "",
          Producto: m.descripcion ?? "",
          Antes: m.antes ?? "",
          Despues: m.despues ?? "",
          Delta: delta,
          Origen: m.origen,
          Por: m.por,
        };
      });

      // Totales del rango. Bruto = solo ventas no anuladas.
      // Neto = Bruto − Devuelto − Anulado.
      let unidadesR = 0;
      let brutoR = 0;
      let nVentasR = 0;
      let nAnuladas = 0;
      let totalAnulado = 0;
      for (const v of ventasRango) {
        const subtotalV = v.items.reduce((s, l) => s + subtotalLinea(l), 0);
        if (v.anulada) {
          nAnuladas++;
          totalAnulado += subtotalV;
          continue;
        }
        nVentasR++;
        for (const l of v.items) unidadesR += l.cantidad;
        brutoR += subtotalV;
      }
      const totalDevs = devsRango.reduce(
        (s, d) => s + d.items.reduce((ss, l) => ss + subtotalLinea(l), 0),
        0
      );
      const netoR = brutoR - totalDevs - totalAnulado;

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
          "Total bruto": brutoR,
          "Anuladas (N°)": nAnuladas,
          "Total anulado": totalAnulado,
          "Devoluciones (N°)": devsRango.length,
          "Total devuelto": totalDevs,
          "Total neto": netoR,
          "Movimientos de stock": movsRango.length,
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
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          devolucionesRows.length
            ? devolucionesRows
            : [{ Aviso: "Sin devoluciones en el período" }]
        ),
        "Devoluciones"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          movsRows.length
            ? movsRows
            : [{ Aviso: "Sin movimientos de stock en el período" }]
        ),
        "Movimientos"
      );

      const slugEmp = (emp.nombre || emp.prefijo)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const filename = `reporte_${slugEmp}_${rango}_${periodo}.xlsx`;
      return { wb, filename, periodo };
  }

  // Descarga el reporte del período como .xlsx en el dispositivo.
  async function descargarReporte(rango: "hoy" | "mes" | "todo") {
    setDescargando(true);
    try {
      const r = await construirExcelReporte(rango);
      if (!r) return;
      XLSX.writeFile(r.wb, r.filename);
    } finally {
      setDescargando(false);
    }
  }

  // Envía el reporte al administrador usando la Web Share API (abre el share
  // sheet nativo → WhatsApp/email/etc con el .xlsx adjunto). Si el navegador
  // no soporta compartir archivos (Firefox desktop, Safari muy viejo), o el
  // usuario cancela, cae a descarga clásica.
  async function enviarReporte(rango: "hoy" | "mes" | "todo") {
    if (!emp) return;
    setEnviando(true);
    setEnviarErr("");
    try {
      const r = await construirExcelReporte(rango);
      if (!r) return;
      const buf = XLSX.write(r.wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const file = new File([blob], r.filename, { type: blob.type });
      const nav = typeof navigator !== "undefined" ? navigator : null;
      const puedeShare =
        !!nav &&
        typeof nav.canShare === "function" &&
        nav.canShare({ files: [file] });
      if (puedeShare && typeof nav?.share === "function") {
        try {
          await nav.share({
            files: [file],
            title: `Reporte ${emp.nombre} · ${r.periodo}`,
            text: `Reporte de ${emp.nombre} (${NEGOCIO.nombre || NEGOCIO.slug}) — período ${r.periodo}.`,
          });
          return;
        } catch (e) {
          // El usuario canceló el share sheet: no lo tratamos como error.
          if ((e as { name?: string })?.name === "AbortError") return;
          // Otro error: caemos a descarga.
        }
      }
      // Fallback: descarga clásica.
      XLSX.writeFile(r.wb, r.filename);
      setEnviarErr(
        "Este navegador no soporta compartir archivos directo. Descargué el Excel: adjuntalo a WhatsApp o email del administrador."
      );
    } catch (e) {
      setEnviarErr(
        e instanceof Error ? e.message : "No se pudo generar el reporte."
      );
    } finally {
      setEnviando(false);
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
              <button
                onClick={() => enviarReporte("hoy")}
                disabled={enviando || cargandoDatos}
                title="Enviar el Excel de hoy al administrador (WhatsApp / email)"
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Enviar hoy
              </button>
            </div>
          </div>
          {enviarErr && (
            <p className="mt-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
              {enviarErr}
            </p>
          )}

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

        {/* Accesos rápidos: Ingreso / Retiro con buscador propio.
            Están arriba y grandes para que sean el primer gesto del turno
            (repongo lo que traje / me llevo lo que sacaste), sin scrollear
            hasta la lista. */}
        <div className="grid grid-cols-2 gap-3 anim-in">
          <button
            onClick={() => abrirAjuste("in")}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow p-5 flex flex-col items-center justify-center gap-1.5 min-h-[92px]"
          >
            <PackagePlus size={30} />
            <span className="text-lg leading-none">Ingreso</span>
            <span className="text-[11px] font-normal opacity-90">
              Sumar stock a un producto
            </span>
          </button>
          <button
            onClick={() => abrirAjuste("out")}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow p-5 flex flex-col items-center justify-center gap-1.5 min-h-[92px]"
          >
            <PackageMinus size={30} />
            <span className="text-lg leading-none">Retiro</span>
            <span className="text-[11px] font-normal opacity-90">
              Restar stock de un producto
            </span>
          </button>
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
                    ? `Sugerido: ${emp.prefijo}-${String(proximoSugerido).padStart(4, "0")}`
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

      {/* Modal Ingreso / Retiro: buscador propio del inventario del
          emprendedor + selector de cantidad. Deja abierto tras un OK para
          registrar varios movimientos seguidos. */}
      <Modal
        abierto={ajusteTipo !== null}
        onCerrar={cerrarAjuste}
        titulo={
          ajusteTipo === "in"
            ? "Registrar ingreso de stock"
            : ajusteTipo === "out"
            ? "Registrar retiro de stock"
            : ""
        }
        maxW="max-w-lg"
      >
        {ajusteTipo && (
          <div className="space-y-3">
            {ajusteOk && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2 text-sm anim-pop">
                {ajusteOk}
              </div>
            )}

            {!ajusteProd ? (
              <>
                <div className="relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    autoFocus
                    value={ajusteBusqueda}
                    onChange={(e) => setAjusteBusqueda(e.target.value)}
                    placeholder="Buscar en mi inventario…"
                    className="w-full border rounded-lg pl-9 pr-9 py-2.5 text-sm"
                  />
                  {ajusteBusqueda && (
                    <button
                      type="button"
                      onClick={() => setAjusteBusqueda("")}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
                  {ajusteResultados.length === 0 ? (
                    <p className="text-slate-400 text-sm py-6 text-center">
                      {productos.length === 0
                        ? "Aún no tienes productos cargados."
                        : `Ningún producto coincide con "${ajusteBusqueda}".`}
                    </p>
                  ) : (
                    ajusteResultados.map((p) => (
                      <button
                        key={p.codigo}
                        type="button"
                        onClick={() => {
                          setAjusteProd(p);
                          setAjusteCantidad(1);
                          setAjusteErr("");
                          setAjusteOk("");
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 focus:bg-slate-50 outline-none"
                      >
                        <div className="font-medium text-slate-800 truncate text-sm">
                          {p.descripcion || "(sin descripción)"}
                        </div>
                        <div className="text-xs text-slate-500 flex gap-x-2 flex-wrap">
                          <span className="font-mono">{p.codigo}</span>
                          <span>· {p.stockActual || 0} u.</span>
                          <span>· {money(p.precio)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="bg-slate-50 rounded-lg p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">
                      {ajusteProd.descripcion || "(sin descripción)"}
                    </div>
                    <div className="text-xs text-slate-500 flex gap-x-2 flex-wrap">
                      <span className="font-mono">{ajusteProd.codigo}</span>
                      <span>· Stock actual {ajusteProd.stockActual || 0} u.</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAjusteProd(null);
                      setAjusteErr("");
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 underline shrink-0"
                  >
                    Cambiar
                  </button>
                </div>

                <label className="block text-sm">
                  <span className="text-slate-600 font-medium">
                    Cantidad a {ajusteTipo === "in" ? "ingresar" : "retirar"}
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setAjusteCantidad((c) => Math.max(1, (c || 0) - 1))
                      }
                      className="w-10 h-10 rounded-lg border border-slate-300 hover:bg-slate-100 flex items-center justify-center"
                    >
                      <PackageMinus size={16} />
                    </button>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={ajusteCantidad || ""}
                      onChange={(e) =>
                        setAjusteCantidad(Number(e.target.value) || 0)
                      }
                      className="flex-1 border rounded-lg px-3 py-2.5 text-center text-lg font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAjusteCantidad((c) => Math.max(1, (c || 0) + 1))
                      }
                      className="w-10 h-10 rounded-lg border border-slate-300 hover:bg-slate-100 flex items-center justify-center"
                    >
                      <PackagePlus size={16} />
                    </button>
                  </div>
                </label>

                <div className="text-xs text-slate-500">
                  Quedará{" "}
                  <b className="text-slate-800">
                    {Math.max(
                      0,
                      (ajusteProd.stockActual || 0) +
                        (ajusteTipo === "in" ? ajusteCantidad : -ajusteCantidad)
                    )}{" "}
                    u.
                  </b>{" "}
                  después del {ajusteTipo === "in" ? "ingreso" : "retiro"}.
                </div>
              </div>
            )}

            {ajusteErr && <p className="text-sm text-red-600">{ajusteErr}</p>}
            {enviarErr && (
              <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                {enviarErr}
              </p>
            )}

            {/* CTA para enviar el reporte al administrador tras cualquier
                movimiento hecho en esta apertura de la modal. Grande y arriba
                de "Cerrar" para que sea el gesto siguiente natural. */}
            {ajusteHechos > 0 && (
              <button
                onClick={() => enviarReporte("hoy")}
                disabled={enviando}
                className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-lg py-3 disabled:opacity-50"
              >
                {enviando ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
                Enviar reporte al administrador
                <span className="text-[11px] font-normal opacity-90 ml-1">
                  ({ajusteHechos} {ajusteHechos === 1 ? "movimiento" : "movimientos"})
                </span>
              </button>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
              <button
                onClick={cerrarAjuste}
                disabled={ajusteBusy}
                className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cerrar
              </button>
              {ajusteProd && (
                <button
                  onClick={confirmarAjuste}
                  disabled={ajusteBusy}
                  className={`flex items-center gap-2 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50 ${
                    ajusteTipo === "in"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-amber-600 hover:bg-amber-700"
                  }`}
                >
                  {ajusteBusy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : ajusteTipo === "in" ? (
                    <PackagePlus size={16} />
                  ) : (
                    <PackageMinus size={16} />
                  )}
                  Confirmar {ajusteTipo === "in" ? "ingreso" : "retiro"}
                </button>
              )}
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
