// Reporte mensual de TODAS las transacciones del negocio: ventas (por boleta
// y por línea), devoluciones, cajas (retiros e ingresos de efectivo) y
// resúmenes por día, medio de pago y emprendedor. Genera un .xlsx.
//
// Uso:
//   node --env-file=.env.local scripts/reporte-transacciones.mjs [slug] [YYYY-MM] [carpetaSalida]
//   defaults: patiocurauma, mes actual, carpeta actual.
//
// Solo lectura sobre Firestore.

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import * as XLSX from "xlsx";
import { join } from "node:path";

const SLUG = (process.argv[2] || "patiocurauma").trim();
const MES = (process.argv[3] || "").trim(); // YYYY-MM
const SALIDA = (process.argv[4] || ".").trim();

const hoy = new Date();
const [anio, mes] = MES
  ? MES.split("-").map(Number)
  : [hoy.getFullYear(), hoy.getMonth() + 1];
if (!anio || !mes || mes < 1 || mes > 12) {
  console.error("Mes inválido. Formato: YYYY-MM (ej: 2026-07)");
  process.exit(1);
}
// Rango del mes en hora local del equipo.
const desde = new Date(anio, mes - 1, 1).getTime();
const hasta = new Date(anio, mes, 1).getTime() - 1;
const etiquetaMes = `${anio}-${String(mes).padStart(2, "0")}`;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
if (!firebaseConfig.projectId) {
  console.error("Falta la configuración de Firebase (.env.local).");
  process.exit(1);
}
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const col = (...s) => collection(db, "negocios", SLUG, ...s);
const subtotal = (l) => l.cantidad * l.precio * (1 - (l.descuento || 0) / 100);
const hora = (ms) =>
  new Date(ms).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
const fecha = (ms) => new Date(ms).toLocaleDateString("es-CL");

const [ventasSnap, devsSnap, cajasSnap, empSnap] = await Promise.all([
  getDocs(query(col("ventas"), where("creadoEn", ">=", desde), where("creadoEn", "<=", hasta), orderBy("creadoEn", "asc"))),
  getDocs(query(col("devoluciones"), where("creadoEn", ">=", desde), where("creadoEn", "<=", hasta), orderBy("creadoEn", "asc"))),
  getDocs(query(col("cajas"), where("aperturaEn", ">=", desde), where("aperturaEn", "<=", hasta), orderBy("aperturaEn", "asc"))),
  getDocs(col("emprendedores")),
]);

const ventas = ventasSnap.docs.map((d) => d.data());
const devs = devsSnap.docs.map((d) => d.data());
const cajas = cajasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

// Mapas de emprendedor: por id y por prefijo (para líneas legacy sin id).
const empPorId = new Map();
const empPorPrefijo = new Map();
for (const d of empSnap.docs) {
  const e = d.data();
  empPorId.set(d.id, e.nombre || d.id);
  if (e.prefijo) empPorPrefijo.set(e.prefijo, e.nombre || e.prefijo);
}
const nombreEmp = (l) => {
  if (l.emprendedorId && empPorId.has(l.emprendedorId)) return empPorId.get(l.emprendedorId);
  if (l.emprendedorNombre) return l.emprendedorNombre;
  const m = String(l.codigo || "").match(/^([A-Z0-9]+)-/);
  if (m && empPorPrefijo.has(m[1])) return empPorPrefijo.get(m[1]);
  return l.manual ? "(venta manual)" : "(sin emprendedor)";
};

// ===== Hojas =====
const boletasRows = ventas.map((v) => ({
  "Nro venta": v.nro,
  Fecha: v.fecha,
  Hora: hora(v.creadoEn),
  Vendedor: v.vendedor ?? "",
  "Medio de pago": v.medioPago ?? "",
  Cliente: v.medioPago === "fiado" ? (v.clienteNombre ?? "") : "",
  "Items (líneas)": (v.items || []).length,
  Unidades: (v.items || []).reduce((s, l) => s + l.cantidad, 0),
  Total: (v.items || []).reduce((s, l) => s + subtotal(l), 0),
  Anulada: v.anulada ? "SÍ" : "",
  "Motivo anulación": v.anulada?.motivo ?? "",
  "Código boleta": v.codigoBoleta ?? "",
}));

const lineasRows = ventas.flatMap((v) =>
  (v.items || []).map((l) => ({
    "Nro venta": v.nro,
    Fecha: v.fecha,
    Hora: hora(v.creadoEn),
    Anulada: v.anulada ? "SÍ" : "",
    "Medio de pago": v.medioPago ?? "",
    Vendedor: v.vendedor ?? "",
    Codigo: l.codigo ?? "(manual)",
    Descripcion: l.descripcion ?? "",
    Emprendedor: nombreEmp(l),
    Cantidad: l.cantidad,
    "Valor unidad": l.precio,
    "Dscto%": l.descuento || 0,
    Subtotal: subtotal(l),
  }))
);

const devolucionesRows = devs.flatMap((d) =>
  (d.items || []).map((l) => ({
    "Nro devolución": d.nro,
    "Venta original": d.ventaNro,
    Fecha: d.fecha,
    Hora: hora(d.creadoEn),
    Vendedor: d.vendedor ?? "",
    "Medio original": d.medioPagoOriginal ?? "",
    Motivo: d.motivo ?? "",
    Codigo: l.codigo ?? "(manual)",
    Descripcion: l.descripcion ?? "",
    Emprendedor: nombreEmp(l),
    Cantidad: l.cantidad,
    "Valor unidad": l.precio,
    Subtotal: subtotal(l),
  }))
);

const cajasRows = cajas.map((c) => ({
  Caja: c.id,
  Apertura: `${fecha(c.aperturaEn)} ${hora(c.aperturaEn)}`,
  "Abierta por": c.abridoPor ?? "",
  Cierre: c.cerradaEn ? `${fecha(c.cerradaEn)} ${hora(c.cerradaEn)}` : "(abierta)",
  "Cerrada por": c.cerradoPor ?? "",
  "Fondo inicial": c.fondoInicial ?? 0,
  "Retiros (N°)": (c.retiros || []).length,
  "Retiros ($)": (c.retiros || []).reduce((s, r) => s + (r.monto || 0), 0),
  "Ingresos extra (N°)": (c.ingresos || []).length,
  "Ingresos extra ($)": (c.ingresos || []).reduce((s, r) => s + (r.monto || 0), 0),
  "Devol. efectivo ($)": (c.devoluciones || []).reduce((s, r) => s + (r.monto || 0), 0),
  "Efectivo contado": c.cierreContado ?? "",
  "Diferencia": c.diferencia ?? "",
  Notas: c.notas ?? "",
}));

const movCajaRows = cajas.flatMap((c) => [
  ...(c.retiros || []).map((r) => ({
    Caja: c.id, Tipo: "RETIRO", Fecha: fecha(r.hora), Hora: hora(r.hora),
    Monto: -(r.monto || 0), Motivo: r.motivo ?? "", Vendedor: r.vendedor ?? "",
  })),
  ...(c.ingresos || []).map((r) => ({
    Caja: c.id, Tipo: "INGRESO", Fecha: fecha(r.hora), Hora: hora(r.hora),
    Monto: r.monto || 0, Motivo: r.motivo ?? "", Vendedor: r.vendedor ?? "",
  })),
  ...(c.devoluciones || []).map((r) => ({
    Caja: c.id, Tipo: "DEVOLUCIÓN EFECTIVO", Fecha: fecha(r.hora), Hora: hora(r.hora),
    Monto: -(r.monto || 0), Motivo: `${r.nro} (venta ${r.ventaNro}) ${r.motivo || ""}`.trim(),
    Vendedor: r.vendedor ?? "",
  })),
]).sort((a, b) => `${a.Fecha} ${a.Hora}`.localeCompare(`${b.Fecha} ${b.Hora}`));

// ===== Agregados =====
let bruto = 0, unidades = 0, nOk = 0, nAnuladas = 0, montoAnulado = 0;
const porDia = new Map();
const porMedio = new Map();
const porEmp = new Map();
for (const v of ventas) {
  const tot = (v.items || []).reduce((s, l) => s + subtotal(l), 0);
  if (v.anulada) {
    nAnuladas++;
    montoAnulado += tot;
    continue;
  }
  nOk++;
  bruto += tot;
  const dia = v.fecha || fecha(v.creadoEn);
  const d = porDia.get(dia) || { n: 0, unidades: 0, total: 0, devuelto: 0 };
  d.n++; d.total += tot;
  for (const l of v.items || []) {
    unidades += l.cantidad;
    d.unidades += l.cantidad;
    const e = nombreEmp(l);
    const pe = porEmp.get(e) || { unidades: 0, total: 0 };
    pe.unidades += l.cantidad;
    pe.total += subtotal(l);
    porEmp.set(e, pe);
  }
  porDia.set(dia, d);
  const medio = v.medioPago || "(sin medio)";
  const pm = porMedio.get(medio) || { n: 0, total: 0 };
  pm.n++; pm.total += tot;
  porMedio.set(medio, pm);
}
let devuelto = 0;
for (const d of devs) {
  const tot = (d.items || []).reduce((s, l) => s + subtotal(l), 0);
  devuelto += tot;
  const dia = d.fecha || fecha(d.creadoEn);
  const pd = porDia.get(dia) || { n: 0, unidades: 0, total: 0, devuelto: 0 };
  pd.devuelto += tot;
  porDia.set(dia, pd);
}
const neto = bruto - devuelto;

const porDiaRows = [...porDia.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([dia, d]) => ({
    Fecha: dia, "Ventas (N°)": d.n, Unidades: d.unidades,
    "Total vendido": d.total, "Devuelto": d.devuelto, "Neto": d.total - d.devuelto,
  }));
const porMedioRows = [...porMedio.entries()]
  .sort((a, b) => b[1].total - a[1].total)
  .map(([medio, m]) => ({ "Medio de pago": medio, "Ventas (N°)": m.n, Total: m.total }));
const porEmpRows = [...porEmp.entries()]
  .sort((a, b) => b[1].total - a[1].total)
  .map(([nombre, e]) => ({ Emprendedor: nombre, Unidades: e.unidades, "Total vendido": e.total }));

const resumenRows = [{
  Negocio: SLUG,
  Mes: etiquetaMes,
  Generado: new Date().toLocaleString("es-CL"),
  "Ventas válidas (N°)": nOk,
  "Unidades vendidas": unidades,
  "Total bruto": bruto,
  "Anuladas (N°)": nAnuladas,
  "Total anulado": montoAnulado,
  "Devoluciones (N°)": devs.length,
  "Total devuelto": devuelto,
  "TOTAL NETO": neto,
  "Días con ventas": porDia.size,
  "Promedio por venta": nOk ? Math.round(bruto / nOk) : 0,
  "Cajas del mes": cajas.length,
  "Retiros de caja ($)": cajas.reduce((s, c) => s + (c.retiros || []).reduce((ss, r) => ss + (r.monto || 0), 0), 0),
}];

const wb = XLSX.utils.book_new();
const hoja = (rows, nombre, vacio) =>
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Aviso: vacio }]), nombre);
hoja(resumenRows, "Resumen", "-");
hoja(porDiaRows, "Por día", "Sin ventas en el mes");
hoja(boletasRows, "Ventas (boletas)", "Sin ventas en el mes");
hoja(lineasRows, "Ventas (detalle)", "Sin ventas en el mes");
hoja(porEmpRows, "Por emprendedor", "Sin ventas en el mes");
hoja(porMedioRows, "Por medio de pago", "Sin ventas en el mes");
hoja(devolucionesRows, "Devoluciones", "Sin devoluciones en el mes");
hoja(cajasRows, "Cajas", "Sin cajas en el mes");
hoja(movCajaRows, "Mov. de caja", "Sin retiros/ingresos en el mes");

const archivo = join(SALIDA, `reporte_transacciones_${SLUG}_${etiquetaMes}.xlsx`);
XLSX.writeFile(wb, archivo);

console.log(`Reporte ${etiquetaMes} — negocios/${SLUG}`);
console.log(`  Ventas válidas: ${nOk} (${unidades} unidades) — bruto $${Math.round(bruto).toLocaleString("es-CL")}`);
console.log(`  Anuladas: ${nAnuladas} ($${Math.round(montoAnulado).toLocaleString("es-CL")})`);
console.log(`  Devoluciones: ${devs.length} ($${Math.round(devuelto).toLocaleString("es-CL")})`);
console.log(`  NETO: $${Math.round(neto).toLocaleString("es-CL")}`);
console.log(`  Días con ventas: ${porDia.size} · Cajas: ${cajas.length}`);
console.log(`\n  Por medio de pago:`);
for (const r of porMedioRows) console.log(`    ${r["Medio de pago"].padEnd(14)} ${String(r["Ventas (N°)"]).padStart(3)} ventas  $${Math.round(r.Total).toLocaleString("es-CL")}`);
console.log(`\n  Top emprendedores:`);
for (const r of porEmpRows.slice(0, 10)) console.log(`    ${r.Emprendedor.padEnd(24)} ${String(r.Unidades).padStart(4)} u.  $${Math.round(r["Total vendido"]).toLocaleString("es-CL")}`);
console.log(`\nArchivo: ${archivo}`);
process.exit(0);
