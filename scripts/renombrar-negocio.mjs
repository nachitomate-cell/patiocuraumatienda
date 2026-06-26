// Copia todo el contenido de negocios/<origen>/... a negocios/<destino>/...
// NO borra el origen (hazlo a mano desde la consola de Firebase tras verificar).
// Es idempotente: cada doc se sobrescribe por id, así que se puede re-correr.
//
// Uso:
//   node --env-file=.env.local scripts/renombrar-negocio.mjs vidasana visana
//
// Cubre:
//   negocios/<slug>                (el doc principal del negocio)
//   negocios/<slug>/{productos,ventas,entradas,contadores,config,devoluciones}
//   negocios/<slug>/emprendedores  + subcol movimientos
//   negocios/<slug>/clientes       + subcol movimientos
//   negocios/<slug>/cajas          (si existe)

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  writeBatch,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const ORIGEN = (process.argv[2] || "").trim();
const DESTINO = (process.argv[3] || "").trim();

if (!ORIGEN || !DESTINO) {
  console.error(
    "Uso: node --env-file=.env.local scripts/renombrar-negocio.mjs <origen> <destino>"
  );
  process.exit(1);
}
if (ORIGEN === DESTINO) {
  console.error("Origen y destino son el mismo slug; nada que hacer.");
  process.exit(1);
}

// Colecciones planas (sin subcolecciones que nos importen).
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
  console.error(
    "Falta la config de Firebase. Corre con: node --env-file=.env.local scripts/renombrar-negocio.mjs <origen> <destino>"
  );
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function copiarDocs(destinoSegs, docs) {
  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + CHUNK)) {
      batch.set(doc(db, ...destinoSegs, d.id), d.data());
    }
    await batch.commit();
  }
}

async function copiarColeccionPlana(nombre) {
  const snap = await getDocs(collection(db, "negocios", ORIGEN, nombre));
  await copiarDocs(["negocios", DESTINO, nombre], snap.docs);
  console.log(`  ${nombre}: ${snap.docs.length}`);
}

async function copiarColeccionConSub(nombre, subcoleccion) {
  const padres = await getDocs(collection(db, "negocios", ORIGEN, nombre));
  await copiarDocs(["negocios", DESTINO, nombre], padres.docs);
  let total = 0;
  for (const p of padres.docs) {
    const sub = await getDocs(
      collection(db, "negocios", ORIGEN, nombre, p.id, subcoleccion)
    );
    if (sub.docs.length) {
      await copiarDocs(
        ["negocios", DESTINO, nombre, p.id, subcoleccion],
        sub.docs
      );
      total += sub.docs.length;
    }
  }
  console.log(`  ${nombre}: ${padres.docs.length} (${total} ${subcoleccion})`);
}

async function main() {
  console.log(`Copiando negocios/${ORIGEN} -> negocios/${DESTINO}`);
  await signInAnonymously(getAuth(app));

  // Doc principal del negocio (branding, config legal, etc.). Mantenemos los
  // campos originales pero forzamos slug = destino.
  const negSnap = await getDoc(doc(db, "negocios", ORIGEN));
  const negData = negSnap.exists() ? negSnap.data() : {};
  await writeBatch(db)
    .set(
      doc(db, "negocios", DESTINO),
      { ...negData, slug: DESTINO, renombradoDe: ORIGEN, renombradoEn: Date.now() },
      { merge: true }
    )
    .commit();
  console.log(`  doc negocio: ${negSnap.exists() ? "copiado" : "no existía (creado vacío)"}`);

  for (const col of COLECCIONES_PLANAS) {
    await copiarColeccionPlana(col);
  }
  await copiarColeccionConSub("emprendedores", "movimientos");
  await copiarColeccionConSub("clientes", "movimientos");

  console.log("");
  console.log(`Listo. Verifica negocios/${DESTINO} en Firebase Console.`);
  console.log(
    `Cuando confirmes que todo está OK, borra negocios/${ORIGEN} a mano desde la consola.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("Error en la copia:", e);
  process.exit(1);
});
