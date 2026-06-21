// Migración multi-tenant: COPIA las colecciones de la raíz a la subcolección
// del negocio negocios/<slug>/... No borra ni modifica la data original, así
// que es seguro correrla con producción en vivo: el POS actual sigue leyendo
// la raíz hasta que se despliegue el código tenant-aware.
//
// Uso (Node 20+):
//   node --env-file=.env.local scripts/migrar-a-negocio.mjs patio
//
// El argumento es el slug del negocio (= subdominio). Si se omite, usa "patio".
//
// Vuelve a correrla cuantas veces quieras: usa setDoc por id, así que es
// idempotente (re-copiar sobrescribe con lo mismo).

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  writeBatch,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const SLUG = (process.argv[2] || "patio").trim();

// Colecciones de primer nivel a copiar. "clientes" se trata aparte porque
// tiene la subcolección "movimientos".
const COLECCIONES = [
  "productos",
  "ventas",
  "entradas",
  "emprendedores",
  "contadores",
  "config",
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
    "Falta la configuración de Firebase. Corre con: node --env-file=.env.local scripts/migrar-a-negocio.mjs <slug>"
  );
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Escribe documentos en lotes (máx 500 ops por batch en Firestore).
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

async function main() {
  console.log(`Negocio destino: negocios/${SLUG}`);
  await signInAnonymously(getAuth(app));

  // Marca el documento del negocio (lo usará el panel moderador y el branding).
  await writeBatch(db)
    .set(doc(db, "negocios", SLUG), { slug: SLUG, migradoEn: Date.now() }, { merge: true })
    .commit();

  for (const col of COLECCIONES) {
    const snap = await getDocs(collection(db, col));
    await copiarDocs(["negocios", SLUG, col], snap.docs);
    console.log(`  ${col}: ${snap.docs.length} documentos copiados`);
  }

  // Clientes + subcolección de movimientos de cada cliente.
  const clientes = await getDocs(collection(db, "clientes"));
  await copiarDocs(["negocios", SLUG, "clientes"], clientes.docs);
  let movs = 0;
  for (const c of clientes.docs) {
    const sub = await getDocs(collection(db, "clientes", c.id, "movimientos"));
    if (sub.docs.length) {
      await copiarDocs(["negocios", SLUG, "clientes", c.id, "movimientos"], sub.docs);
      movs += sub.docs.length;
    }
  }
  console.log(`  clientes: ${clientes.docs.length} documentos (${movs} movimientos)`);

  console.log("Listo. Verifica en la consola de Firebase que existe negocios/" + SLUG);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error en la migración:", e);
  process.exit(1);
});
