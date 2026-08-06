// Backfill de Producto.ingresadasTotal / egresadasTotal a partir del
// histórico. Desde el deploy, las propias escrituras de stock los mantienen
// con increment(); este script llena el valor de lo ocurrido ANTES.
//
// Fuentes (misma semántica que el POS):
//   - bitácora de cada emprendedor (emprendedores/{id}/movimientos):
//       producto_agregado  -> ingreso por el stock inicial del alta
//       stock_cambiado     -> delta > 0 ingreso; delta < 0 egreso
//   - colección entradas: ingreso por la cantidad recibida.
// Las VENTAS no cuentan como egreso: viven en vendidasTotal.
//
// Uso:
//   node --env-file=.env.local scripts/backfill-movimientos-producto.mjs [slug]
//   node --env-file=.env.local scripts/backfill-movimientos-producto.mjs [slug] --fix
//
// Idempotente: recalcula desde cero. Solo escribe productos con movimiento
// (escribir 0 en miles de docs forzaría una resincronización completa del
// catálogo en cada dispositivo).

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  collectionGroup,
  getDocs,
  query,
  where,
  orderBy,
  writeBatch,
  doc,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const args = process.argv.slice(2).filter((a) => a !== "--fix");
const FIX = process.argv.includes("--fix");
const SLUG = (args[0] || "patiocurauma").trim();

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

// Igual que parseDespuesAlta en repo.ts: "precio 1234 · stock 5".
function stockDeAlta(s) {
  const m = String(s || "").match(/stock\s+(-?\d+)/i);
  return m ? Number(m[1]) : 0;
}

const [prodSnap, movsSnap, entradasSnap] = await Promise.all([
  getDocs(collection(db, "negocios", SLUG, "productos")),
  // orderBy("en") replica la query de la app: reutiliza el índice compuesto
  // (negocioId asc, en desc) que ya existe, sin pedir uno nuevo.
  getDocs(
    query(
      collectionGroup(db, "movimientos"),
      where("negocioId", "==", SLUG),
      orderBy("en", "desc")
    )
  ),
  getDocs(collection(db, "negocios", SLUG, "entradas")),
]);

const ingresos = new Map();
const egresos = new Map();
const add = (mapa, cod, n) => mapa.set(cod, (mapa.get(cod) || 0) + n);

let nAltas = 0;
let nRepos = 0;
let nRetiros = 0;
for (const d of movsSnap.docs) {
  const m = d.data();
  if (!m.codigo) continue;
  if (m.accion === "producto_agregado") {
    const s = stockDeAlta(m.despues);
    if (s > 0) {
      add(ingresos, m.codigo, s);
      nAltas++;
    }
  } else if (m.accion === "stock_cambiado") {
    const delta = Number(m.despues ?? 0) - Number(m.antes ?? 0);
    if (delta > 0) {
      add(ingresos, m.codigo, delta);
      nRepos++;
    } else if (delta < 0) {
      add(egresos, m.codigo, -delta);
      nRetiros++;
    }
  }
}
for (const d of entradasSnap.docs) {
  const e = d.data();
  if (e.codigo && e.cantidad > 0) add(ingresos, e.codigo, e.cantidad);
}

const pendientes = [];
let sinCambio = 0;
for (const d of prodSnap.docs) {
  const p = d.data();
  const cod = p.codigo || d.id;
  const inN = ingresos.get(d.id) ?? ingresos.get(cod) ?? 0;
  const outN = egresos.get(d.id) ?? egresos.get(cod) ?? 0;
  const igual = (p.ingresadasTotal ?? 0) === inN && (p.egresadasTotal ?? 0) === outN;
  const nuncaTuvo =
    inN === 0 && outN === 0 && p.ingresadasTotal === undefined && p.egresadasTotal === undefined;
  if (igual || nuncaTuvo) {
    sinCambio++;
    continue;
  }
  pendientes.push({
    ref: doc(db, "negocios", SLUG, "productos", d.id),
    id: d.id,
    in: inN,
    out: outN,
  });
}

console.log(`negocios/${SLUG}: ${prodSnap.size} productos, ${movsSnap.size} movimientos de bitácora, ${entradasSnap.size} entradas.`);
console.log(`Bitácora: ${nAltas} altas, ${nRepos} reposiciones, ${nRetiros} retiros.`);
console.log(`Productos a actualizar: ${pendientes.length} · ya correctos: ${sinCambio}`);

const top = [...pendientes].sort((a, b) => b.in - a.in).slice(0, 10);
if (top.length) {
  console.log(`\nTop ingresos:`);
  for (const t of top) {
    console.log(`  ${t.id.padEnd(14)} +${String(t.in).padStart(4)}  −${String(t.out).padStart(3)}`);
  }
}

if (!FIX) {
  console.log("\nDry-run. Corre con --fix para aplicar.");
  process.exit(0);
}

const CHUNK = 400;
const ahora = Date.now();
for (let i = 0; i < pendientes.length; i += CHUNK) {
  const batch = writeBatch(db);
  for (const p of pendientes.slice(i, i + CHUNK)) {
    batch.update(p.ref, {
      ingresadasTotal: p.in,
      egresadasTotal: p.out,
      actualizadoEn: ahora,
    });
  }
  await batch.commit();
  console.log(`  ${Math.min(i + CHUNK, pendientes.length)}/${pendientes.length}`);
}
console.log("\nBackfill completo.");
process.exit(0);
