// Resetea las transacciones y el dinero de un tenant para "empezar de cero".
// DESTRUCTIVO. No hay undo. Pensado para limpiar la data de pruebas / arranque.
//
// Uso:
//   node --env-file=.env.local scripts/reset-transacciones.mjs <slug> --confirmo
//
// Slug por defecto: patiocurauma.
//
// Qué hace:
//   BORRA todos los docs de:
//     - ventas/
//     - entradas/
//     - devoluciones/
//     - cajas/
//   RESETEA los correlativos en contadores/ a { ultimo: 0 }:
//     - contadores/ventas
//     - contadores/entradas
//     - contadores/devoluciones
//   ACTUALIZA productos/ → stockActual = 0 (conserva precios, costos, etc.)
//   ACTUALIZA clientes/ → saldo = 0 y borra subcolección movimientos/
//
// Qué NO toca:
//   - productos (los registros se quedan, sólo se zerea stockActual)
//   - clientes (los registros se quedan, sólo se zerea saldo)
//   - emprendedores/ (ni los emprendedores ni su movimientos/)
//   - config/ (boleta, branding, etc.)
//   - el doc del propio negocio (negocios/{slug})

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const SLUG = (process.argv[2] || "patiocurauma").trim();
const CONFIRMA = process.argv.includes("--confirmo");

if (!SLUG || !CONFIRMA) {
  console.error(
    "Uso: node --env-file=.env.local scripts/reset-transacciones.mjs <slug> --confirmo"
  );
  process.exit(1);
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId) {
  console.error("Falta la config de Firebase (.env.local).");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const CHUNK = 400;

// Aplica una lista de mutaciones (delete/set/update) en batches de CHUNK.
async function aplicarBatches(ops) {
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + CHUNK)) op(batch);
    await batch.commit();
  }
}

async function borrarColeccion(nombre) {
  const snap = await getDocs(collection(db, "negocios", SLUG, nombre));
  await aplicarBatches(snap.docs.map((d) => (b) => b.delete(d.ref)));
  console.log(`  ${nombre}: ${snap.docs.length} borrados`);
  return snap.docs.length;
}

async function resetearStockProductos() {
  const snap = await getDocs(collection(db, "negocios", SLUG, "productos"));
  await aplicarBatches(
    snap.docs.map((d) => (b) => b.update(d.ref, { stockActual: 0 }))
  );
  console.log(`  productos: ${snap.docs.length} con stockActual=0`);
  return snap.docs.length;
}

async function resetearClientes() {
  const snap = await getDocs(collection(db, "negocios", SLUG, "clientes"));
  let totalMov = 0;
  for (const cli of snap.docs) {
    const movsSnap = await getDocs(
      collection(db, "negocios", SLUG, "clientes", cli.id, "movimientos")
    );
    if (movsSnap.docs.length) {
      await aplicarBatches(movsSnap.docs.map((m) => (b) => b.delete(m.ref)));
      totalMov += movsSnap.docs.length;
    }
  }
  await aplicarBatches(snap.docs.map((d) => (b) => b.update(d.ref, { saldo: 0 })));
  console.log(
    `  clientes: ${snap.docs.length} con saldo=0 (${totalMov} movimientos borrados)`
  );
  return { clientes: snap.docs.length, movs: totalMov };
}

async function resetearContadores() {
  const nombres = ["ventas", "entradas", "devoluciones"];
  for (const n of nombres) {
    await setDoc(
      doc(db, "negocios", SLUG, "contadores", n),
      { ultimo: 0 },
      { merge: true }
    );
  }
  console.log(`  contadores: ${nombres.join(", ")} → ultimo=0`);
}

async function main() {
  console.log(`Reseteando transacciones de negocios/${SLUG}...`);
  console.log("");
  await signInAnonymously(getAuth(app));

  await borrarColeccion("ventas");
  await borrarColeccion("entradas");
  await borrarColeccion("devoluciones");
  await borrarColeccion("cajas");

  await resetearContadores();
  await resetearStockProductos();
  await resetearClientes();

  console.log("");
  console.log(`Listo. negocios/${SLUG} arranca desde cero.`);
  console.log(
    "Lo conservado: productos (stock=0), clientes (saldo=0), emprendedores, config."
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("Error en el reset:", e);
  process.exit(1);
});
