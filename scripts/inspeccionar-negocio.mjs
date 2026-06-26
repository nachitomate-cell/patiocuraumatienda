// Imprime todos los campos del doc negocios/<slug>.
// Uso: node --env-file=.env.local scripts/inspeccionar-negocio.mjs <slug>

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const SLUG = (process.argv[2] || "").trim();
if (!SLUG) {
  console.error("Uso: node ... scripts/inspeccionar-negocio.mjs <slug>");
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

await signInAnonymously(getAuth(app));
const snap = await getDoc(doc(db, "negocios", SLUG));
if (!snap.exists()) {
  console.log(`negocios/${SLUG} NO existe`);
  process.exit(0);
}
console.log(`negocios/${SLUG}:`);
console.log(JSON.stringify(snap.data(), null, 2));
process.exit(0);
