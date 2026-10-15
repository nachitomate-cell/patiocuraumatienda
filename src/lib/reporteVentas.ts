// Reporte de ventas de un período en Excel, el mismo que usa la administración
// para liquidarle a cada emprendedor.
//
// Función pura: recibe las ventas, devoluciones y emprendedores ya leídos y
// arma el libro. La usan la pantalla de Administración (navegador) y el script
// scripts/reporte-ventas-periodo.mjs (Node), así que este archivo NO puede usar
// el alias "@/" ni sintaxis de TypeScript que Node no sepa borrar (enum,
// namespace, parameter properties): Node 24 lo importa directo quitando tipos.

import * as XLSX from "xlsx";
import type { Devolucion, LineaVenta, Venta } from "./types";

export interface EmprendedorReporte {
  id: string;
  nombre: string;
  prefijo?: string;
}

export interface EntradaReporte {
  negocio: string; // nombre a mostrar en el Resumen
  desde: string; // ISO yyyy-mm-dd (primer día del período)
  hasta: string; // ISO yyyy-mm-dd (último día, inclusive)
  ventas: Venta[];
  devoluciones: Devolucion[];
  emprendedores: EmprendedorReporte[];
  zonaHoraria?: string; // para horas y "Generado"; por defecto America/Santiago
  generado?: Date;
}

export interface FilaEmprendedor {
  emprendedor: string;
  unidades: number;
  total: number;
  porMes: Record<string, number>;
  desdeManual: number;
}

export interface ReporteVentas {
  libro: XLSX.WorkBook;
  ventasValidas: number;
  unidades: number;
  bruto: number;
  anuladas: number;
  montoAnulado: number;
  devoluciones: number;
  montoDevuelto: number;
  neto: number;
  diasConVentas: number;
  promedio: number;
  porEmprendedor: FilaEmprendedor[];
  porMedio: { medio: string; ventas: number; total: number }[];
  sinIdentificar: { lineas: number; monto: number; descripciones: { descripcion: string; monto: number }[] };
}

export const ZONA_CHILE = "America/Santiago";

const SIN_IDENTIFICAR = "(sin identificar)";
const COMO_CODIGO = "Código del producto";
const COMO_DEDUCIDO = "Deducido de lo escrito en la venta manual";
const COMO_SIN = "Venta manual sin código reconocible";
/** La línea trae código, pero su prefijo no es de ningún emprendedor (p. ej. PATI-). */
const COMO_CODIGO_SIN_EMP = "Código sin emprendedor asignado";

// ===== Deducción del emprendedor en ventas manuales =====
// Lógica validada a mano el 05-10-2026 sobre el histórico completo. Si se
// cambia, revisar contra ese archivo: cada regla existe por un caso real.

// Prefijos de 4 letras que también son palabras comunes en una descripción
// ("TODO", "ARTE"...): no se usan como palabra suelta.
const COMUNES = new Set(["TODO", "ARTE", "MANU", "SEMI", "POPA", "RITA", "HO", "FOS"]);
// Primeras palabras de nombres de emprendedor demasiado genéricas para
// identificar a nadie por sí solas.
const GEN = new Set([
  "CALOR", "PINTA", "ENCANTO", "AROMA", "DORADAS", "MANUALIDADES", "ARTESANA", "JARDIN",
  "DIVINA", "VIVERO", "MOSAICOS", "RINCON", "HECHIZOS", "DISTRITO", "VALERIA", "CAMBAR",
]);

function crearDeductor(emp: EmprendedorReporte[]): (desc: string) => string | null {
  const porPref = new Map<string, string>();
  for (const e of emp) if (e.prefijo) porPref.set(e.prefijo.toUpperCase(), e.nombre);
  return function deducir(desc: string): string | null {
    const D = String(desc || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    const tok = (D.match(/^[A-Z]+/) || [""])[0];
    if (tok.length >= 4) for (const [p, n] of porPref) if (p.length >= 4 && tok.startsWith(p)) return n;
    if (tok.length >= 2 && tok.length < 4 && /^[A-Z]+[\s\-]*\d/.test(D)) {
      if (porPref.has(tok)) return porPref.get(tok) as string;
      const c = [...porPref.keys()].filter((p) => p.startsWith(tok));
      if (c.length === 1) return porPref.get(c[0]) as string;
    }
    if (tok.length === 3 && !porPref.has(tok)) {
      const c = [...porPref.keys()].filter((p) => p.startsWith(tok));
      if (c.length === 1) return porPref.get(c[0]) as string;
    }
    for (const w of D.split(/[^A-Z0-9]+/)) {
      const L = (w.match(/^[A-Z]+/) || [""])[0];
      if (L.length === 4 && porPref.has(L) && !COMUNES.has(L)) return porPref.get(L) as string;
    }
    const sinEsp = D.replace(/[^A-Z]/g, "");
    for (const e of emp) {
      const N = e.nombre.toUpperCase().normalize("NFD").replace(/[^A-Z ]/g, "");
      const nEsp = N.replace(/[^A-Z]/g, "");
      if (nEsp.length >= 6 && sinEsp.includes(nEsp)) return e.nombre;
      const w1 = (N.match(/[A-Z]+/) || [""])[0];
      if (w1.length >= 5 && !GEN.has(w1) && D.split(/[^A-Z]+/).includes(w1)) return e.nombre;
    }
    if (D.split(/[^A-Z]+/).includes("KLAU")) return "Distrito KlauBrito";
    return null;
  };
}

// ===== Fechas =====

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function partesIso(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

// Desplazamiento (ms) de la zona horaria respecto de UTC en un instante dado.
function offsetZona(ms: number, zona: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second"));
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

// Fecha ISO yyyy-mm-dd de un instante, vista en la zona dada.
export function fechaEnZona(ms: number, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms));
}

// Instante (epoch ms) en que empieza el día `iso` en la zona dada, sin
// depender del TZ del proceso. Si ese día no tiene 00:00 (cambio de hora en
// Chile ocurre a medianoche), devuelve la primera hora que sí existe.
export function inicioDiaEnZona(iso: string, zona: string): number {
  const [y, m, d] = partesIso(iso);
  const base = Date.UTC(y, m - 1, d);
  const t1 = base - offsetZona(base, zona);
  const t2 = base - offsetZona(t1, zona);
  const validos = [t1, t2].filter((t) => fechaEnZona(t, zona) === iso);
  return validos.length ? Math.min(...validos) : t2;
}

// Rango [desde 00:00:00.000 del primer día, hasta 23:59:59.999 del último]
// en la zona dada, en ms de epoch (la unidad de `creadoEn`).
export function rangoEnZona(desdeIso: string, hastaIso: string, zona: string): { desde: number; hasta: number } {
  const [y, m, d] = partesIso(hastaIso);
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { desde: inicioDiaEnZona(desdeIso, zona), hasta: inicioDiaEnZona(siguiente, zona) - 1 };
}

// Texto del período: "del lunes 5 al domingo 11 de octubre".
export function describirRango(desdeIso: string, hastaIso: string): string {
  const [y1, m1, d1] = partesIso(desdeIso);
  const [y2, m2, d2] = partesIso(hastaIso);
  const dia = (y: number, m: number, d: number) => `${DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
  if (desdeIso === hastaIso) return `el ${dia(y1, m1, d1)} de ${MESES[m1 - 1]}`;
  if (y1 !== y2) {
    return `del ${dia(y1, m1, d1)} de ${MESES[m1 - 1]} de ${y1} al ${dia(y2, m2, d2)} de ${MESES[m2 - 1]} de ${y2}`;
  }
  if (m1 !== m2) return `del ${dia(y1, m1, d1)} de ${MESES[m1 - 1]} al ${dia(y2, m2, d2)} de ${MESES[m2 - 1]}`;
  return `del ${dia(y1, m1, d1)} al ${dia(y2, m2, d2)} de ${MESES[m2 - 1]}`;
}

// "Ventas Patio Curauma - 05 al 11-10-2026.xlsx" (mismo mes), "28-09 al
// 04-10-2026" (mismo año) o "28-12-2026 al 03-01-2027".
export function nombreArchivoReporte(negocio: string, desdeIso: string, hastaIso: string): string {
  const [y1, m1, d1] = partesIso(desdeIso);
  const [y2, m2, d2] = partesIso(hastaIso);
  const p = (n: number) => String(n).padStart(2, "0");
  const fin = `${p(d2)}-${p(m2)}-${y2}`;
  const limpio = negocio.replace(/[\\/:*?"<>|]/g, "").trim();
  if (desdeIso === hastaIso) return `Ventas ${limpio} - ${fin}.xlsx`;
  const ini = y1 !== y2 ? `${p(d1)}-${p(m1)}-${y1}` : m1 !== m2 ? `${p(d1)}-${p(m1)}` : p(d1);
  return `Ventas ${limpio} - ${ini} al ${fin}.xlsx`;
}

// Meses AAAA-MM que toca el período.
function mesesDelRango(desdeIso: string, hastaIso: string): string[] {
  let [y, m] = partesIso(desdeIso);
  const [y2, m2] = partesIso(hastaIso);
  const out: string[] = [];
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ===== Reporte =====

export function armarReporteVentas(entrada: EntradaReporte): ReporteVentas {
  const { negocio, desde, hasta, ventas, devoluciones } = entrada;
  const zona = entrada.zonaHoraria || ZONA_CHILE;
  const generado = entrada.generado || new Date();

  // Orden por id: el mismo en que Firestore entrega la colección, que es el
  // orden con que se validó la deducción (importa en empates).
  const emps = [...entrada.emprendedores].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const empPorId = new Map<string, string>();
  const empPorPrefijo = new Map<string, string>();
  for (const e of emps) {
    empPorId.set(e.id, e.nombre || e.id);
    if (e.prefijo) empPorPrefijo.set(e.prefijo, e.nombre || e.prefijo);
  }
  const deducir = crearDeductor(emps);

  const hora = (ms: number) =>
    new Date(ms).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: zona });
  const fechaIso = (ms: number) => fechaEnZona(ms, zona);
  // Montos a entero desde la línea: así boletas, detalle, días y totales cuadran al peso.
  const subtotal = (l: LineaVenta) => Math.round(l.cantidad * l.precio * (1 - (l.descuento || 0) / 100));
  const totalDe = (items: LineaVenta[] | undefined) => (items || []).reduce((s, l) => s + subtotal(l), 0);

  const nombreEmp = (l: LineaVenta): string => {
    if (l.emprendedorId && empPorId.has(l.emprendedorId)) return empPorId.get(l.emprendedorId) as string;
    if (l.emprendedorNombre) return l.emprendedorNombre;
    const m = String(l.codigo || "").match(/^([A-Z0-9]+)-/);
    if (m && empPorPrefijo.has(m[1])) return empPorPrefijo.get(m[1]) as string;
    return l.manual ? "(venta manual)" : "(sin emprendedor)";
  };
  const asignar = (l: LineaVenta): { emprendedor: string; como: string } => {
    const n = nombreEmp(l);
    if (n !== "(venta manual)" && n !== "(sin emprendedor)") return { emprendedor: n, como: COMO_CODIGO };
    const d = deducir(l.descripcion);
    if (d) return { emprendedor: d, como: COMO_DEDUCIDO };
    return { emprendedor: SIN_IDENTIFICAR, como: n === "(venta manual)" ? COMO_SIN : COMO_CODIGO_SIN_EMP };
  };

  // ===== Ventas (detalle) y agregados =====
  const detalle: Record<string, string | number>[] = [];
  const boletas: Record<string, string | number>[] = [];
  const meses = mesesDelRango(desde, hasta);
  const agg = new Map<string, FilaEmprendedor>();
  const porDia = new Map<string, { n: number; unidades: number; total: number; devuelto: number }>();
  const porMedio = new Map<string, { n: number; total: number }>();
  const sinId = new Map<string, number>();
  let bruto = 0, unidades = 0, nOk = 0, nAnuladas = 0, montoAnulado = 0, lineasSinId = 0, montoSinId = 0;

  for (const v of ventas) {
    const items = v.items || [];
    const tot = totalDe(items);
    const dia = v.fecha || fechaIso(v.creadoEn);
    const mes = dia.slice(0, 7);
    boletas.push({
      "Nro venta": v.nro,
      Fecha: dia,
      Hora: hora(v.creadoEn),
      Vendedor: v.vendedor ?? "",
      "Medio de pago": v.medioPago ?? "",
      Cliente: v.medioPago === "fiado" ? (v.clienteNombre ?? "") : "",
      "Items (líneas)": items.length,
      Unidades: items.reduce((s, l) => s + l.cantidad, 0),
      Total: tot,
      Anulada: v.anulada ? "SÍ" : "",
      "Motivo anulación": v.anulada?.motivo ?? "",
      "Código boleta": v.codigoBoleta ?? "",
    });

    for (const l of items) {
      const { emprendedor, como } = asignar(l);
      const sub = subtotal(l);
      detalle.push({
        Mes: mes,
        "Nro venta": v.nro,
        Fecha: dia,
        Hora: hora(v.creadoEn),
        Anulada: v.anulada ? "SÍ" : "",
        "Medio de pago": v.medioPago ?? "",
        Vendedor: v.vendedor ?? "",
        Codigo: l.codigo ?? "(manual)",
        Descripcion: l.descripcion ?? "",
        Emprendedor: emprendedor,
        "Cómo se asignó": como,
        Cantidad: l.cantidad,
        "Valor unidad": Math.round(l.precio),
        "Dscto%": l.descuento || 0,
        Subtotal: sub,
      });
      if (v.anulada) continue;
      const a = agg.get(emprendedor) || { emprendedor, unidades: 0, total: 0, porMes: {}, desdeManual: 0 };
      a.unidades += l.cantidad;
      a.total += sub;
      a.porMes[mes] = (a.porMes[mes] || 0) + sub;
      if (como === COMO_DEDUCIDO) a.desdeManual += sub;
      agg.set(emprendedor, a);
      if (emprendedor === SIN_IDENTIFICAR) {
        lineasSinId++;
        montoSinId += sub;
        const k = l.descripcion || "(sin descripción)";
        sinId.set(k, (sinId.get(k) || 0) + sub);
      }
      if (!meses.includes(mes)) meses.push(mes);
    }

    if (v.anulada) {
      nAnuladas++;
      montoAnulado += tot;
      continue;
    }
    nOk++;
    bruto += tot;
    const d = porDia.get(dia) || { n: 0, unidades: 0, total: 0, devuelto: 0 };
    d.n++;
    d.total += tot;
    for (const l of items) {
      unidades += l.cantidad;
      d.unidades += l.cantidad;
    }
    porDia.set(dia, d);
    const medio = v.medioPago || "(sin medio)";
    const pm = porMedio.get(medio) || { n: 0, total: 0 };
    pm.n++;
    pm.total += tot;
    porMedio.set(medio, pm);
  }
  meses.sort();

  let devuelto = 0;
  for (const d of devoluciones) {
    const tot = totalDe(d.items);
    devuelto += tot;
    const dia = d.fecha || fechaIso(d.creadoEn);
    const pd = porDia.get(dia) || { n: 0, unidades: 0, total: 0, devuelto: 0 };
    pd.devuelto += tot;
    porDia.set(dia, pd);
  }
  const neto = bruto - devuelto;
  const diasConVentas = [...porDia.values()].filter((d) => d.n > 0).length;
  const promedio = nOk ? Math.round(bruto / nOk) : 0;

  const porEmprendedor = [...agg.values()].sort((a, b) => b.total - a.total);
  const variosMeses = meses.length > 1;
  const porEmpRows = porEmprendedor.map((a) => {
    const o: Record<string, string | number> = { Emprendedor: a.emprendedor, Unidades: a.unidades, "Total vendido": a.total };
    if (variosMeses) for (const m of meses) o[m] = a.porMes[m] || 0;
    o["De eso, desde ventas manuales"] = a.desdeManual;
    return o;
  });

  const porDiaRows = [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, d]) => ({
      Fecha: dia,
      "Ventas (N°)": d.n,
      Unidades: d.unidades,
      "Total vendido": d.total,
      Devuelto: d.devuelto,
      Neto: d.total - d.devuelto,
    }));
  const porMedioList = [...porMedio.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([medio, m]) => ({ medio, ventas: m.n, total: m.total }));
  const porMedioRows = porMedioList.map((m) => ({ "Medio de pago": m.medio, "Ventas (N°)": m.ventas, Total: m.total }));

  const devolucionesRows = devoluciones.flatMap((d) =>
    (d.items || []).map((l) => ({
      "Nro devolución": d.nro,
      "Venta original": d.ventaNro,
      Fecha: d.fecha || fechaIso(d.creadoEn),
      Hora: hora(d.creadoEn),
      Vendedor: d.vendedor ?? "",
      "Medio original": d.medioPagoOriginal ?? "",
      Motivo: d.motivo ?? "",
      Codigo: l.codigo ?? "(manual)",
      Descripcion: l.descripcion ?? "",
      Emprendedor: nombreEmp(l),
      Cantidad: l.cantidad,
      "Valor unidad": Math.round(l.precio),
      Subtotal: subtotal(l),
    }))
  );

  const resumenRows = [{
    Negocio: negocio,
    "Período": `${desde} a ${hasta}`,
    Generado: generado.toLocaleString("es-CL", { timeZone: zona }),
    "Ventas válidas (N°)": nOk,
    "Unidades vendidas": unidades,
    "Total bruto": bruto,
    "Anuladas (N°)": nAnuladas,
    "Total anulado": montoAnulado,
    "Devoluciones (N°)": devoluciones.length,
    "Total devuelto": devuelto,
    "TOTAL NETO": neto,
    "Días con ventas": diasConVentas,
    "Promedio por venta": promedio,
  }];

  const libro = XLSX.utils.book_new();
  const hoja = (rows: Record<string, unknown>[], nombre: string, vacio: string, anchos: number[]) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Aviso: vacio }]);
    ws["!cols"] = (rows.length ? anchos : [40]).map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(libro, ws, nombre);
  };
  hoja(resumenRows, "Resumen", "-", [18, 24, 22, 18, 16, 14, 13, 14, 16, 14, 14, 15, 18]);
  hoja(porEmpRows, "Por emprendedor", "Sin ventas en el período", [28, 10, 14, ...(variosMeses ? meses.map(() => 12) : []), 26]);
  hoja(detalle, "Ventas (detalle)", "Sin ventas en el período", [9, 11, 11, 10, 9, 14, 12, 16, 34, 26, 38, 9, 12, 8, 12]);
  hoja(boletas, "Ventas (boletas)", "Sin ventas en el período", [11, 11, 10, 12, 14, 20, 13, 10, 12, 9, 24, 14]);
  hoja(porDiaRows, "Por día", "Sin ventas en el período", [11, 11, 10, 14, 12, 12]);
  hoja(porMedioRows, "Por medio de pago", "Sin ventas en el período", [16, 11, 14]);
  hoja(devolucionesRows, "Devoluciones", "Sin devoluciones en el período", [14, 13, 11, 10, 12, 14, 24, 16, 34, 26, 9, 12, 12]);

  return {
    libro,
    ventasValidas: nOk,
    unidades,
    bruto,
    anuladas: nAnuladas,
    montoAnulado,
    devoluciones: devoluciones.length,
    montoDevuelto: devuelto,
    neto,
    diasConVentas,
    promedio,
    porEmprendedor,
    porMedio: porMedioList,
    sinIdentificar: {
      lineas: lineasSinId,
      monto: montoSinId,
      descripciones: [...sinId.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([descripcion, monto]) => ({ descripcion, monto })),
    },
  };
}
