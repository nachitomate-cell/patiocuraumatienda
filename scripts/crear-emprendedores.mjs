// Siembra los emprendedores iniciales del negocio (patiocurauma por defecto).
//
// productosCount = ÚLTIMO correlativo usado por cada emprendedor (no la
// cantidad de productos vigentes). Si el rango sube hasta NNNN y el total
// de productos es < NNNN (productos eliminados dentro del rango), igual
// usamos NNNN; si el total es > NNNN (productos fuera del rango declarado),
// usamos el total. Así el siguiente código generado en /alta/{token} no
// puede chocar con uno preexistente.
//
// Uso (Node 20+):
//   node --env-file=.env.local scripts/crear-emprendedores.mjs <correoMod> <clave> [slug]
//   default slug = patiocurauma
//
// Idempotente: salta los emprendedores cuyo prefijo ya exista en el negocio.

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  getDocs,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { randomUUID } from "node:crypto";

const email = (process.argv[2] || "").trim();
const password = process.argv[3] || "";
const slug = (process.argv[4] || "patiocurauma").trim();

if (!email || password.length < 6) {
  console.error(
    "Uso: node --env-file=.env.local scripts/crear-emprendedores.mjs <correoMod> <clave> [slug]"
  );
  process.exit(1);
}

const EMPRENDEDORES = [
  { nombre: "Alfo SPA",           prefijo: "ALFO", productosCount: 53 },
  { nombre: "Amonite Joyas",      prefijo: "AMON", productosCount: 167 },
  { nombre: "Antu Gustos",        prefijo: "ANTU", productosCount: 18 },
  { nombre: "Artesana en Lana",   prefijo: "ARDI", productosCount: 12 },
  { nombre: "Aroma Vida",         prefijo: "AROM", productosCount: 67 },
  { nombre: "Arte en Lana",       prefijo: "ARTE", productosCount: 6 },
  { nombre: "Bendita India",      prefijo: "BEND", productosCount: 125 },
  { nombre: "Glo Recicla",        prefijo: "GLOR", productosCount: 25 },
  { nombre: "Lilín Eco Candle",   prefijo: "LILI", productosCount: 41 },
  { nombre: "Martien",            prefijo: "MART", productosCount: 35 },
  { nombre: "Muru",               prefijo: "MURU", productosCount: 15 },
  { nombre: "Nimapa",             prefijo: "NIMA", productosCount: 14 },
  { nombre: "Oxygene Chile",      prefijo: "OXYG", productosCount: 19 },
  { nombre: "Popa",               prefijo: "POPA", productosCount: 25 },
  { nombre: "Semillarte",         prefijo: "SEMI", productosCount: 33 },
  { nombre: "Stylo Urbano Chile", prefijo: "STYL", productosCount: 44 },
  { nombre: "Tashi",              prefijo: "TASH", productosCount: 20 },
  { nombre: "Valeria Hernández",  prefijo: "VALE", productosCount: 10 },
  { nombre: "Zanttina",           prefijo: "ZANT", productosCount: 236 },
];

// Emprendedores históricos que ya no están operativos. Se crean igual para
// poder reactivarlos en el futuro sin perder el correlativo de sus códigos.
// productosCount sigue la misma regla: máximo entre rango y total declarado.
const INACTIVOS = [
  { nombre: "Bee Honey",            prefijo: "BEEH", productosCount: 11 },
  { nombre: "Cambar Manualidades",  prefijo: "CAMB", productosCount: 45 },
  { nombre: "Darc",                 prefijo: "DARC", productosCount: 17 },
  { nombre: "Divina Lencería",      prefijo: "DIVI", productosCount: 27 },
  { nombre: "Doradas Home",         prefijo: "DORA", productosCount: 11 },
  { nombre: "Fibr",                 prefijo: "FIBR", productosCount: 24 },
  { nombre: "Glow Up",              prefijo: "GLOW", productosCount: 34 },
  { nombre: "Hechizos de Mujer",    prefijo: "HECH", productosCount: 60 },
  { nombre: "Heki",                 prefijo: "HEKI", productosCount: 21 },
  { nombre: "Herbatas Tés y Blends", prefijo: "HERB", productosCount: 59 },
  // Ho: el rango declarado era HO-13001 (claramente typo). Usamos el total
  // (46) como productosCount: si reactivan, el próximo será HO-0047.
  { nombre: "Ho",                   prefijo: "HO",   productosCount: 46 },
  { nombre: "Jardín de la Yayi",    prefijo: "JARD", productosCount: 295 },
  // Jazmina: rango declarado 0000→0000 con total 2 (inconsistente). Usamos
  // total para que el próximo no choque con los 2 existentes.
  { nombre: "Jazmina",              prefijo: "JAZM", productosCount: 2 },
  { nombre: "Krisha",               prefijo: "KRIS", productosCount: 10 },
  { nombre: "Madu",                 prefijo: "MADU", productosCount: 92 },
  { nombre: "Manualidades Solart",  prefijo: "MANU", productosCount: 29 },
  { nombre: "Pinta tu Punto",       prefijo: "PINT", productosCount: 19 },
  { nombre: "Rincón de Patitas",    prefijo: "RINC", productosCount: 85 },
  { nombre: "Rita del Monte",       prefijo: "RITA", productosCount: 6 },
  { nombre: "Tetería Paraíso",      prefijo: "TETE", productosCount: 21 },
  { nombre: "Todo Crochet",         prefijo: "TODO", productosCount: 14 },
  { nombre: "Vivero J&V",           prefijo: "VIVE", productosCount: 19 },
  { nombre: "Vudú Colección",       prefijo: "VUDU", productosCount: 19 },
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
  console.error("Falta la configuración de Firebase (.env.local).");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function nuevoToken() {
  // Mismo formato que el código de producción (ver repo.ts -> nuevoToken).
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

async function main() {
  await signInWithEmailAndPassword(auth, email, password);
  console.log(
    `Autenticado como ${email}. Sembrando ${EMPRENDEDORES.length} activos + ${INACTIVOS.length} inactivos en negocios/${slug}/emprendedores...`
  );

  // Mapa de prefijos ya existentes -> id del documento (para no duplicar).
  const empCol = collection(db, "negocios", slug, "emprendedores");
  const snap = await getDocs(empCol);
  const yaExisten = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    if (data.prefijo) yaExisten.set(data.prefijo, d.id);
  }

  let creados = 0;
  let saltados = 0;
  const links = [];

  async function sembrar(lista, activo) {
    for (const e of lista) {
      if (yaExisten.has(e.prefijo)) {
        console.log(`  · ${e.prefijo} ya existe (id ${yaExisten.get(e.prefijo)}), salto.`);
        saltados++;
        continue;
      }
      const token = nuevoToken();
      await setDoc(doc(db, "negocios", slug, "emprendedores", token), {
        nombre: e.nombre,
        contacto: "",
        telefono: "",
        token,
        prefijo: e.prefijo,
        productosCount: e.productosCount,
        activo,
        creadoEn: Date.now(),
      });
      const marca = activo ? "+" : "~";
      console.log(
        `  ${marca} ${e.prefijo.padEnd(4)}  ${e.nombre.padEnd(22)} count=${String(e.productosCount).padStart(3)}  token=${token}`
      );
      if (activo) links.push({ nombre: e.nombre, token });
      creados++;
    }
  }

  console.log("\nActivos:");
  await sembrar(EMPRENDEDORES, true);
  console.log("\nInactivos:");
  await sembrar(INACTIVOS, false);

  console.log(`\nListo. Creados ${creados}, saltados ${saltados}.`);
  if (links.length > 0) {
    console.log("\nLinks /alta de emprendedores ACTIVOS:");
    for (const l of links) {
      console.log(`  ${l.nombre.padEnd(22)} https://${slug}.synaptechspa.cl/alta/${l.token}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.code || e.message || e);
  process.exit(1);
});
