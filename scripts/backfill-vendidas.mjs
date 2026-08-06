// Backfill de Producto.vendidasTotal (unidades vendidas acumuladas) a partir
// del histórico de ventas y devoluciones. Desde el deploy, confirmarVenta lo
// mantiene con increment() en el mismo batch que el stock; este script llena
// el valor de los productos vendidos ANTES de ese cambio.
//
// Reglas (idénticas a las del POS):
//   - Ventas anuladas NO cuentan.
//   - Líneas manuales (sin producto en catálogo) se ignoran.
//   - Las devoluciones restan unidades.
//
// Uso:
//   node --env-file=.env.local scripts/backfill-vendidas.mjs [slug]
//   node --env-file=.env.local scripts/backfill-vendidas.mjs [slug] --fix
//
// Sin --fix solo reporta. Es idempotente: recalcula el total desde cero, así
// que puede correrse otra vez sin duplicar.

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
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

const [prodSnap, ventasSnap, devsSnap] = await Promise.all([
  getDocs(collection(db, "negocios", SLUG, "productos")),
  getDocs(collection(db, "negocios", SLUG, "ventas")),
  getDocs(collection(db, "negocios", SLUG, "devoluciones")),
]);

const vendidas = new Map(); // codigo -> unidades
let lineasManuales = 0;
let ventasAnuladas = 0;
for (const d of ventasSnap.docs) {
  const v = d.data();
  if (v.anulada) {
    ventasAnuladas++;
    continue;
  }
  for (const l of v.items || []) {
    if (l.manual || !l.codigo) {
      lineasManuales++;
      continue;
    }
    vendidas.set(l.codigo, (vendidas.get(l.codigo) || 0) + (l.cantidad || 0));
  }
}
for (const d of devsSnap.docs) {
  for (const l of d.data().items || []) {
    if (l.manual || !l.codigo) continue;
    vendidas.set(l.codigo, (vendidas.get(l.codigo) || 0) - (l.cantidad || 0));
  }
}

const pendientes = [];
let sinCambio = 0;
let sinProducto = 0;
const codigosProducto = new Set(prodSnap.docs.map((d) => d.id));
for (const d of prodSnap.docs) {
  const p = d.data();
  // Math.max(0): una devolución de una venta previa al histórico cargado
  // podría dejar el neto negativo; el acumulado nunca debe ser < 0.
  const total = Math.max(0, vendidas.get(d.id) ?? vendidas.get(p.codigo) ?? 0);
  if (p.vendidasTotal === total) {
    sinCambio++;
    continue;
  }
  // No se escribe un 0 en productos que nunca se vendieron: serían miles de
  // escrituras inútiles y, al mover actualizadoEn, forzarían a cada
  // dispositivo a resincronizar el catálogo completo. Ausente = 0 en la UI.
  // Sí se corrige a 0 un valor guardado que quedó obsoleto (venta anulada).
  if (total === 0 && p.vendidasTotal === undefined) {
    sinCambio++;
    continue;
  }
  pendientes.push({
    ref: doc(db, "negocios", SLUG, "productos", d.id),
    id: d.id,
    de: p.vendidasTotal,
    a: total,
  });
}
for (const cod of vendidas.keys()) {
  if (!codigosProducto.has(cod)) sinProducto++;
}

const conVentas = pendientes.filter((p) => p.a > 0);
console.log(`negocios/${SLUG}: ${prodSnap.size} productos, ${ventasSnap.size} ventas (${ventasAnuladas} anuladas), ${devsSnap.size} devoluciones.`);
console.log(`Líneas manuales ignoradas: ${lineasManuales}`);
console.log(`Códigos vendidos que ya no existen en el catálogo: ${sinProducto}`);
console.log(`Productos a actualizar: ${pendientes.length} (${conVentas.length} con ventas, ${pendientes.length - conVentas.length} en 0)`);
console.log(`Ya correctos: ${sinCambio}`);

const top = [...conVentas].sort((a, b) => b.a - a.a).slice(0, 10);
if (top.length) {
  console.log(`\nTop vendidos:`);
  for (const t of top) console.log(`  ${t.id.padEnd(14)} ${String(t.a).padStart(4)} u.`);
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
    // actualizadoEn: que los caches delta del POS traigan el nuevo valor.
    batch.update(p.ref, { vendidasTotal: p.a, actualizadoEn: ahora });
  }
  await batch.commit();
  console.log(`  ${Math.min(i + CHUNK, pendientes.length)}/${pendientes.length}`);
}
console.log("\nBackfill completo.");
process.exit(0);
