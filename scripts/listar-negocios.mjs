// Lista todos los docs de la colección `negocios` con su id y campos clave.
// Sirve para diagnosticar slugs huérfanos o docs con id != slug.
//
// Uso: node --env-file=.env.local scripts/listar-negocios.mjs

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

await signInAnonymously(getAuth(app));
const snap = await getDocs(collection(db, "negocios"));
console.log(`Total docs en negocios/: ${snap.docs.length}`);
for (const d of snap.docs) {
  const data = d.data();
  console.log(`  id="${d.id}"  slug="${data.slug || ""}"  nombre="${data.nombre || ""}"`);
}
process.exit(0);
