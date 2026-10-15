// Reporte de ventas de un período (el Excel para liquidar a cada emprendedor).
// Usa EXACTAMENTE la misma función que el botón "Reporte de ventas" de
// Administración: src/lib/reporteVentas.ts (Node 24 importa el .ts quitando tipos).
//
// Uso:
//   node --env-file=.env.local scripts/reporte-ventas-periodo.mjs [slug] <desde AAAA-MM-DD> <hasta AAAA-MM-DD> [carpetaSalida]
//   ej: node --env-file=.env.local scripts/reporte-ventas-periodo.mjs patiocurauma 2026-10-05 2026-10-11 "C:/Users/.../Downloads"
//
// El rango se calcula en hora de Chile (America/Santiago) explícita, sin
// depender del TZ del proceso. Solo lectura sobre Firestore.

import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import * as XLSX from "xlsx";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  armarReporteVentas,
  describirRango,
  nombreArchivoReporte,
  rangoEnZona,
  ZONA_CHILE,
} from "../src/lib/reporteVentas.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const args = process.argv.slice(2);
// El slug es opcional: si el primer argumento ya es una fecha, se asume patiocurauma.
const SLUG = (args[0] && !ISO.test(args[0]) ? args.shift() : "patiocurauma").trim();
const DESDE = (args[0] || "").trim();
const HASTA = (args[1] || "").trim();
const SALIDA = (args[2] || ".").trim();

const fechaValida = (s) => ISO.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
if (!fechaValida(DESDE) || !fechaValida(HASTA) || DESDE > HASTA) {
  console.error("Uso: reporte-ventas-periodo.mjs [slug] <desde AAAA-MM-DD> <hasta AAAA-MM-DD> [carpetaSalida]");
  process.exit(1);
}
const { desde, hasta } = rangoEnZona(DESDE, HASTA, ZONA_CHILE);

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
const [negSnap, ventasSnap, devsSnap, empSnap] = await Promise.all([
  getDoc(doc(db, "negocios", SLUG)),
  getDocs(query(col("ventas"), where("creadoEn", ">=", desde), where("creadoEn", "<=", hasta), orderBy("creadoEn", "asc"))),
  getDocs(query(col("devoluciones"), where("creadoEn", ">=", desde), where("creadoEn", "<=", hasta), orderBy("creadoEn", "asc"))),
  getDocs(col("emprendedores")),
]);
const nombreNegocio = (negSnap.exists() && negSnap.data().nombre) || SLUG;

const r = armarReporteVentas({
  negocio: nombreNegocio,
  desde: DESDE,
  hasta: HASTA,
  ventas: ventasSnap.docs.map((d) => d.data()),
  devoluciones: devsSnap.docs.map((d) => d.data()),
  emprendedores: empSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  zonaHoraria: ZONA_CHILE,
});

mkdirSync(SALIDA, { recursive: true });
const archivo = join(SALIDA, nombreArchivoReporte(nombreNegocio, DESDE, HASTA));
XLSX.writeFile(r.libro, archivo);

const $ = (n) => "$" + Math.round(n).toLocaleString("es-CL");
console.log(`Ventas ${nombreNegocio} (negocios/${SLUG}) ${describirRango(DESDE, HASTA)} de ${HASTA.slice(0, 4)}`);
console.log(`  Ventas válidas: ${r.ventasValidas} (${r.unidades} unidades) — bruto ${$(r.bruto)}`);
console.log(`  Anuladas: ${r.anuladas} (${$(r.montoAnulado)})`);
console.log(`  Devoluciones: ${r.devoluciones} (${$(r.montoDevuelto)})`);
console.log(`  NETO: ${$(r.neto)}`);
console.log(`  Días con ventas: ${r.diasConVentas} · promedio por venta ${$(r.promedio)}`);
console.log(`\n  Por medio de pago:`);
for (const m of r.porMedio) console.log(`    ${m.medio.padEnd(14)} ${String(m.ventas).padStart(3)} ventas  ${$(m.total)}`);
console.log(`\n  Top emprendedores:`);
for (const e of r.porEmprendedor.slice(0, 10)) {
  const manual = e.desdeManual ? `  (de eso ${$(e.desdeManual)} desde ventas manuales)` : "";
  console.log(`    ${e.emprendedor.padEnd(26)} ${String(e.unidades).padStart(4)} u.  ${$(e.total)}${manual}`);
}
console.log(`\n  Sin identificar: ${r.sinIdentificar.lineas} líneas por ${$(r.sinIdentificar.monto)}`);
for (const s of r.sinIdentificar.descripciones.slice(0, 20)) console.log(`    ${$(s.monto).padStart(10)}  ${s.descripcion}`);
console.log(`\nArchivo: ${archivo}`);
process.exit(0);
