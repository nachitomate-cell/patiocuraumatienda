// Crea el primer usuario MODERADOR (acceso global al panel /moderador).
// Resuelve el arranque: el panel crea usuarios, pero para entrar al panel hace
// falta un moderador. Esto lo crea una sola vez desde la terminal.
//
// Uso (Node 20+):
//   node --env-file=.env.local scripts/crear-moderador.mjs correo@synaptechspa.cl unaClave123
//
// Si el correo ya existe en Firebase Auth, solo le asigna el rol moderador.

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";

const email = (process.argv[2] || "").trim();
const password = process.argv[3] || "";

if (!email || password.length < 6) {
  console.error(
    "Uso: node --env-file=.env.local scripts/crear-moderador.mjs <correo> <clave(>=6)>"
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
  console.error("Falta la configuración de Firebase (.env.local).");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  let uid;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;
    console.log("Usuario creado en Auth.");
  } catch (e) {
    if (e.code === "auth/email-already-in-use") {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      uid = cred.user.uid;
      console.log("El usuario ya existía; sesión iniciada para asignar rol.");
    } else {
      throw e;
    }
  }

  await setDoc(
    doc(db, "usuarios", uid),
    { email, rol: "moderador", negocioId: null, creadoEn: Date.now() },
    { merge: true }
  );
  console.log(`Listo. ${email} es moderador (uid ${uid}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.code || e.message || e);
  process.exit(1);
});
