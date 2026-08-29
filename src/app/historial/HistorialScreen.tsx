"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  History,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Undo2,
  Plus,
  Minus,
  Loader2,
  AlertTriangle,
  FileSpreadsheet,
  CalendarDays,
  CalendarRange,
  Printer,
  Ban,
  PackagePlus,
  Users,
  ClipboardCheck,
} from "lucide-react";
import { Ticket } from "@/components/Ticket";
import * as XLSX from "xlsx";
import {
  ultimasVentas,
  ultimasDevoluciones,
  registrarDevolucion,
  anularVenta,
  cajaAbierta,
  ventasEnRango,
  devolucionesEnRango,
  actualizarCodigoBoleta,
  actualizarMedioPago,
  ingresosDeEmprendedoresEnRango,
  verificarMovimiento,
  desverificarMovimiento,
  verificarLote,
  listarClientes,
} from "@/lib/repo";
import {
  subtotalLinea,
  type Cliente,
  type Devolucion,
  type IngresoEmprendedor,
  type LineaVenta,
  type MedioPago,
  type Venta,
  type VerificacionMov,
} from "@/lib/types";
import { ComprobanteMovimientos } from "@/components/ComprobanteMovimientos";
import { money, hoyISO } from "@/lib/format";
import { SelectorFecha } from "@/components/SelectorFecha";
import { Modal } from "@/components/Modal";
import { useNegocio } from "@/lib/negocio-context";
import { useVendedor } from "@/lib/vendedor";

const MESES_ING = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function HistorialScreen() {
  const NEGOCIO = useNegocio();
  const vendedor = useVendedor();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [devolver, setDevolver] = useState<Venta | null>(null);
  const [imprimir, setImprimir] = useState<Venta | null>(null);
  const [anular, setAnular] = useState<Venta | null>(null);
  const [descargando, setDescargando] = useState<"diario" | "semanal" | null>(null);
  const [reporteErr, setReporteErr] = useState("");

  // Sección "Ingresos de emprendedores": eventos de alta y reposición que
  // llegan vía /alta/{token}. Se carga por separado del historial de ventas.
  // periodoIng: "dia" navega una fecha puntual; "mes" trae el mes completo
  // (para la liquidación mensual de un emprendedor); "rango" cubre el caso
  // real de la auditoría: el emprendedor carga en la app el domingo y llega
  // el lunes — mirando solo "hoy" caja no vería nada.
  const [periodoIng, setPeriodoIng] = useState<"dia" | "mes" | "rango">("dia");
  const [fechaIng, setFechaIng] = useState(hoyISO());
  const [mesIng, setMesIng] = useState(hoyISO().slice(0, 7)); // YYYY-MM
  const [desdeIng, setDesdeIng] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [hastaIng, setHastaIng] = useState(hoyISO());
  const [ingresos, setIngresos] = useState<IngresoEmprendedor[]>([]);
  const [cargandoIng, setCargandoIng] = useState(true);
  const [errorIng, setErrorIng] = useState("");

  // Filtros en memoria sobre lo ya cargado (no cuestan lecturas extra).
  const [empIng, setEmpIng] = useState("");            // id de emprendedor
  const [tipoIng, setTipoIng] = useState<"" | "alta" | "reposicion" | "retiro" | "edicion">("");
  const [origenIng, setOrigenIng] = useState<"" | "emprendedor" | "admin">("");
  const [termIng, setTermIng] = useState("");           // código o descripción
  // Auditoría física: "pendiente" es la bandeja de trabajo de caja.
  const [verifIng, setVerifIng] = useState<"" | "pendiente" | "verificado" | "diferencia">("");
  // Vista agrupada por emprendedor: cuando llega con su tanda, caja quiere
  // verlo todo junto para contar y firmar de una vez.
  const [agrupado, setAgrupado] = useState(true);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  // Verificación en curso (fila individual o lote de un emprendedor).
  const [verificando, setVerificando] = useState<string | null>(null);
  const [difObjetivo, setDifObjetivo] = useState<IngresoEmprendedor | null>(null);
  const [difCantidad, setDifCantidad] = useState(0);
  const [difNota, setDifNota] = useState("");
  const [difBusy, setDifBusy] = useState(false);
  const [comprobante, setComprobante] = useState<{
    nombre: string;
    prefijo: string;
    items: IngresoEmprendedor[];
  } | null>(null);
  // createPortal necesita document: en SSR no existe. Se monta en cliente.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  async function cargarIngresos(
    modo: "dia" | "mes" | "rango" = periodoIng,
    fecha: string = fechaIng,
    mes: string = mesIng,
    ini: string = desdeIng,
    fin: string = hastaIng
  ) {
    setCargandoIng(true);
    setErrorIng("");
    try {
      const iniDia = (f: string) => {
        const [y, m, d] = f.split("-").map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
      };
      const finDia = (f: string) => {
        const [y, m, d] = f.split("-").map(Number);
        return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
      };
      let desde: number;
      let hasta: number;
      if (modo === "mes") {
        // Rango [primer día 00:00, último día 23:59:59.999] en hora local.
        const [y, m] = mes.split("-").map(Number);
        desde = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
        hasta = new Date(y, m, 0, 23, 59, 59, 999).getTime();
      } else if (modo === "rango") {
        // Si vienen invertidas, se ordenan solas en vez de traer 0 filas.
        const a = iniDia(ini);
        const b = finDia(fin);
        desde = Math.min(a, b);
        hasta = Math.max(a, b);
      } else {
        // Rango [00:00:00, 23:59:59.999] en horario local de la fecha.
        desde = iniDia(fecha);
        hasta = finDia(fecha);
      }
      const items = await ingresosDeEmprendedoresEnRango(desde, hasta);
      setIngresos(items);
    } catch (e) {
      // Detalle del error de Firestore (incluye el link de "create index"
      // cuando falta el índice de la collectionGroup). Lo mostramos tal cual
      // para que el admin lo pueda abrir y resolver en 1 click.
      const msg = e instanceof Error ? e.message : String(e);
      setErrorIng(msg);
    } finally {
      setCargandoIng(false);
    }
  }

  useEffect(() => {
    cargarIngresos(periodoIng, fechaIng, mesIng, desdeIng, hastaIng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoIng, fechaIng, mesIng, desdeIng, hastaIng]);

  // Emprendedores presentes en el periodo cargado, para poblar el selector
  // solo con quienes efectivamente movieron stock (no los 53 del negocio).
  const empsEnIngresos = useMemo(() => {
    const m = new Map<string, { nombre: string; prefijo: string; n: number; unidades: number }>();
    for (const x of ingresos) {
      const e = m.get(x.emprendedorId) || {
        nombre: x.emprendedorNombre,
        prefijo: x.emprendedorPrefijo,
        n: 0,
        unidades: 0,
      };
      e.n++;
      e.unidades += x.cantidad;
      m.set(x.emprendedorId, e);
    }
    return [...m.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre));
  }, [ingresos]);

  const ingresosFiltrados = useMemo(() => {
    const t = termIng.trim().toLowerCase();
    return ingresos.filter((x) => {
      if (empIng && x.emprendedorId !== empIng) return false;
      if (tipoIng && x.tipo !== tipoIng) return false;
      if (origenIng && x.origen !== origenIng) return false;
      if (verifIng === "pendiente" && x.verificacion) return false;
      if (verifIng === "verificado" && !x.verificacion) return false;
      if (
        verifIng === "diferencia" &&
        !(
          x.verificacion?.cantidadReal !== undefined &&
          x.verificacion.cantidadReal !== x.cantidad
        )
      )
        return false;
      if (
        t &&
        !(x.codigo || "").toLowerCase().includes(t) &&
        !(x.descripcion || "").toLowerCase().includes(t)
      )
        return false;
      return true;
    });
  }, [ingresos, empIng, tipoIng, origenIng, verifIng, termIng]);

  const hayFiltrosIng = !!(empIng || tipoIng || origenIng || verifIng || termIng.trim());

  // Agrupación por emprendedor para el flujo de auditoría: encabezado con
  // totales (lo que debe contar) y detalle desplegable para ir tildando.
  const gruposIng = useMemo(() => {
    const m = new Map<
      string,
      {
        nombre: string;
        prefijo: string;
        items: IngresoEmprendedor[];
        unidadesIn: number;
        unidadesOut: number;
        pendientes: number;
        diferencias: number;
      }
    >();
    for (const x of ingresosFiltrados) {
      const g = m.get(x.emprendedorId) || {
        nombre: x.emprendedorNombre,
        prefijo: x.emprendedorPrefijo,
        items: [],
        unidadesIn: 0,
        unidadesOut: 0,
        pendientes: 0,
        diferencias: 0,
      };
      g.items.push(x);
      if (x.tipo === "retiro") g.unidadesOut += x.cantidad;
      else g.unidadesIn += x.cantidad;
      if (!x.verificacion) g.pendientes++;
      else if (
        x.verificacion.cantidadReal !== undefined &&
        x.verificacion.cantidadReal !== x.cantidad
      )
        g.diferencias++;
      m.set(x.emprendedorId, g);
    }
    // Primero quienes tienen cosas por verificar: es la cola de trabajo.
    return [...m.entries()].sort((a, b) => {
      if (!!b[1].pendientes !== !!a[1].pendientes) return b[1].pendientes - a[1].pendientes;
      return a[1].nombre.localeCompare(b[1].nombre);
    });
  }, [ingresosFiltrados]);

  const pendientesTotal = useMemo(
    () => ingresosFiltrados.filter((x) => !x.verificacion).length,
    [ingresosFiltrados]
  );

  // ===== Acciones de auditoría =====
  function aplicarVerificacion(movIds: Set<string>, v: VerificacionMov | null) {
    setIngresos((prev) =>
      prev.map((x) =>
        movIds.has(x.movId)
          ? ({ ...x, verificacion: v ?? undefined } as IngresoEmprendedor)
          : x
      )
    );
  }

  async function verificarUno(x: IngresoEmprendedor) {
    setVerificando(x.movId);
    try {
      const v = await verificarMovimiento(x.emprendedorId, x.movId, vendedor);
      aplicarVerificacion(new Set([x.movId]), v);
    } catch (e) {
      setErrorIng(e instanceof Error ? e.message : "No se pudo verificar.");
    } finally {
      setVerificando(null);
    }
  }

  async function desverificarUno(x: IngresoEmprendedor) {
    setVerificando(x.movId);
    try {
      await desverificarMovimiento(x.emprendedorId, x.movId);
      aplicarVerificacion(new Set([x.movId]), null);
    } catch (e) {
      setErrorIng(e instanceof Error ? e.message : "No se pudo deshacer.");
    } finally {
      setVerificando(null);
    }
  }

  async function verificarGrupo(empId: string, items: IngresoEmprendedor[]) {
    const pend = items.filter((x) => !x.verificacion);
    if (pend.length === 0) return;
    setVerificando(`grupo:${empId}`);
    try {
      const v = await verificarLote(
        pend.map((x) => ({ emprendedorId: x.emprendedorId, movId: x.movId })),
        vendedor
      );
      aplicarVerificacion(new Set(pend.map((x) => x.movId)), v);
    } catch (e) {
      setErrorIng(e instanceof Error ? e.message : "No se pudo verificar el lote.");
    } finally {
      setVerificando(null);
    }
  }

  async function guardarDiferencia() {
    if (!difObjetivo) return;
    setDifBusy(true);
    try {
      const v = await verificarMovimiento(
        difObjetivo.emprendedorId,
        difObjetivo.movId,
        vendedor,
        difCantidad,
        difNota
      );
      aplicarVerificacion(new Set([difObjetivo.movId]), v);
      setDifObjetivo(null);
      setDifNota("");
    } catch (e) {
      setErrorIng(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setDifBusy(false);
    }
  }

  // El resumen refleja lo FILTRADO: al elegir un emprendedor, las tarjetas
  // muestran su liquidación del periodo, que es el uso real del panel.
  const resumenIng = useMemo(() => {
    let unidades = 0;
    let retiradas = 0;
    let altas = 0;
    let reposiciones = 0;
    const emps = new Set<string>();
    for (const x of ingresosFiltrados) {
      if (x.tipo === "retiro") retiradas += x.cantidad;
      else unidades += x.cantidad;
      if (x.tipo === "alta") altas++;
      else if (x.tipo === "reposicion") reposiciones++;
      emps.add(x.emprendedorId);
    }
    return { unidades, retiradas, altas, reposiciones, nEmp: emps.size };
  }, [ingresosFiltrados]);

  // "alcance" decide cuántos documentos pedirle a Firestore:
  //   - "hoy" (default): rango [00:00, 23:59] de hoy. Una jornada típica son
  //     decenas de ventas, no 300. Esto baja la spike de ~600 lecturas
  //     (300 ventas + 300 devoluciones) por carga a las que realmente hubo.
  //   - "historico": últimas 300 (comportamiento legacy). El usuario lo
  //     activa con un botón cuando necesita buscar una venta vieja.
  const [alcance, setAlcance] = useState<"hoy" | "historico">("hoy");

  async function cargar(modo: "hoy" | "historico" = alcance) {
    setCargando(true);
    setError("");
    try {
      let vs: Venta[];
      let ds: Devolucion[];
      if (modo === "hoy") {
        const ahora = new Date();
        const inicio = new Date(
          ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0, 0
        ).getTime();
        const fin = new Date(
          ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999
        ).getTime();
        [vs, ds] = await Promise.all([
          ventasEnRango(inicio, fin),
          devolucionesEnRango(inicio, fin),
        ]);
        // ventasEnRango ordena asc; el historial muestra más reciente primero.
        vs = vs.slice().reverse();
        ds = ds.slice().reverse();
      } else {
        [vs, ds] = await Promise.all([ultimasVentas(300), ultimasDevoluciones(300)]);
      }
      setVentas(vs);
      setDevoluciones(ds);
      setAlcance(modo);
    } catch {
      setError("No se pudo cargar el historial. Revise conexión o reglas de Firestore.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar("hoy");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Devoluciones agrupadas por nro de venta para no buscar linealmente en cada
  // render: O(1) por fila para el badge y el detalle.
  const devolucionesPorVenta = useMemo(() => {
    const m = new Map<string, Devolucion[]>();
    for (const d of devoluciones) {
      const arr = m.get(d.ventaNro) || [];
      arr.push(d);
      m.set(d.ventaNro, arr);
    }
    return m;
  }, [devoluciones]);

  const filtradas = useMemo(() => {
    const t = term.trim().toLowerCase();
    return ventas.filter((v) => {
      if (desde && v.fecha < desde) return false;
      if (hasta && v.fecha > hasta) return false;
      if (!t) return true;
      return (
        (v.nro || "").toLowerCase().includes(t) ||
        (v.cliente || "").toLowerCase().includes(t) ||
        (v.vendedor || "").toLowerCase().includes(t) ||
        (v.codigoBoleta || "").toLowerCase().includes(t)
      );
    });
  }, [ventas, term, desde, hasta]);

  const resumen = useMemo(() => {
    let total = 0,
      unidades = 0,
      devuelto = 0,
      anulado = 0,
      nAnuladas = 0;
    for (const v of filtradas) {
      total += v.total || 0;
      unidades += v.items.reduce((s, l) => s + l.cantidad, 0);
      const devs = devolucionesPorVenta.get(v.nro) || [];
      for (const d of devs) devuelto += d.total || 0;
      if (v.anulada) {
        anulado += v.total || 0;
        nAnuladas++;
      }
    }
    return { total, unidades, n: filtradas.length, devuelto, anulado, nAnuladas };
  }, [filtradas, devolucionesPorVenta]);

  function exportar() {
    const filas = filtradas.flatMap((v) =>
      v.items.map((l) => ({
        Nro: v.nro,
        Fecha: v.fecha,
        Cliente: v.cliente,
        Vendedor: v.vendedor ?? "",
        "Código boleta": v.codigoBoleta ?? "",
        Codigo: l.codigo,
        Descripcion: l.descripcion,
        Cantidad: l.cantidad,
        "Valor venta": l.precio,
        "Dscto%": l.descuento,
        Subtotal: subtotalLinea(l),
      }))
    );
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SALIDAS");
    XLSX.writeFile(wb, `ventas_${NEGOCIO.slug}_${hoyISO()}.xlsx`);
  }

  // Reporte diario (hoy) o semanal (últimos 7 días incluyendo hoy). Consulta
  // Firestore por rango: no depende de las "últimas 300" del listado. Genera
  // un Excel con 3 hojas (Ventas / Devoluciones / Resumen).
  async function descargarReporte(modo: "diario" | "semanal") {
    setDescargando(modo);
    setReporteErr("");
    try {
      const ahora = new Date();
      const fin = new Date(ahora);
      fin.setHours(23, 59, 59, 999);
      const inicio = new Date(ahora);
      inicio.setHours(0, 0, 0, 0);
      if (modo === "semanal") inicio.setDate(inicio.getDate() - 6);

      const [vs, ds] = await Promise.all([
        ventasEnRango(inicio.getTime(), fin.getTime()),
        devolucionesEnRango(inicio.getTime(), fin.getTime()),
      ]);

      const ventasRows = vs.flatMap((v) =>
        v.items.map((l) => ({
          Nro: v.nro,
          Fecha: v.fecha,
          Hora: new Date(v.creadoEn).toLocaleTimeString("es-CL", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          Cliente: v.cliente,
          Vendedor: v.vendedor ?? "",
          "Medio de pago": v.medioPago ?? "",
          "Código boleta": v.codigoBoleta ?? "",
          Anulada: v.anulada ? "Sí" : "",
          "Motivo anulación": v.anulada?.motivo ?? "",
          Codigo: l.codigo,
          Descripcion: l.descripcion,
          Emprendedor: l.emprendedorNombre ?? "",
          Cantidad: l.cantidad,
          "Valor venta": l.precio,
          "Dscto%": l.descuento,
          Subtotal: subtotalLinea(l),
        }))
      );

      const devsRows = ds.flatMap((d) =>
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
          "Subtotal devuelto": subtotalLinea(l),
        }))
      );

      const totalBruto = vs.reduce((s, v) => s + (v.total || 0), 0);
      const totalDevuelto = ds.reduce((s, d) => s + (d.total || 0), 0);
      const anuladas = vs.filter((v) => v.anulada);
      const totalAnulado = anuladas.reduce((s, v) => s + (v.total || 0), 0);
      const unidades = vs.reduce(
        (s, v) => s + v.items.reduce((ss, l) => ss + l.cantidad, 0),
        0
      );
      const resumenRows = [
        {
          Periodo:
            modo === "diario"
              ? hoyISO()
              : `${isoOf(inicio)} a ${hoyISO()}`,
          Negocio: NEGOCIO.nombre || NEGOCIO.slug,
          "Ventas (N°)": vs.length,
          "Unidades vendidas": unidades,
          "Total bruto": totalBruto,
          "Anuladas (N°)": anuladas.length,
          "Total anulado": totalAnulado,
          "Devoluciones (N°)": ds.length,
          "Total devuelto": totalDevuelto,
          "Neto": totalBruto - totalDevuelto - totalAnulado,
        },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenRows), "Resumen");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(ventasRows.length ? ventasRows : [{ Aviso: "Sin ventas en el periodo" }]),
        "Ventas"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(devsRows.length ? devsRows : [{ Aviso: "Sin devoluciones en el periodo" }]),
        "Devoluciones"
      );
      XLSX.writeFile(
        wb,
        `reporte_${modo}_${NEGOCIO.slug}_${hoyISO()}.xlsx`
      );
    } catch (e) {
      setReporteErr(e instanceof Error ? e.message : "No se pudo generar el reporte.");
    } finally {
      setDescargando(null);
    }
  }

  const esHoyIng = periodoIng === "dia" && fechaIng === hoyISO();

  // Navegación del mes (mismo patrón que el CRM por emprendedor).
  function navegarMes(delta: number) {
    const [y, m] = mesIng.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMesIng(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const etiquetaMesIng = (() => {
    const [y, m] = mesIng.split("-").map(Number);
    return `${MESES_ING[m - 1]} ${y}`;
  })();
  // Texto del periodo para el comprobante impreso y el nombre del Excel.
  const fmtCorto = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const etiquetaPeriodoIng =
    periodoIng === "mes"
      ? etiquetaMesIng
      : periodoIng === "rango"
      ? `${fmtCorto(desdeIng)} – ${fmtCorto(hastaIng)}`
      : fmtCorto(fechaIng);

  // Excel de lo que se ve en pantalla (respeta filtros): sirve como
  // liquidación mensual por emprendedor sin pasar por el reporte general.
  function exportarIngresos() {
    const rows = ingresosFiltrados.map((x) => ({
      Fecha: new Date(x.en).toLocaleDateString("es-CL"),
      Hora: new Date(x.en).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }),
      Emprendedor: x.emprendedorNombre,
      Prefijo: x.emprendedorPrefijo,
      Codigo: x.codigo,
      Producto: x.descripcionActual ?? x.descripcion,
      Cantidad: x.tipo === "edicion" ? "" : x.tipo === "retiro" ? -x.cantidad : x.cantidad,
      Tipo:
        x.tipo === "alta"
          ? "Producto nuevo"
          : x.tipo === "retiro"
          ? "Retiro"
          : x.tipo === "edicion"
          ? "Edición"
          : "Reposición",
      "Precio actual": x.precioActual ?? x.precio ?? "",
      "Precio declarado (si alta)": x.tipo === "alta" && x.precio !== undefined ? x.precio : "",
      Detalle: x.detalle ?? "",
      Origen: x.origen === "emprendedor" ? "Emprendedor" : "Admin",
      Por: x.por,
      Verificado: x.verificacion ? "SÍ" : "",
      "Verificado por": x.verificacion?.por ?? "",
      "Verificado el": x.verificacion
        ? new Date(x.verificacion.en).toLocaleString("es-CL")
        : "",
      "Cantidad contada": x.verificacion?.cantidadReal ?? "",
      Diferencia:
        x.verificacion?.cantidadReal !== undefined
          ? x.verificacion.cantidadReal - x.cantidad
          : "",
      "Nota auditoría": x.verificacion?.nota ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows.length ? rows : [{ Aviso: "Sin ingresos en el periodo" }]),
      "Ingresos"
    );
    const periodo = periodoIng === "mes" ? mesIng : fechaIng;
    const quien = empIng
      ? `_${(empsEnIngresos.find(([id]) => id === empIng)?.[1].prefijo || "emp").toLowerCase()}`
      : "";
    XLSX.writeFile(wb, `ingresos_${NEGOCIO.slug}_${periodo}${quien}.xlsx`);
  }

  return (
    <div className="space-y-4">
      {/* Ingresos del día: refleja lo que cargaron los emprendedores desde
          /alta/{token} (alta de productos y "Recibí" en stock). Sección
          independiente del historial de ventas: vive arriba para visibilidad
          inmediata al abrir Historial. */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
          <div>
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <PackagePlus className="text-emerald-600" size={20} />
              Ingresos de emprendedores {esHoyIng && <span className="text-emerald-700">(hoy)</span>}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Lo que cargaron los emprendedores en {" "}
              <span className="font-mono text-slate-700">/alta/{"{token}"}</span>: altas
              nuevas, stock declarado y correcciones de ficha (precio/descripción).
              Precio y descripción se muestran al valor ACTUAL del catálogo.
            </p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            {/* Periodo: día puntual o mes completo. */}
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
              <button
                onClick={() => setPeriodoIng("dia")}
                className={`px-3 py-2 text-sm font-semibold ${
                  periodoIng === "dia"
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                Por día
              </button>
              <button
                onClick={() => setPeriodoIng("mes")}
                className={`px-3 py-2 text-sm font-semibold border-l border-slate-300 ${
                  periodoIng === "mes"
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                Por mes
              </button>
              <button
                onClick={() => setPeriodoIng("rango")}
                title="Cubre el caso de quien carga en la app un día y llega al local otro"
                className={`px-3 py-2 text-sm font-semibold border-l border-slate-300 ${
                  periodoIng === "rango"
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                Rango
              </button>
            </div>
            {periodoIng === "rango" ? (
              <div className="flex items-end gap-2">
                <div className="text-sm">
                  <span className="text-slate-500 text-xs">Desde</span>
                  <SelectorFecha value={desdeIng} onChange={setDesdeIng} className="mt-0.5" />
                </div>
                <div className="text-sm">
                  <span className="text-slate-500 text-xs">Hasta</span>
                  <SelectorFecha value={hastaIng} onChange={setHastaIng} className="mt-0.5" />
                </div>
              </div>
            ) : periodoIng === "dia" ? (
              <div className="text-sm">
                <span className="text-slate-500 text-xs">Día</span>
                <SelectorFecha value={fechaIng} onChange={setFechaIng} className="mt-0.5" />
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navegarMes(-1)}
                  className="p-2 rounded-lg border border-slate-300 hover:bg-slate-100"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="bg-slate-100 rounded-lg px-3 py-2 text-sm font-semibold text-slate-800 min-w-[150px] text-center capitalize">
                  {etiquetaMesIng}
                </div>
                <button
                  onClick={() => navegarMes(1)}
                  className="p-2 rounded-lg border border-slate-300 hover:bg-slate-100"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
            <button
              onClick={() => cargarIngresos()}
              disabled={cargandoIng}
              className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <RefreshCw size={16} className={cargandoIng ? "animate-spin" : ""} />
              Refrescar
            </button>
            <button
              onClick={exportarIngresos}
              disabled={cargandoIng || ingresosFiltrados.length === 0}
              title="Excel de lo que se ve en pantalla (respeta los filtros)"
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <Download size={16} /> Excel
            </button>
          </div>
        </div>

        {/* Filtros. El de emprendedor es el principal: se llena solo con
            quienes movieron stock en el periodo cargado. Todos operan en
            memoria sobre lo ya traído: no cuestan lecturas de Firestore. */}
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <label className="text-sm">
            <span className="block text-slate-500 text-xs mb-0.5">Emprendedor</span>
            <select
              value={empIng}
              onChange={(e) => setEmpIng(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[220px]"
            >
              <option value="">Todos ({empsEnIngresos.length})</option>
              {empsEnIngresos.map(([id, e]) => (
                <option key={id} value={id}>
                  {e.nombre} · {e.unidades} u.
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 text-xs mb-0.5">Auditoría</span>
            <select
              value={verifIng}
              onChange={(e) => setVerifIng(e.target.value as typeof verifIng)}
              className={`border rounded-lg px-3 py-2 text-sm ${
                verifIng === "pendiente"
                  ? "border-amber-400 bg-amber-50 text-amber-900 font-semibold"
                  : "border-slate-300 bg-white"
              }`}
            >
              <option value="">Todos</option>
              <option value="pendiente">Por verificar</option>
              <option value="verificado">Verificados</option>
              <option value="diferencia">Con diferencia</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 text-xs mb-0.5">Tipo</span>
            <select
              value={tipoIng}
              onChange={(e) => setTipoIng(e.target.value as typeof tipoIng)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Todos</option>
              <option value="alta">Producto nuevo</option>
              <option value="reposicion">Reposición</option>
              <option value="retiro">Retiro</option>
              <option value="edicion">Edición</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 text-xs mb-0.5">Cargado por</span>
            <select
              value={origenIng}
              onChange={(e) => setOrigenIng(e.target.value as typeof origenIng)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Todos</option>
              <option value="emprendedor">Emprendedor</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="text-sm flex-1 min-w-[180px]">
            <span className="block text-slate-500 text-xs mb-0.5">Producto</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={termIng}
                onChange={(e) => setTermIng(e.target.value)}
                placeholder="Código o descripción…"
                className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-sm"
              />
            </div>
          </label>
          <button
            onClick={() => setAgrupado((v) => !v)}
            title="Agrupar por emprendedor (recomendado para auditar)"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold border ${
              agrupado
                ? "bg-slate-800 border-slate-800 text-white"
                : "border-slate-300 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Users size={15} /> Agrupar
          </button>
          {hayFiltrosIng && (
            <button
              onClick={() => {
                setEmpIng("");
                setTipoIng("");
                setOrigenIng("");
                setVerifIng("");
                setTermIng("");
              }}
              className="text-sm text-slate-600 hover:text-slate-900 underline px-1 py-2"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <ResumenIng
            label={hayFiltrosIng ? `Eventos (de ${ingresos.length})` : "Eventos"}
            valor={ingresosFiltrados.length.toString()}
          />
          <ResumenIng
            label="Unidades ingresadas"
            valor={`${resumenIng.unidades} u.`}
            acento="emerald"
          />
          <ResumenIng
            label="Unidades retiradas"
            valor={`${resumenIng.retiradas} u.`}
          />
          <ResumenIng
            label="Por verificar"
            valor={pendientesTotal.toString()}
            acento={pendientesTotal > 0 ? "amber" : undefined}
            icono={<ClipboardCheck size={12} />}
          />
        </div>

        {errorIng && (
          <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 mb-2 space-y-1">
            <p className="font-semibold">No se pudieron cargar los ingresos.</p>
            <p className="font-mono break-all whitespace-pre-wrap">{errorIng}</p>
            {/firestore\.indexes/.test(errorIng) && (
              <p>
                👉 Falta el índice de Firestore. En el mensaje de arriba hay un link
                que termina en <span className="font-mono">create_composite=...</span>:
                ábrelo en el navegador y presiona <b>Crear índice</b>.
              </p>
            )}
            {/permission|insufficient/i.test(errorIng) && (
              <p>
                👉 Las reglas de Firestore no permiten leer la subcolección
                <span className="font-mono"> movimientos</span> en modo collectionGroup.
                Publica <span className="font-mono">firestore.rules</span> en la consola.
              </p>
            )}
          </div>
        )}

        {/* Vista agrupada: la cola de trabajo de caja. Cada tarjeta es un
            emprendedor con lo que declaró, para contar y firmar de una vez. */}
        {agrupado && !cargandoIng && !errorIng && gruposIng.length > 0 && (
          <div className="space-y-2">
            {gruposIng.map(([empId, g]) => {
              const abierto = abiertos[empId] ?? g.pendientes > 0;
              const enCurso = verificando === `grupo:${empId}`;
              return (
                <div
                  key={empId}
                  className={`border rounded-xl overflow-hidden ${
                    g.pendientes > 0 ? "border-amber-300 bg-amber-50/40" : "border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                    <button
                      onClick={() => setAbiertos((p) => ({ ...p, [empId]: !abierto }))}
                      className="flex items-center gap-2 text-left flex-1 min-w-0"
                    >
                      {abierto ? (
                        <ChevronDown size={16} className="text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight size={16} className="text-slate-400 shrink-0" />
                      )}
                      <span className="min-w-0">
                        <span className="font-semibold text-slate-800 block truncate">
                          {g.nombre}
                          <span className="ml-1.5 font-mono text-[10px] text-slate-400 uppercase">
                            {g.prefijo}
                          </span>
                        </span>
                        <span className="text-xs text-slate-500">
                          {g.items.length} mov.
                          {g.unidadesIn > 0 && (
                            <span className="text-emerald-700 font-semibold">
                              {" "}· +{g.unidadesIn} u.
                            </span>
                          )}
                          {g.unidadesOut > 0 && (
                            <span className="text-amber-700 font-semibold">
                              {" "}· −{g.unidadesOut} u.
                            </span>
                          )}
                          {g.diferencias > 0 && (
                            <span className="text-red-600 font-semibold">
                              {" "}· {g.diferencias} con diferencia
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    {g.pendientes > 0 ? (
                      <span className="text-[10px] font-bold uppercase bg-amber-500 text-white rounded px-1.5 py-0.5">
                        {g.pendientes} por verificar
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 rounded px-1.5 py-0.5 flex items-center gap-1">
                        <ClipboardCheck size={11} /> Todo verificado
                      </span>
                    )}
                    <button
                      onClick={() =>
                        setComprobante({ nombre: g.nombre, prefijo: g.prefijo, items: g.items })
                      }
                      title="Imprimir comprobante para firmar"
                      className="flex items-center gap-1 border border-slate-300 hover:bg-white rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      <Printer size={14} /> Comprobante
                    </button>
                    {g.pendientes > 0 && (
                      <button
                        onClick={() => verificarGrupo(empId, g.items)}
                        disabled={enCurso}
                        className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        {enCurso ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <ClipboardCheck size={14} />
                        )}
                        Verificar todo
                      </button>
                    )}
                  </div>

                  {abierto && (
                    <div className="border-t border-slate-200 bg-white">
                      {g.items.map((x) => (
                        <FilaAuditoria
                          key={x.movId}
                          x={x}
                          busy={verificando === x.movId}
                          onVerificar={() => verificarUno(x)}
                          onDesverificar={() => desverificarUno(x)}
                          onDiferencia={() => {
                            setDifObjetivo(x);
                            setDifCantidad(x.verificacion?.cantidadReal ?? x.cantidad);
                            setDifNota(x.verificacion?.nota ?? "");
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {agrupado && !cargandoIng && !errorIng && gruposIng.length === 0 && (
          <p className="px-3 py-8 text-center text-slate-400 text-sm">
            {ingresos.length > 0
              ? "Ningún ingreso coincide con los filtros."
              : esHoyIng
              ? "Aún no hay ingresos cargados hoy."
              : "No hubo ingresos en el periodo."}
          </p>
        )}
        {agrupado && cargandoIng && (
          <p className="px-3 py-8 text-center text-slate-400 text-sm">Cargando ingresos…</p>
        )}

        {!agrupado && (
        <div className="tabla-scroll">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                {periodoIng !== "dia" && (
                  <th className="text-left px-3 py-2 w-20">Fecha</th>
                )}
                <th className="text-left px-3 py-2 w-16">Hora</th>
                <th className="text-left px-3 py-2">Emprendedor</th>
                <th className="text-left px-3 py-2">Producto</th>
                <th className="text-right px-3 py-2 w-20">Cantidad</th>
                <th
                  className="text-right px-3 py-2 w-24"
                  title="Precio de venta ACTUAL del producto en el catálogo (lo mismo que ve el emprendedor en su app)"
                >
                  Precio
                </th>
                <th className="text-left px-3 py-2 w-28">Tipo</th>
                <th className="text-left px-3 py-2 w-24">Origen</th>
                <th className="text-left px-3 py-2 w-40">Auditoría</th>
              </tr>
            </thead>
            <tbody>
              {cargandoIng && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    Cargando ingresos…
                  </td>
                </tr>
              )}
              {!cargandoIng && !errorIng && ingresosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    {ingresos.length > 0 ? (
                      <>
                        Ningún ingreso coincide con los filtros.
                        <div className="mt-1 text-[11px]">
                          Hay {ingresos.length} ingreso(s) en el periodo:
                          prueba con <b>Limpiar filtros</b>.
                        </div>
                      </>
                    ) : esHoyIng ? (
                      "Aún no hay ingresos cargados hoy."
                    ) : periodoIng === "mes" ? (
                      "No hubo ingresos ese mes."
                    ) : (
                      "No hubo ingresos ese día."
                    )}
                    {esHoyIng && ingresos.length === 0 && (
                      <div className="mt-2 text-[11px] text-slate-400">
                        Si acabás de cargar productos desde /alta y no los ves acá,
                        recargá esa pestaña con Ctrl+Shift+R y volvé a cargar uno:
                        los movimientos anteriores al último deploy no tienen el
                        campo <span className="font-mono">negocioId</span> y por eso
                        quedan fuera de esta query.
                      </div>
                    )}
                  </td>
                </tr>
              )}
              {ingresosFiltrados.map((x, i) => {
                const hora = new Date(x.en).toLocaleTimeString("es-CL", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <tr key={`${x.emprendedorId}-${x.en}-${i}`} className="border-t hover:bg-slate-50">
                    {periodoIng !== "dia" && (
                      <td className="px-3 py-2 text-slate-600 font-mono text-xs">
                        {new Date(x.en).toLocaleDateString("es-CL", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </td>
                    )}
                    <td className="px-3 py-2 text-slate-600 font-mono text-xs">{hora}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{x.emprendedorNombre}</div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-mono">
                        {x.emprendedorPrefijo}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {/* Se muestra la descripción ACTUAL del catálogo (la que
                          el emprendedor ve en su app); la declarada queda como
                          referencia cuando difiere. */}
                      <div
                        className="text-slate-800 truncate max-w-[260px]"
                        title={x.descripcionActual ?? x.descripcion}
                      >
                        {x.descripcionActual ?? x.descripcion ?? "—"}
                      </div>
                      {x.descripcionActual !== undefined &&
                        x.descripcion &&
                        x.descripcionActual !== x.descripcion && (
                          <div
                            className="text-[10px] text-violet-600 truncate max-w-[260px]"
                            title={`Declarado: ${x.descripcion}`}
                          >
                            antes: {x.descripcion}
                          </div>
                        )}
                      <div className="text-xs text-slate-500 font-mono">{x.codigo}</div>
                      {x.detalle && (
                        <div className="text-[11px] text-violet-700 mt-0.5">{x.detalle}</div>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        x.tipo === "edicion"
                          ? "text-slate-300"
                          : x.tipo === "retiro"
                          ? "text-amber-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {x.tipo === "edicion" ? "—" : `${x.tipo === "retiro" ? "−" : "+"}${x.cantidad}`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {x.precioActual !== undefined || x.precio !== undefined ? (
                        <>
                          <span className="font-medium text-slate-800">
                            {money(x.precioActual ?? x.precio ?? 0)}
                          </span>
                          {x.tipo === "alta" &&
                            x.precio !== undefined &&
                            x.precioActual !== undefined &&
                            x.precioActual !== x.precio && (
                              <div
                                className="text-[10px] text-violet-600"
                                title="El precio cambió después del alta"
                              >
                                declaró {money(x.precio)}
                              </div>
                            )}
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <BadgeTipoMov tipo={x.tipo} />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                          x.origen === "emprendedor"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                        title={`Cargado por ${x.por}`}
                      >
                        {x.origen === "emprendedor" ? "Emprendedor" : "Admin"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {x.verificacion ? (
                        <EstadoVerificacion x={x} />
                      ) : (
                        <button
                          onClick={() => verificarUno(x)}
                          disabled={verificando === x.movId}
                          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-2 py-1 text-xs font-semibold disabled:opacity-50"
                        >
                          {verificando === x.movId ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <ClipboardCheck size={12} />
                          )}
                          Verificar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Reportes: ataja la búsqueda manual por fecha. Consulta Firestore por
          rango y arma un Excel con resumen + ventas + devoluciones del periodo. */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-1">
          <FileSpreadsheet className="text-emerald-600" size={20} /> Reportes
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Descarga un Excel con todas las ventas y devoluciones del periodo. Incluye una hoja
          Resumen con el total bruto, devuelto y neto.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          <button
            onClick={() => descargarReporte("diario")}
            disabled={descargando !== null}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            {descargando === "diario" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <CalendarDays size={18} />
            )}
            Reporte de hoy
          </button>
          <button
            onClick={() => descargarReporte("semanal")}
            disabled={descargando !== null}
            className="flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            {descargando === "semanal" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <CalendarRange size={18} />
            )}
            Reporte semanal (últimos 7 días)
          </button>
        </div>
        {reporteErr && (
          <p className="mt-2 text-sm text-red-600">{reporteErr}</p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <History className="text-cyan-600" size={22} /> Historial de ventas
            <span
              className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                alcance === "hoy"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {alcance === "hoy" ? "Hoy" : "Últimas 300"}
            </span>
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {alcance === "hoy" ? (
              <button
                onClick={() => cargar("historico")}
                disabled={cargando}
                title="Carga las últimas 300 ventas para buscar una antigua"
                className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                <CalendarRange size={16} /> Cargar últimas 300
              </button>
            ) : (
              <button
                onClick={() => cargar("hoy")}
                disabled={cargando}
                title="Vuelve al modo liviano: solo ventas de hoy"
                className="flex items-center gap-1.5 border border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                <CalendarDays size={16} /> Solo hoy
              </button>
            )}
            <button
              onClick={exportar}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-3 py-2 text-sm"
            >
              <Download size={16} /> Exportar
            </button>
            <button
              onClick={() => cargar()}
              disabled={cargando}
              className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <RefreshCw size={16} className={cargando ? "animate-spin" : ""} /> Refrescar
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <div className="relative sm:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar por N° venta, cliente, vendedor o código de boleta…"
              className="w-full border rounded-lg pl-9 pr-3 py-2"
            />
          </div>
          <div className="text-sm">
            <span className="text-slate-500">Desde</span>
            <SelectorFecha value={desde} onChange={setDesde} className="mt-1" />
          </div>
          <div className="text-sm">
            <span className="text-slate-500">Hasta</span>
            <SelectorFecha value={hasta} onChange={setHasta} className="mt-1" />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span className="text-slate-500">
            Ventas: <b className="text-slate-800">{resumen.n}</b>
          </span>
          <span className="text-slate-500">
            Unidades: <b className="text-slate-800">{resumen.unidades}</b>
          </span>
          <span className="text-slate-500">
            Total vendido: <b className="text-emerald-700">{money(resumen.total)}</b>
          </span>
          {resumen.devuelto > 0 && (
            <span className="text-slate-500">
              Devuelto: <b className="text-red-600">−{money(resumen.devuelto)}</b>
            </span>
          )}
          {resumen.anulado > 0 && (
            <span className="text-slate-500">
              Anulado ({resumen.nAnuladas}):{" "}
              <b className="text-red-600">−{money(resumen.anulado)}</b>
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow tabla-scroll anim-in">
        <table className="w-full text-sm min-w-[620px]">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="w-8"></th>
              <th className="text-left px-3 py-2">N° venta</th>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Medio</th>
              <th className="text-right px-3 py-2">Ítems</th>
              <th className="text-right px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  Cargando historial…
                </td>
              </tr>
            )}
            {!cargando && error && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-red-500">
                  {error}
                </td>
              </tr>
            )}
            {!cargando && !error && filtradas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  No hay ventas registradas
                </td>
              </tr>
            )}
            {filtradas.map((v) => {
              const abierto = abierta === v.nro;
              return (
                <FilaVenta
                  key={v.nro}
                  venta={v}
                  vendedor={vendedor}
                  devoluciones={devolucionesPorVenta.get(v.nro) || []}
                  abierto={abierto}
                  onToggle={() => setAbierta(abierto ? null : v.nro)}
                  onDevolver={() => setDevolver(v)}
                  onImprimir={() => setImprimir(v)}
                  onAnular={() => setAnular(v)}
                  onCodigoBoletaActualizado={(codigo) =>
                    setVentas((prev) =>
                      prev.map((x) => (x.nro === v.nro ? { ...x, codigoBoleta: codigo } : x))
                    )
                  }
                  onMedioPagoActualizado={(medio, cli) =>
                    setVentas((prev) =>
                      prev.map((x) =>
                        x.nro === v.nro
                          ? {
                              ...x,
                              medioPago: medio,
                              clienteId: medio === "fiado" ? cli?.id : undefined,
                              clienteNombre: medio === "fiado" ? cli?.nombre : undefined,
                            }
                          : x
                      )
                    )
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <ModalDevolucion
        venta={devolver}
        devolucionesPrevias={devolver ? devolucionesPorVenta.get(devolver.nro) || [] : []}
        vendedor={vendedor}
        onCerrar={() => setDevolver(null)}
        onConfirmada={async () => {
          setDevolver(null);
          await cargar();
        }}
      />

      <ModalImprimirBoleta venta={imprimir} onCerrar={() => setImprimir(null)} />

      <ModalAnularVenta
        venta={anular}
        tieneDevoluciones={
          anular ? (devolucionesPorVenta.get(anular.nro) || []).length > 0 : false
        }
        vendedor={vendedor}
        onCerrar={() => setAnular(null)}
        onAnulada={async () => {
          setAnular(null);
          await cargar();
        }}
      />

      {/* Verificar con diferencia: lo contado no calza con lo declarado.
          No corrige el stock — deja constancia de la diferencia firmada. */}
      <Modal
        abierto={!!difObjetivo}
        onCerrar={difBusy ? () => {} : () => setDifObjetivo(null)}
        titulo="Cantidad distinta a la declarada"
        maxW="max-w-md"
      >
        {difObjetivo && (
          <div className="space-y-3">
            <div className="bg-slate-50 rounded-lg p-3 text-sm">
              <div className="font-semibold text-slate-800">
                {difObjetivo.descripcion || difObjetivo.codigo}
              </div>
              <div className="text-xs text-slate-500 font-mono">
                {difObjetivo.codigo} · {difObjetivo.emprendedorNombre}
              </div>
              <div className="mt-1 text-xs">
                Declarado en la app:{" "}
                <b className="text-slate-800">{difObjetivo.cantidad} u.</b>
              </div>
            </div>
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">
                Cantidad realmente contada
              </span>
              <input
                type="number"
                min={0}
                autoFocus
                value={difCantidad}
                onChange={(e) => setDifCantidad(Number(e.target.value) || 0)}
                className="mt-1 w-full border rounded-lg px-3 py-2.5 text-lg font-semibold text-center"
              />
            </label>
            {difCantidad !== difObjetivo.cantidad && (
              <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                Diferencia de{" "}
                <b>
                  {difCantidad > difObjetivo.cantidad ? "+" : ""}
                  {difCantidad - difObjetivo.cantidad} u.
                </b>{" "}
                respecto a lo declarado. Queda registrada en el historial y
                aparece en el comprobante. El stock no se modifica: si
                corresponde ajustarlo, hazlo desde Stock.
              </p>
            )}
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">Nota (opcional)</span>
              <input
                value={difNota}
                onChange={(e) => setDifNota(e.target.value)}
                placeholder="Ej: faltaron 2, quedaron en su casa"
                className="mt-1 w-full border rounded-lg px-3 py-2"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDifObjetivo(null)}
                disabled={difBusy}
                className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardarDiferencia}
                disabled={difBusy}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
              >
                {difBusy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ClipboardCheck size={16} />
                )}
                Guardar verificación
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Comprobante para firmar. La vista previa vive en el modal; al
          imprimir, el CSS deja visible solo #comprobante. */}
      <Modal
        abierto={!!comprobante}
        onCerrar={() => setComprobante(null)}
        titulo={comprobante ? `Comprobante · ${comprobante.nombre}` : ""}
        maxW="max-w-3xl"
      >
        {comprobante && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 no-print">
              Imprime dos copias: una firmada queda en el local y la otra se la
              lleva el emprendedor.
            </p>
            <div className="max-h-[60vh] overflow-y-auto border rounded-lg p-2 bg-slate-50">
              <ComprobanteMovimientos
                id=""
                emprendedorNombre={comprobante.nombre}
                emprendedorPrefijo={comprobante.prefijo}
                items={comprobante.items}
                periodo={etiquetaPeriodoIng}
                recibidoPor={vendedor}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setComprobante(null)}
                className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100"
              >
                Cerrar
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg px-4 py-2"
              >
                <Printer size={16} /> Imprimir
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Copia real de impresión, montada como PORTAL en <body>: mismo
          patrón que la reimpresión de boleta. El wrapper del Modal tiene
          `no-print` (display:none !important al imprimir), así que una copia
          dentro de él se colapsa y la hoja sale en blanco. El portal escapa
          de ese subárbol y de cualquier ancestro fixed/overflow. */}
      {montado && comprobante &&
        createPortal(
          <div className="solo-impresion">
            <ComprobanteMovimientos
              emprendedorNombre={comprobante.nombre}
              emprendedorPrefijo={comprobante.prefijo}
              items={comprobante.items}
              periodo={etiquetaPeriodoIng}
              recibidoPor={vendedor}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

function FilaVenta({
  venta: v,
  vendedor,
  devoluciones,
  abierto,
  onToggle,
  onDevolver,
  onImprimir,
  onAnular,
  onCodigoBoletaActualizado,
  onMedioPagoActualizado,
}: {
  venta: Venta;
  vendedor: string;
  devoluciones: Devolucion[];
  abierto: boolean;
  onToggle: () => void;
  onDevolver: () => void;
  onImprimir: () => void;
  onAnular: () => void;
  onCodigoBoletaActualizado: (codigo: string) => void;
  onMedioPagoActualizado: (medio: MedioPago, cliente?: { id: string; nombre?: string }) => void;
}) {
  // Estado local del editor inline para el código de boleta. Se re-syncea
  // cuando la venta cambia (ej. tras refrescar o tras guardar).
  const [edCodBoleta, setEdCodBoleta] = useState(v.codigoBoleta || "");
  const [guardandoCod, setGuardandoCod] = useState(false);
  const [errCodBoleta, setErrCodBoleta] = useState("");
  useEffect(() => {
    setEdCodBoleta(v.codigoBoleta || "");
  }, [v.codigoBoleta]);

  // Editor de medio de pago: reversible mientras la venta no esté anulada y
  // no tenga devoluciones (donde el "medio de pago original" ya se congeló).
  const [edMedio, setEdMedio] = useState<MedioPago>(v.medioPago || "efectivo");
  const [edClienteId, setEdClienteId] = useState<string>(v.clienteId || "");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [guardandoMedio, setGuardandoMedio] = useState(false);
  const [errMedio, setErrMedio] = useState("");
  useEffect(() => {
    setEdMedio(v.medioPago || "efectivo");
    setEdClienteId(v.clienteId || "");
  }, [v.medioPago, v.clienteId]);
  // Carga la lista de clientes la primera vez que hace falta (al abrir el
  // detalle o al elegir "fiado"), no en el mount para no listar en toda fila.
  // Usamos un ref como flag de "ya intenté" para evitar un loop cuando el
  // negocio no tiene clientes: listarClientes devuelve [] y la guarda por
  // clientes.length seguía disparando la carga en cada render.
  const clientesIntentados = useRef(false);
  useEffect(() => {
    if (!abierto || clientesIntentados.current) return;
    clientesIntentados.current = true;
    setCargandoClientes(true);
    listarClientes()
      .then((cs) => setClientes(cs))
      .catch(() => setClientes([]))
      .finally(() => setCargandoClientes(false));
  }, [abierto]);

  async function guardarMedioPago() {
    setGuardandoMedio(true);
    setErrMedio("");
    try {
      const cli =
        edMedio === "fiado"
          ? {
              id: edClienteId,
              nombre: clientes.find((c) => c.id === edClienteId)?.nombre || "",
            }
          : undefined;
      await actualizarMedioPago(v, edMedio, vendedor || v.vendedor || "", cli);
      onMedioPagoActualizado(edMedio, cli);
    } catch (e) {
      setErrMedio(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardandoMedio(false);
    }
  }

  async function guardarCodigoBoleta() {
    const cod = edCodBoleta.trim();
    setGuardandoCod(true);
    setErrCodBoleta("");
    try {
      await actualizarCodigoBoleta(v.nro, cod);
      onCodigoBoletaActualizado(cod);
    } catch (e) {
      setErrCodBoleta(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardandoCod(false);
    }
  }

  // Cuánto se ha devuelto por cada línea (por código, suma de cantidades).
  // Para líneas manuales (sin código) usamos la descripción como clave.
  const devueltoPorClave = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of devoluciones) {
      for (const l of d.items) {
        const k = claveLinea(l);
        m.set(k, (m.get(k) || 0) + l.cantidad);
      }
    }
    return m;
  }, [devoluciones]);

  const totalDevuelto = devoluciones.reduce((s, d) => s + (d.total || 0), 0);
  const completaDevuelta = totalDevuelto >= v.total - 0.5; // tolerancia centavos
  const anulada = !!v.anulada;

  return (
    <>
      <tr
        className={`border-t hover:bg-slate-50 cursor-pointer ${
          anulada ? "bg-red-50/40" : ""
        }`}
        onClick={onToggle}
      >
        <td className="px-2 text-slate-400 text-center">
          {abierto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </td>
        <td className={`px-3 py-2 font-mono ${anulada ? "line-through text-slate-400" : ""}`}>
          {v.nro}
          {v.codigoBoleta && (
            <span
              className="ml-2 text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-cyan-100 text-cyan-800 font-sans"
              title={`Código de boleta: ${v.codigoBoleta}`}
            >
              B·{v.codigoBoleta}
            </span>
          )}
        </td>
        <td className={`px-3 py-2 ${anulada ? "text-slate-400" : ""}`}>{v.fecha}</td>
        <td className="px-3 py-2">
          <span className={anulada ? "text-slate-400 line-through" : ""}>{v.cliente}</span>
          {anulada && (
            <span
              className="ml-2 text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-red-600 text-white"
              title={`Anulada: ${v.anulada?.motivo || "sin motivo"}`}
            >
              ANULADA
            </span>
          )}
          {!anulada && totalDevuelto > 0 && (
            <span
              className={`ml-2 text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                completaDevuelta
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700"
              }`}
              title={`Devuelto ${money(totalDevuelto)}`}
            >
              {completaDevuelta ? "DEV total" : `DEV −${money(totalDevuelto)}`}
            </span>
          )}
        </td>
        <td className={`px-3 py-2 ${anulada ? "text-slate-400" : ""}`}>
          <BadgeMedio medio={v.medioPago} anulada={anulada} />
        </td>
        <td className={`px-3 py-2 text-right ${anulada ? "text-slate-400" : ""}`}>
          {v.items.length}
        </td>
        <td
          className={`px-3 py-2 text-right font-semibold ${
            anulada ? "text-slate-400 line-through" : ""
          }`}
        >
          {money(v.total)}
        </td>
      </tr>
      {abierto && (
        <tr className="bg-slate-50">
          <td></td>
          <td colSpan={6} className="px-3 py-2">
            <table className="w-full text-xs anim-pop">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left py-1">Código</th>
                  <th className="text-left py-1">Descripción</th>
                  <th className="text-right py-1">Cant.</th>
                  <th className="text-right py-1">Devuelta</th>
                  <th className="text-right py-1">Precio</th>
                  <th className="text-right py-1">Dscto</th>
                  <th className="text-right py-1">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {v.items.map((l, i) => {
                  const dev = devueltoPorClave.get(claveLinea(l)) || 0;
                  return (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="py-1 font-mono">{l.codigo}</td>
                      <td className="py-1">{l.descripcion}</td>
                      <td className="py-1 text-right">{l.cantidad}</td>
                      <td className="py-1 text-right text-red-600">
                        {dev > 0 ? `−${dev}` : "—"}
                      </td>
                      <td className="py-1 text-right">{money(l.precio)}</td>
                      <td className="py-1 text-right">{l.descuento}%</td>
                      <td className="py-1 text-right font-semibold">
                        {money(subtotalLinea(l))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {devoluciones.length > 0 && (
              <div className="mt-3 border-t border-slate-200 pt-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 mb-1">
                  Devoluciones ({devoluciones.length})
                </div>
                <ul className="space-y-1 text-xs">
                  {devoluciones.map((d) => (
                    <li key={d.nro} className="flex items-center justify-between gap-3">
                      <span className="font-mono text-slate-600">
                        {d.nro} · {d.fecha}
                        {d.vendedor && ` · ${d.vendedor}`}
                        {d.motivo && ` · ${d.motivo}`}
                      </span>
                      <span className="font-semibold text-red-600">−{money(d.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Editor inline del código de boleta: si ya existe queda
                pre-rellenado y editable; si está vacío, agregar uno. El botón
                Guardar aparece solo cuando difiere del actual. */}
            <div className="mt-3 border-t border-slate-200 pt-2 flex items-center gap-2 text-xs flex-wrap">
              <span className="text-slate-500 font-semibold">Código de boleta:</span>
              <input
                value={edCodBoleta}
                onChange={(e) => setEdCodBoleta(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Folio de la boleta"
                className="border border-slate-300 rounded-lg px-2 py-1 text-xs min-w-[160px]"
              />
              {edCodBoleta.trim() !== (v.codigoBoleta || "").trim() && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    guardarCodigoBoleta();
                  }}
                  disabled={guardandoCod}
                  className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  {guardandoCod ? "…" : "Guardar"}
                </button>
              )}
              {errCodBoleta && (
                <span className="text-red-600 text-[11px]">{errCodBoleta}</span>
              )}
            </div>

            {/* Editor inline del medio de pago. Permite corregir un cobro mal
                registrado. Se bloquea si la venta está anulada o tiene
                devoluciones (donde el medio original ya se congeló). */}
            {!anulada && devoluciones.length === 0 && (
              <div className="mt-2 border-t border-slate-200 pt-2 flex items-center gap-2 text-xs flex-wrap">
                <span className="text-slate-500 font-semibold">Medio de pago:</span>
                <select
                  value={edMedio}
                  onChange={(e) => {
                    e.stopPropagation();
                    setEdMedio(e.target.value as MedioPago);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white"
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="debito">Débito</option>
                  <option value="credito">Crédito</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="fiado">Fiado</option>
                </select>
                {edMedio === "fiado" && (
                  <select
                    value={edClienteId}
                    onChange={(e) => {
                      e.stopPropagation();
                      setEdClienteId(e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white min-w-[160px]"
                  >
                    <option value="">
                      {cargandoClientes ? "Cargando clientes…" : "Selecciona cliente…"}
                    </option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                )}
                {(edMedio !== (v.medioPago || "efectivo") ||
                  (edMedio === "fiado" && edClienteId !== (v.clienteId || ""))) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      guardarMedioPago();
                    }}
                    disabled={
                      guardandoMedio || (edMedio === "fiado" && !edClienteId)
                    }
                    className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
                  >
                    {guardandoMedio ? "…" : "Guardar"}
                  </button>
                )}
                {errMedio && (
                  <span className="text-red-600 text-[11px]">{errMedio}</span>
                )}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              {v.vendedor && (
                <span className="text-slate-400">Vendedor: {v.vendedor}</span>
              )}
              <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                {anulada && v.anulada && (
                  <span className="text-xs text-red-700 font-semibold">
                    Anulada {fmtFechaCorta(v.anulada.en)}
                    {v.anulada.por && ` por ${v.anulada.por}`}
                    {v.anulada.motivo && ` · ${v.anulada.motivo}`}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onImprimir();
                  }}
                  className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg px-3 py-1.5 text-xs"
                >
                  <Printer size={14} /> Reimprimir boleta
                </button>
                {!anulada && (completaDevuelta ? (
                  <span className="text-xs text-red-600 font-semibold">
                    Venta completamente devuelta
                  </span>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDevolver();
                      }}
                      className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-3 py-1.5 text-xs"
                    >
                      <Undo2 size={14} /> Devolver productos
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAnular();
                      }}
                      disabled={devoluciones.length > 0}
                      title={
                        devoluciones.length > 0
                          ? "No se puede anular: ya tiene devoluciones."
                          : "Anular la venta entera"
                      }
                      className="flex items-center gap-1.5 border-2 border-red-600 text-red-700 hover:bg-red-50 font-semibold rounded-lg px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Ban size={14} /> Anular venta
                    </button>
                  </>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Clave estable de una línea de venta para cruzar con devoluciones. Para
// productos de catálogo es el código; para manuales (sin código) usamos la
// descripción + precio (un manual es una "etiqueta libre" en la venta).
function claveLinea(l: LineaVenta): string {
  if (l.codigo) return `c:${l.codigo}`;
  return `m:${l.descripcion}|${l.precio}`;
}

// Fecha local en formato ISO yyyy-mm-dd (sin desfase UTC).
function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// "12/06 14:30" para mostrar fecha+hora de una anulación en una sola línea.
function fmtFechaCorta(t: number): string {
  const d = new Date(t);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes} ${h}:${m}`;
}

// ===== Modal de anulación de venta =====

function ModalAnularVenta({
  venta,
  tieneDevoluciones,
  vendedor,
  onCerrar,
  onAnulada,
}: {
  venta: Venta | null;
  tieneDevoluciones: boolean;
  vendedor: string;
  onCerrar: () => void;
  onAnulada: () => Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hayCaja, setHayCaja] = useState<boolean | null>(null);

  useEffect(() => {
    if (!venta) return;
    setMotivo("");
    setErr("");
    setBusy(false);
    if (venta.medioPago === "efectivo") {
      setHayCaja(null);
      cajaAbierta()
        .then((c) => setHayCaja(!!c))
        .catch(() => setHayCaja(false));
    } else {
      setHayCaja(true);
    }
  }, [venta]);

  const necesitaCaja = venta?.medioPago === "efectivo";
  const bloqueadoPorCaja = necesitaCaja && hayCaja === false;

  async function confirmar() {
    if (!venta) return;
    if (!motivo.trim()) {
      setErr("Escribe el motivo de la anulación.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await anularVenta(venta, motivo.trim(), vendedor || venta.vendedor || "");
      await onAnulada();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo anular la venta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      abierto={!!venta}
      onCerrar={busy ? () => {} : onCerrar}
      titulo={venta ? `Anular venta · ${venta.nro}` : ""}
      maxW="max-w-md"
    >
      {venta && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-3 text-sm">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle size={16} /> Anular es irreversible
            </div>
            <p className="mt-1 text-xs">
              La venta queda marcada como ANULADA. Se restituye el stock,
              {venta.medioPago === "fiado" && " se abona la deuda del cliente,"}
              {venta.medioPago === "efectivo" && " se descuenta de la caja abierta,"}
              {" "} y deja de contar en los totales.
            </p>
          </div>

          <div className="bg-slate-50 rounded-lg p-3 text-sm grid sm:grid-cols-3 gap-2">
            <span>
              <span className="text-slate-500">Cliente:</span>{" "}
              <b className="text-slate-800">{venta.cliente || "—"}</b>
            </span>
            <span>
              <span className="text-slate-500">Medio:</span>{" "}
              <b className="text-slate-800 capitalize">{venta.medioPago || "—"}</b>
            </span>
            <span>
              <span className="text-slate-500">Total:</span>{" "}
              <b className="text-slate-800">{money(venta.total)}</b>
            </span>
          </div>

          {tieneDevoluciones && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              No se puede anular: la venta ya tiene devoluciones registradas.
            </div>
          )}

          {bloqueadoPorCaja && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                Para anular una venta en <b>efectivo</b> debe haber una caja abierta.
                Ve a Caja, abre el turno y vuelve.
              </div>
            </div>
          )}

          {necesitaCaja && hayCaja === null && (
            <div className="bg-slate-50 text-slate-500 rounded-lg px-3 py-2 text-xs">
              Verificando caja…
            </div>
          )}

          <label className="block text-sm">
            <span className="text-slate-600 font-medium">Motivo</span>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: error de cobro, cliente arrepentido, ítem mal cargado…"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              autoFocus
            />
          </label>

          <p className="text-xs text-slate-500">
            Anula: <b>{vendedor || "Sin vendedor"}</b>
          </p>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCerrar}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={confirmar}
              disabled={
                busy || tieneDevoluciones || bloqueadoPorCaja || !motivo.trim()
              }
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
              Anular venta
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ===== Modal de reimpresión de boleta =====
// El Ticket vive DENTRO del Modal (para el preview) y también como PORTAL
// pegado a <body> (para imprimir). Por qué doble: el wrapper del Modal tiene
// `no-print` (display:none !important en @media print) — cualquier hijo suyo
// se colapsa al imprimir. El portal escapa del subárbol del modal y por eso
// #ticket sobrevive a la impresión.
// El preview se renderiza SIN id="ticket" para no duplicar el id: solo la
// copia impresa queda como #ticket. La copia impresa va envuelta en
// .solo-impresion (hidden on screen, visible en print).

function ModalImprimirBoleta({
  venta,
  onCerrar,
}: {
  venta: Venta | null;
  onCerrar: () => void;
}) {
  // El portal solo puede montarse en cliente (document existe). En SSR se
  // omite; el preview del modal ya funciona sin portal.
  const [enCliente, setEnCliente] = useState(false);
  useEffect(() => {
    setEnCliente(true);
  }, []);

  return (
    <>
      <Modal
        abierto={!!venta}
        onCerrar={onCerrar}
        titulo={venta ? `Boleta · ${venta.nro}` : ""}
        maxW="max-w-md"
      >
        {venta && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <Ticket
                id="ticket-preview"
                nro={venta.nro}
                fecha={venta.fecha}
                cliente={venta.cliente || "Consumidor Final"}
                items={venta.items}
                total={venta.total}
                vendedor={venta.vendedor}
                medioPago={venta.medioPago}
                codigoBoleta={venta.codigoBoleta}
              />
            </div>
            <p className="text-xs text-slate-500 text-center">
              La vista de arriba es lo que se enviará a la impresora. Al imprimir
              sólo se imprime esta boleta (el resto de la pantalla queda fuera).
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCerrar}
                className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  // rAF asegura que el portal ya está pintado antes de que el
                  // navegador serialice el DOM para el diálogo de impresión.
                  requestAnimationFrame(() => window.print());
                }}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg px-4 py-2"
              >
                <Printer size={16} /> Imprimir
              </button>
            </div>
          </div>
        )}
      </Modal>

      {enCliente && venta &&
        createPortal(
          <div className="solo-impresion">
            <Ticket
              nro={venta.nro}
              fecha={venta.fecha}
              cliente={venta.cliente || "Consumidor Final"}
              items={venta.items}
              total={venta.total}
              vendedor={venta.vendedor}
              medioPago={venta.medioPago}
              codigoBoleta={venta.codigoBoleta}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

// ===== Modal de devolución =====

interface FilaDev {
  linea: LineaVenta;
  vendida: number;
  yaDevuelta: number;
  aDevolver: number;
}

function ModalDevolucion({
  venta,
  devolucionesPrevias,
  vendedor,
  onCerrar,
  onConfirmada,
}: {
  venta: Venta | null;
  devolucionesPrevias: Devolucion[];
  vendedor: string;
  onCerrar: () => void;
  onConfirmada: () => Promise<void>;
}) {
  const [filas, setFilas] = useState<FilaDev[]>([]);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Caja abierta: necesaria si la venta fue en efectivo. Se chequea al abrir
  // el modal para mostrar la advertencia antes de que el usuario seleccione.
  const [hayCaja, setHayCaja] = useState<boolean | null>(null);

  useEffect(() => {
    if (!venta) return;
    const devueltoPorClave = new Map<string, number>();
    for (const d of devolucionesPrevias) {
      for (const l of d.items) {
        const k = claveLinea(l);
        devueltoPorClave.set(k, (devueltoPorClave.get(k) || 0) + l.cantidad);
      }
    }
    setFilas(
      venta.items.map((linea) => {
        const yaDevuelta = devueltoPorClave.get(claveLinea(linea)) || 0;
        return {
          linea,
          vendida: linea.cantidad,
          yaDevuelta,
          aDevolver: 0,
        };
      })
    );
    setMotivo("");
    setErr("");
    setBusy(false);

    // Solo necesitamos saber si hay caja para el medio efectivo.
    if (venta.medioPago === "efectivo") {
      setHayCaja(null);
      cajaAbierta()
        .then((c) => setHayCaja(!!c))
        .catch(() => setHayCaja(false));
    } else {
      setHayCaja(true); // no aplica
    }
  }, [venta, devolucionesPrevias]);

  function setCantidad(idx: number, valor: number) {
    setFilas((arr) =>
      arr.map((f, i) => {
        if (i !== idx) return f;
        const max = f.vendida - f.yaDevuelta;
        const v = Math.max(0, Math.min(max, Math.floor(valor)));
        return { ...f, aDevolver: v };
      })
    );
  }

  const totalADevolver = useMemo(() => {
    return filas.reduce((s, f) => {
      if (f.aDevolver <= 0) return s;
      const linea: LineaVenta = { ...f.linea, cantidad: f.aDevolver };
      return s + subtotalLinea(linea);
    }, 0);
  }, [filas]);

  const algoSeleccionado = filas.some((f) => f.aDevolver > 0);
  const necesitaCaja = venta?.medioPago === "efectivo";
  const bloqueadoPorCaja = necesitaCaja && hayCaja === false;

  async function confirmar() {
    if (!venta) return;
    if (!motivo.trim()) {
      setErr("Indica el motivo de la devolución.");
      return;
    }
    if (!algoSeleccionado) {
      setErr("Marca al menos una línea para devolver.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const itemsADevolver: LineaVenta[] = filas
        .filter((f) => f.aDevolver > 0)
        .map((f) => ({ ...f.linea, cantidad: f.aDevolver }));
      await registrarDevolucion({
        fecha: hoyISO(),
        ventaNro: venta.nro,
        vendedor: vendedor || venta.vendedor || "",
        motivo: motivo.trim(),
        items: itemsADevolver,
        medioPagoOriginal: venta.medioPago || "efectivo",
        clienteId: venta.clienteId,
      });
      await onConfirmada();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo registrar la devolución.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      abierto={!!venta}
      onCerrar={busy ? () => {} : onCerrar}
      titulo={venta ? `Devolver productos · ${venta.nro}` : ""}
      maxW="max-w-2xl"
    >
      {venta && (
        <div className="space-y-4">
          {/* Resumen de la venta */}
          <div className="bg-slate-50 rounded-lg p-3 text-sm grid sm:grid-cols-3 gap-2">
            <span>
              <span className="text-slate-500">Cliente:</span>{" "}
              <b className="text-slate-800">{venta.cliente || "—"}</b>
            </span>
            <span>
              <span className="text-slate-500">Medio:</span>{" "}
              <b className="text-slate-800 capitalize">{venta.medioPago || "—"}</b>
            </span>
            <span>
              <span className="text-slate-500">Total:</span>{" "}
              <b className="text-slate-800">{money(venta.total)}</b>
            </span>
          </div>

          {bloqueadoPorCaja && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                Para devolver una venta en <b>efectivo</b> debe haber una caja abierta.
                Ve a Caja, abre el turno y vuelve.
              </div>
            </div>
          )}

          {necesitaCaja && hayCaja === null && (
            <div className="bg-slate-50 text-slate-500 rounded-lg px-3 py-2 text-xs">
              Verificando caja…
            </div>
          )}

          {venta.medioPago && venta.medioPago !== "efectivo" && venta.medioPago !== "fiado" && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs">
              Esta venta se cobró por <b>{venta.medioPago}</b>: la devolución dejará registro
              pero el chargeback al cliente se hace por el medio externo (POS/banco).
            </div>
          )}

          {venta.medioPago === "fiado" && (
            <div className="bg-cyan-50 border border-cyan-200 text-cyan-800 rounded-lg px-3 py-2 text-xs">
              Venta a fiado: la devolución reducirá automáticamente la deuda de{" "}
              <b>{venta.clienteNombre || venta.cliente || "el cliente"}</b>.
            </div>
          )}

          {/* Líneas con stepper */}
          <div className="border rounded-lg divide-y">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
              <div className="col-span-6">Producto</div>
              <div className="col-span-1 text-right">Vend.</div>
              <div className="col-span-1 text-right">Dev.</div>
              <div className="col-span-2 text-center">A devolver</div>
              <div className="col-span-2 text-right">Subtotal</div>
            </div>
            {filas.map((f, i) => {
              const max = f.vendida - f.yaDevuelta;
              const subt = f.aDevolver
                ? subtotalLinea({ ...f.linea, cantidad: f.aDevolver })
                : 0;
              const disabled = max <= 0;
              return (
                <div key={i} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm items-center">
                  <div className="col-span-6">
                    <div className="font-medium text-slate-800 truncate">
                      {f.linea.descripcion}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">{f.linea.codigo || "manual"}</div>
                  </div>
                  <div className="col-span-1 text-right text-slate-600">{f.vendida}</div>
                  <div className="col-span-1 text-right text-red-600">
                    {f.yaDevuelta || "—"}
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <button
                      onClick={() => setCantidad(i, f.aDevolver - 1)}
                      disabled={disabled || f.aDevolver <= 0}
                      className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-100 flex items-center justify-center disabled:opacity-30"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={max}
                      disabled={disabled}
                      value={f.aDevolver}
                      onChange={(e) => setCantidad(i, Number(e.target.value) || 0)}
                      className="w-12 text-center border rounded px-1 py-1 text-sm disabled:bg-slate-50"
                    />
                    <button
                      onClick={() => setCantidad(i, f.aDevolver + 1)}
                      disabled={disabled || f.aDevolver >= max}
                      className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-100 flex items-center justify-center disabled:opacity-30"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="col-span-2 text-right font-semibold text-slate-700">
                    {subt > 0 ? money(subt) : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">Motivo</span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: producto defectuoso, cliente cambió de opinión…"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <div className="text-sm">
              <div className="text-slate-500">Total a devolver</div>
              <div className="text-2xl font-bold text-red-600 mt-0.5">
                −{money(totalADevolver)}
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Devuelve: <b>{vendedor || "Sin vendedor"}</b> (cámbialo en el chip del header).
          </p>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCerrar}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={confirmar}
              disabled={busy || !algoSeleccionado || bloqueadoPorCaja || !motivo.trim()}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
              Confirmar devolución
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Mini-card de resumen para la sección "Ingresos del día".
// Etiqueta de tipo de movimiento (alta / reposición / retiro).
function BadgeTipoMov({ tipo }: { tipo: IngresoEmprendedor["tipo"] }) {
  const M = {
    alta: { txt: "Producto nuevo", cls: "bg-cyan-100 text-cyan-800" },
    reposicion: { txt: "Reposición", cls: "bg-emerald-100 text-emerald-800" },
    retiro: { txt: "Retiro", cls: "bg-amber-100 text-amber-800" },
    edicion: { txt: "Edición", cls: "bg-violet-100 text-violet-800" },
  } as const;
  const m = M[tipo];
  return (
    <span
      className={`inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${m.cls}`}
    >
      {m.txt}
    </span>
  );
}

// Sello de verificación: quién contó, cuándo y si hubo diferencia.
function EstadoVerificacion({ x }: { x: IngresoEmprendedor }) {
  const v = x.verificacion;
  if (!v) return null;
  const difiere = v.cantidadReal !== undefined && v.cantidadReal !== x.cantidad;
  return (
    <div className="text-xs">
      <span
        className={`inline-flex items-center gap-1 font-semibold ${
          difiere ? "text-red-700" : "text-emerald-700"
        }`}
      >
        {difiere ? <AlertTriangle size={12} /> : <ClipboardCheck size={12} />}
        {difiere ? `Contado: ${v.cantidadReal}` : "Verificado"}
      </span>
      <div className="text-[10px] text-slate-500">
        {v.por} ·{" "}
        {new Date(v.en).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })}{" "}
        {new Date(v.en).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
      </div>
      {v.nota && <div className="text-[10px] text-slate-500 italic">{v.nota}</div>}
    </div>
  );
}

// Fila de la vista agrupada: el gesto principal es "Verificar"; el enlace de
// diferencia queda a mano para cuando lo contado no calza.
function FilaAuditoria({
  x,
  busy,
  onVerificar,
  onDesverificar,
  onDiferencia,
}: {
  x: IngresoEmprendedor;
  busy: boolean;
  onVerificar: () => void;
  onDesverificar: () => void;
  onDiferencia: () => void;
}) {
  const v = x.verificacion;
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-b-0 flex-wrap">
      <div className="min-w-0 flex-1">
        {/* Descripción ACTUAL del catálogo: caja compara contra lo que el
            emprendedor ve hoy en su app, no contra la foto del movimiento. */}
        <div className="text-sm text-slate-800 truncate" title={x.descripcionActual ?? x.descripcion}>
          {x.descripcionActual ?? x.descripcion ?? "—"}
        </div>
        {x.descripcionActual !== undefined &&
          x.descripcion &&
          x.descripcionActual !== x.descripcion && (
            <div className="text-[10px] text-violet-600 truncate" title={`Declarado: ${x.descripcion}`}>
              antes: {x.descripcion}
            </div>
          )}
        <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
          <span className="font-mono">{x.codigo}</span>
          <span>
            {new Date(x.en).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })}{" "}
            {new Date(x.en).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <BadgeTipoMov tipo={x.tipo} />
        </div>
        {x.detalle && <div className="text-[11px] text-violet-700 mt-0.5">{x.detalle}</div>}
      </div>
      <div className="text-right shrink-0">
        {(x.precioActual !== undefined || x.precio !== undefined) && (
          <div className="text-sm font-semibold text-slate-800">
            {money(x.precioActual ?? x.precio ?? 0)}
          </div>
        )}
        {x.tipo !== "edicion" && (
          <div
            className={`text-lg font-bold leading-tight ${
              x.tipo === "retiro" ? "text-amber-700" : "text-emerald-700"
            }`}
          >
            {x.tipo === "retiro" ? "−" : "+"}
            {x.cantidad}
          </div>
        )}
      </div>
      <div className="shrink-0 min-w-[140px]">
        {v ? (
          <div className="flex items-center gap-2">
            <EstadoVerificacion x={x} />
            <button
              onClick={onDesverificar}
              disabled={busy}
              title="Deshacer verificación"
              className="text-slate-400 hover:text-red-600 p-1 disabled:opacity-50"
            >
              <Undo2 size={13} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={onVerificar}
              disabled={busy}
              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ClipboardCheck size={13} />
              )}
              Verificar
            </button>
            {/* "Contado distinto" no aplica a una edición de ficha: no hay
                unidades físicas que contar. */}
            {x.tipo !== "edicion" && (
              <button
                onClick={onDiferencia}
                disabled={busy}
                title="La cantidad física no coincide"
                className="border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                ≠
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResumenIng({
  label,
  valor,
  acento,
  icono,
}: {
  label: string;
  valor: string;
  acento?: "emerald" | "cyan" | "amber";
  icono?: React.ReactNode;
}) {
  const cls =
    acento === "emerald"
      ? "text-emerald-700"
      : acento === "cyan"
      ? "text-cyan-700"
      : acento === "amber"
      ? "text-amber-700"
      : "text-slate-800";
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
        {icono}
        {label}
      </div>
      <div className={`text-base font-bold mt-0.5 ${cls}`}>{valor}</div>
    </div>
  );
}

// Badge compacto de medio de pago para la tabla del historial. Color
// distinto por medio para que el cajero ubique de un vistazo.
function BadgeMedio({ medio, anulada }: { medio?: string; anulada: boolean }) {
  if (!medio) return <span className="text-slate-300 text-xs">—</span>;
  const ESTILOS: Record<string, { label: string; cls: string }> = {
    efectivo: { label: "Efectivo", cls: "bg-emerald-100 text-emerald-800" },
    debito: { label: "Débito", cls: "bg-cyan-100 text-cyan-800" },
    credito: { label: "Crédito", cls: "bg-indigo-100 text-indigo-800" },
    transferencia: { label: "Transfer.", cls: "bg-slate-100 text-slate-700" },
    fiado: { label: "Fiado", cls: "bg-amber-100 text-amber-800" },
  };
  const e = ESTILOS[medio] ?? { label: medio, cls: "bg-slate-100 text-slate-700" };
  return (
    <span
      className={`inline-block text-xs font-semibold rounded px-2 py-0.5 ${
        anulada ? "bg-slate-100 text-slate-400" : e.cls
      }`}
    >
      {e.label}
    </span>
  );
}
