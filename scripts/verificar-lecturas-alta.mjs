// Verifica las queries optimizadas de /alta contra datos reales:
//   1) productos por emprendedorId (query única)
//   2) ventas por empKeys array-contains-any + orderBy creadoEn (necesita el
//      índice compuesto; si está construyéndose, tira failed-precondition)
// Uso: node --env-file=.env.local scripts/verificar-lecturas-alta.mjs [slug] [prefijo]

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const SLUG = (process.argv[2] || "patiocurauma").trim();
const PREF = (process.argv[3] || "BEND").trim();

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const empSnap = await getDocs(collection(db, "negocios", SLUG, "emprendedores"));
const emp = empSnap.docs.find((d) => d.data().prefijo === PREF);
if (!emp) {
  console.error(`No hay emprendedor con prefijo ${PREF}`);
  process.exit(1);
}
console.log(`Emprendedor: ${emp.data().nombre} (${PREF}, id ${emp.id})`);

const prods = await getDocs(
  query(
    collection(db, "negocios", SLUG, "productos"),
    where("emprendedorId", "==", emp.id)
  )
);
console.log(`Productos por emprendedorId: ${prods.size} docs (1 query única)`);

try {
  const ventas = await getDocs(
    query(
      collection(db, "negocios", SLUG, "ventas"),
      where("empKeys", "array-contains-any", [emp.id, `PREF:${PREF}`]),
      orderBy("creadoEn", "desc"),
      limit(300)
    )
  );
  console.log(
    `Ventas por empKeys: ${ventas.size} docs — ÍNDICE OK (antes: hasta 500 lecturas por visita)`
  );
} catch (e) {
  console.log(`Ventas por empKeys FALLÓ: ${e.message}`);
}
process.exit(0);
