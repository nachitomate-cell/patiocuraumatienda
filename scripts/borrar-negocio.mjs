// Borra completamente un tenant: negocios/<slug> y todas sus subcolecciones.
// DESTRUCTIVO. No hay undo. Úsalo solo para limpiar slugs huérfanos.
//
// Uso:
//   node --env-file=.env.local scripts/borrar-negocio.mjs <slug> --confirmo
//
// El flag --confirmo es obligatorio: evita borrar por accidente al tipear mal.

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const SLUG = (process.argv[2] || "").trim();
const CONFIRMA = process.argv[3] === "--confirmo";

if (!SLUG || !CONFIRMA) {
  console.error(
    "Uso: node --env-file=.env.local scripts/borrar-negocio.mjs <slug> --confirmo"
  );
  process.exit(1);
}

const COLECCIONES_PLANAS = [
  "productos",
  "ventas",
  "entradas",
  "contadores",
  "config",
  "devoluciones",
  "cajas",
];

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

async function borrarDocs(refs) {
  const CHUNK = 400;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const r of refs.slice(i, i + CHUNK)) batch.delete(r);
    await batch.commit();
  }
}

async function borrarColeccionPlana(nombre) {
  const snap = await getDocs(collection(db, "negocios", SLUG, nombre));
  await borrarDocs(snap.docs.map((d) => d.ref));
  console.log(`  ${nombre}: ${snap.docs.length}`);
}

async function borrarConSub(nombre, sub) {
  const padres = await getDocs(collection(db, "negocios", SLUG, nombre));
  let totalSub = 0;
  for (const p of padres.docs) {
    const ss = await getDocs(
      collection(db, "negocios", SLUG, nombre, p.id, sub)
    );
    if (ss.docs.length) {
      await borrarDocs(ss.docs.map((d) => d.ref));
      totalSub += ss.docs.length;
    }
  }
  await borrarDocs(padres.docs.map((d) => d.ref));
  console.log(`  ${nombre}: ${padres.docs.length} (${totalSub} ${sub})`);
}

async function main() {
  console.log(`Borrando negocios/${SLUG}...`);
  await signInAnonymously(getAuth(app));

  for (const col of COLECCIONES_PLANAS) {
    await borrarColeccionPlana(col);
  }
  await borrarConSub("emprendedores", "movimientos");
  await borrarConSub("clientes", "movimientos");

  await deleteDoc(doc(db, "negocios", SLUG));
  console.log(`  doc negocio: borrado`);

  console.log("");
  console.log(`Listo. negocios/${SLUG} ya no existe.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error al borrar:", e);
  process.exit(1);
});
