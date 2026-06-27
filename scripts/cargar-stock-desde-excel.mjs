// Recarga stockActual de TODOS los productos de un tenant a partir de un
// Excel de control de inventario. Calcula stock como sum(ENTRADAS) -
// sum(SALIDAS) por código de producto. NO crea productos nuevos: sólo
// actualiza los que ya existen en Firestore por su código.
//
// Uso (preview):
//   node --env-file=.env.local scripts/cargar-stock-desde-excel.mjs <ruta_xlsx> <slug>
//
// Uso (aplicar):
//   node --env-file=.env.local scripts/cargar-stock-desde-excel.mjs <ruta_xlsx> <slug> --confirmo
//
// Excel esperado:
//   Hoja "ENTRADAS" — col Codigo Producto + Cantidad (encabezados en fila 3)
//   Hoja "SALIDAS"  — col Codigo Producto + Cantidad (encabezados en fila 2)

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import { read, utils } from "xlsx";
import { readFileSync } from "fs";

const PATH = process.argv[2];
const SLUG = (process.argv[3] || "").trim();
const CONFIRMA = process.argv.includes("--confirmo");

if (!PATH || !SLUG) {
  console.error(
    "Uso: node --env-file=.env.local scripts/cargar-stock-desde-excel.mjs <ruta_xlsx> <slug> [--confirmo]"
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

// Normaliza códigos: trim + uppercase, sin espacios ni guiones. Cubre los
// inputs sucios del Excel ("ITS -0001" o "AMON0110" vs "AMON-0110").
function normCod(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
}

// Recorre filas de la hoja buscando la fila de encabezado por contener
// "Codigo Producto" en alguna celda. Devuelve { idxCodigo, idxCant } y
// el índice de la primera fila de datos.
function detectarColumnas(rows) {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = rows[i] || [];
    const idxCodigo = r.findIndex(
      (c) => typeof c === "string" && c.trim().toLowerCase().startsWith("codigo")
    );
    const idxCant = r.findIndex(
      (c) => typeof c === "string" && c.trim().toLowerCase() === "cantidad"
    );
    if (idxCodigo >= 0 && idxCant >= 0) {
      return { idxCodigo, idxCant, primeraData: i + 1 };
    }
  }
  return null;
}

function agregarPorCodigo(sh) {
  const rows = utils.sheet_to_json(sh, { header: 1, defval: null });
  const det = detectarColumnas(rows);
  if (!det) throw new Error("No se encontró fila de encabezado con 'Codigo Producto' + 'Cantidad'.");
  const acc = new Map();
  let leidas = 0;
  for (let i = det.primeraData; i < rows.length; i++) {
    const r = rows[i] || [];
    const cod = normCod(r[det.idxCodigo]);
    const cantRaw = r[det.idxCant];
    const cant = Number(cantRaw);
    if (!cod || !Number.isFinite(cant) || cant <= 0) continue;
    acc.set(cod, (acc.get(cod) || 0) + cant);
    leidas++;
  }
  return { acc, leidas };
}

async function main() {
  console.log(`Leyendo Excel: ${PATH}`);
  const buf = readFileSync(PATH);
  const wb = read(buf);

  const shEntradas =
    wb.Sheets["ENTRADAS"] || wb.Sheets["Entradas"] || wb.Sheets["entradas"];
  const shSalidas =
    wb.Sheets["SALIDAS"] || wb.Sheets["Salidas"] || wb.Sheets["salidas"];
  if (!shEntradas || !shSalidas) {
    console.error("El archivo debe tener hojas 'ENTRADAS' y 'SALIDAS'.");
    process.exit(1);
  }

  const ent = agregarPorCodigo(shEntradas);
  const sal = agregarPorCodigo(shSalidas);
  console.log(
    `  ENTRADAS: ${ent.acc.size} códigos únicos (${ent.leidas} líneas leídas)`
  );
  console.log(
    `  SALIDAS:  ${sal.acc.size} códigos únicos (${sal.leidas} líneas leídas)`
  );

  // Neto por código (entradas - salidas). Allow negativos: si las salidas
  // superan las entradas, queda negativo (consistente con la app, que
  // permite vender bajo stock).
  const neto = new Map();
  for (const [cod, e] of ent.acc) neto.set(cod, e);
  for (const [cod, s] of sal.acc) neto.set(cod, (neto.get(cod) || 0) - s);

  console.log("");
  console.log(`Conectando a Firestore: negocios/${SLUG}/productos ...`);
  await signInAnonymously(getAuth(app));
  const snap = await getDocs(collection(db, "negocios", SLUG, "productos"));
  console.log(`  Productos en Firestore: ${snap.docs.length}`);

  // Match por código normalizado contra el id del doc (el ID en Firestore
  // es el código del producto). Si por algún caso no coincide, se podría
  // matchear contra el campo data.codigo.
  const fsCods = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    const cod = normCod(data.codigo || d.id);
    fsCods.set(cod, d);
  }

  let aActualizar = [];
  let sinCambio = 0;
  for (const [cod, valor] of neto) {
    const d = fsCods.get(cod);
    if (!d) continue;
    const actual = Number(d.data().stockActual || 0);
    if (actual !== valor) aActualizar.push({ ref: d.ref, nuevo: valor, anterior: actual, cod });
    else sinCambio++;
  }

  const sobrantesExcel = [];
  for (const cod of neto.keys()) if (!fsCods.has(cod)) sobrantesExcel.push(cod);
  const productosNoTocados = snap.docs.length - aActualizar.length - sinCambio;

  console.log("");
  console.log(`Resumen del match:`);
  console.log(`  A actualizar:                 ${aActualizar.length}`);
  console.log(`  Ya estaban igual:             ${sinCambio}`);
  console.log(`  Productos sin movimientos:    ${productosNoTocados} (quedan en su valor actual)`);
  console.log(`  Códigos del Excel sin match:  ${sobrantesExcel.length}`);

  if (sobrantesExcel.length > 0 && sobrantesExcel.length <= 20) {
    console.log(`  Códigos huérfanos: ${sobrantesExcel.join(", ")}`);
  } else if (sobrantesExcel.length > 20) {
    console.log(`  Primeros 20 huérfanos: ${sobrantesExcel.slice(0, 20).join(", ")} ...`);
  }

  if (aActualizar.length > 0) {
    console.log("");
    console.log("Muestra (10 productos a actualizar):");
    for (const x of aActualizar.slice(0, 10)) {
      console.log(`  ${x.cod}: ${x.anterior} → ${x.nuevo}`);
    }
  }

  if (!CONFIRMA) {
    console.log("");
    console.log("Modo preview. Para aplicar agregá --confirmo al final.");
    process.exit(0);
  }

  console.log("");
  console.log("Aplicando cambios...");
  const CHUNK = 400;
  for (let i = 0; i < aActualizar.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const x of aActualizar.slice(i, i + CHUNK)) {
      batch.update(x.ref, { stockActual: x.nuevo });
    }
    await batch.commit();
    console.log(`  Batch ${Math.floor(i / CHUNK) + 1}: ${Math.min(CHUNK, aActualizar.length - i)} docs`);
  }
  console.log("");
  console.log(`Listo. ${aActualizar.length} productos actualizados.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
