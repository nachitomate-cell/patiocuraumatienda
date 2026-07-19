// Backfill para las optimizaciones de lecturas de /alta:
//
//  1) productos: estampa emprendedorId/emprendedorNombre en los docs que no
//     lo tienen, cruzando el prefijo del ID del doc (BEND-0001 → Bendita
//     India). Permite que productosDeEmprendedor use UNA query por campo en
//     vez de dos (campo + prefijo), que cobraba doble casi todo el catálogo.
//
//  2) ventas: estampa empKeys = [emprendedorId..., "PREF:XXXX"...] calculado
//     de las líneas. Permite que ventasDeEmprendedor consulte SOLO las
//     ventas del emprendedor (array-contains-any + índice compuesto) en vez
//     de leer las últimas 500 del negocio en cada visita a /alta. Las ventas
//     sin ninguna línea de catálogo quedan con empKeys: [] (marcadas como
//     procesadas; un array vacío nunca matchea).
//
// Uso:
//   node --env-file=.env.local scripts/backfill-links-lecturas.mjs [slug]
//   node --env-file=.env.local scripts/backfill-links-lecturas.mjs [slug] --fix
//
// Sin --fix solo reporta. Idempotente: los docs ya estampados se saltan.

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

const [empSnap, prodSnap, ventaSnap] = await Promise.all([
  getDocs(collection(db, "negocios", SLUG, "emprendedores")),
  getDocs(collection(db, "negocios", SLUG, "productos")),
  getDocs(collection(db, "negocios", SLUG, "ventas")),
]);

// prefijo → { id, nombre }
const porPrefijo = new Map();
for (const d of empSnap.docs) {
  const e = d.data();
  if (e.prefijo) porPrefijo.set(e.prefijo, { id: d.id, nombre: e.nombre || "" });
}

console.log(
  `negocios/${SLUG}: ${empSnap.size} emprendedores, ${prodSnap.size} productos, ${ventaSnap.size} ventas.\n`
);

// ===== 1) productos sin emprendedorId =====
const prodPend = [];
let prodSinDueno = 0;
for (const d of prodSnap.docs) {
  if (d.data().emprendedorId) continue;
  const seg = d.id.split("-")[0];
  const emp = porPrefijo.get(seg);
  if (!emp) {
    prodSinDueno++;
    continue; // prefijo que no corresponde a ningún emprendedor: se deja tal cual
  }
  prodPend.push({
    ref: doc(db, "negocios", SLUG, "productos", d.id),
    cambios: { emprendedorId: emp.id, emprendedorNombre: emp.nombre },
  });
}
console.log(
  `Productos sin emprendedorId con dueño identificable: ${prodPend.length}` +
    (prodSinDueno ? ` (además ${prodSinDueno} sin dueño identificable, se dejan)` : "")
);

// ===== 2) ventas sin empKeys =====
const ventaPend = [];
for (const d of ventaSnap.docs) {
  const v = d.data();
  if (Array.isArray(v.empKeys)) continue; // ya estampada (código nuevo)
  const keys = new Set();
  for (const l of v.items || []) {
    if (l.emprendedorId) keys.add(l.emprendedorId);
    if (!l.manual && l.codigo) {
      const m = String(l.codigo).match(/^([A-Z0-9]+)-/);
      if (m) keys.add(`PREF:${m[1]}`);
    }
  }
  ventaPend.push({
    ref: doc(db, "negocios", SLUG, "ventas", d.id),
    cambios: { empKeys: Array.from(keys) },
  });
}
console.log(`Ventas sin empKeys: ${ventaPend.length}`);

if (!FIX) {
  console.log("\nDry-run. Corre con --fix para aplicar.");
  process.exit(0);
}

async function aplicar(pendientes, etiqueta) {
  const CHUNK = 400;
  let hechos = 0;
  for (let i = 0; i < pendientes.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const p of pendientes.slice(i, i + CHUNK)) {
      batch.update(p.ref, p.cambios);
    }
    await batch.commit();
    hechos = Math.min(i + CHUNK, pendientes.length);
    console.log(`  ${etiqueta}: ${hechos}/${pendientes.length}`);
  }
}

await aplicar(prodPend, "productos");
await aplicar(ventaPend, "ventas");
console.log("\nBackfill completo.");
process.exit(0);
