// Corrige el logo de negocios/vidasana (que quedó con una ruta absoluta de
// Windows en vez de una ruta web). Ajusta también fondoLogin si trae basura.
//
// Uso: node --env-file=.env.local scripts/fix-logo-vidasana.mjs

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
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
await setDoc(
  doc(db, "negocios", "vidasana"),
  { logo: "/logos/vidasana.png", fondoLogin: "" },
  { merge: true }
);
console.log("Logo corregido: /logos/vidasana.png");
process.exit(0);
