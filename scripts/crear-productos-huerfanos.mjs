// Crea en Firestore los productos del Excel que NO existen en el catálogo
// del tenant (huérfanos del importer de stock). Saca descripción, costo y
// precio de la hoja STOCK, y stockActual de sum(ENTRADAS)-sum(SALIDAS).
//
// Uso (preview):
//   node --env-file=.env.local scripts/crear-productos-huerfanos.mjs <ruta_xlsx> <slug>
//
// Uso (aplicar):
//   node --env-file=.env.local scripts/crear-productos-huerfanos.mjs <ruta_xlsx> <slug> --confirmo

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
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
    "Uso: node --env-file=.env.local scripts/crear-productos-huerfanos.mjs <ruta_xlsx> <slug> [--confirmo]"
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

function normCod(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
}

// codigo "limpio" para usar como ID del producto en Firestore. Conserva
// dashes y mayúsculas pero saca espacios sobrantes.
function codDocId(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

function detectarColumnasIndex(rows, nombres) {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = rows[i] || [];
    const idx = {};
    let todos = true;
    for (const [k, posibles] of Object.entries(nombres)) {
      const found = r.findIndex(
        (c) =>
          typeof c === "string" &&
          posibles.some((p) => c.trim().toLowerCase().includes(p))
      );
      if (found < 0) {
        todos = false;
        break;
      }
      idx[k] = found;
    }
    if (todos) return { idx, primeraData: i + 1 };
  }
  return null;
}

function agregarMovs(sh) {
  const rows = utils.sheet_to_json(sh, { header: 1, defval: null });
  const det = detectarColumnasIndex(rows, {
    cod: ["codigo"],
    cant: ["cantidad"],
  });
  if (!det) throw new Error("Sin 'Codigo' + 'Cantidad' en la hoja.");
  const acc = new Map();
  for (let i = det.primeraData; i < rows.length; i++) {
    const r = rows[i] || [];
    const cod = normCod(r[det.idx.cod]);
    const cant = Number(r[det.idx.cant]);
    if (!cod || !Number.isFinite(cant) || cant <= 0) continue;
    acc.set(cod, (acc.get(cod) || 0) + cant);
  }
  return acc;
}

function leerStockSheet(sh) {
  const rows = utils.sheet_to_json(sh, { header: 1, defval: null });
  const det = detectarColumnasIndex(rows, {
    cod: ["codigo"],
    desc: ["descripción", "descripcion"],
    lote: ["lote"],
    costo: ["costo"],
    precio: ["valor venta", "venta", "precio"],
  });
  if (!det) throw new Error("Hoja STOCK sin columnas esperadas (codigo/descripción/costo/valor venta).");
  // Mapa: codNorm -> { codRaw, descripcion, lote, costo, precio }
  const map = new Map();
  for (let i = det.primeraData; i < rows.length; i++) {
    const r = rows[i] || [];
    const codRaw = String(r[det.idx.cod] || "").trim();
    if (!codRaw) continue;
    const cn = normCod(codRaw);
    if (!cn) continue;
    map.set(cn, {
      codRaw: codDocId(codRaw),
      descripcion: String(r[det.idx.desc] || "").trim(),
      lote: r[det.idx.lote] != null ? String(r[det.idx.lote]).trim() : "",
      costo: Math.max(0, Math.round(Number(r[det.idx.costo]) || 0)),
      precio: Math.max(0, Math.round(Number(r[det.idx.precio]) || 0)),
    });
  }
  return map;
}

async function main() {
  console.log(`Leyendo Excel: ${PATH}`);
  const buf = readFileSync(PATH);
  const wb = read(buf);

  const shStock = wb.Sheets["STOCK"] || wb.Sheets["Stock"];
  const shEnt = wb.Sheets["ENTRADAS"] || wb.Sheets["Entradas"];
  const shSal = wb.Sheets["SALIDAS"] || wb.Sheets["Salidas"];
  if (!shStock || !shEnt || !shSal) {
    console.error("El Excel debe tener hojas STOCK, ENTRADAS y SALIDAS.");
    process.exit(1);
  }

  const stockData = leerStockSheet(shStock);
  const entradas = agregarMovs(shEnt);
  const salidas = agregarMovs(shSal);
  console.log(`  STOCK: ${stockData.size} códigos con info`);
  console.log(`  ENTRADAS: ${entradas.size} códigos`);
  console.log(`  SALIDAS: ${salidas.size} códigos`);

  console.log("");
  console.log(`Conectando a Firestore: negocios/${SLUG}/productos ...`);
  await signInAnonymously(getAuth(app));
  const snap = await getDocs(collection(db, "negocios", SLUG, "productos"));
  console.log(`  Productos en Firestore: ${snap.docs.length}`);
  const fsCodNorm = new Set();
  for (const d of snap.docs) {
    fsCodNorm.add(normCod(d.data().codigo || d.id));
  }

  // Universo de códigos del Excel = unión de STOCK + ENTRADAS + SALIDAS
  const universoExcel = new Set();
  for (const c of stockData.keys()) universoExcel.add(c);
  for (const c of entradas.keys()) universoExcel.add(c);
  for (const c of salidas.keys()) universoExcel.add(c);

  // Huérfanos = códigos del Excel que NO están en Firestore
  const huerfanos = [];
  const huerfanosSinInfo = [];
  for (const cn of universoExcel) {
    if (fsCodNorm.has(cn)) continue;
    const stockInfo = stockData.get(cn);
    if (!stockInfo) {
      // Está en ENTRADAS/SALIDAS pero no en la hoja STOCK: no tenemos
      // descripción ni precio confiable. Lo reportamos por separado.
      huerfanosSinInfo.push(cn);
      continue;
    }
    const ent = entradas.get(cn) || 0;
    const sal = salidas.get(cn) || 0;
    const stockActual = ent - sal;
    // Si el Excel no tiene precio de venta, usamos el costo como fallback
    // (mejor venderlo a costo que a 0). El cajero puede ajustar después.
    const precioFinal = stockInfo.precio > 0 ? stockInfo.precio : stockInfo.costo;
    huerfanos.push({
      docId: stockInfo.codRaw,
      data: {
        codigo: stockInfo.codRaw,
        descripcion: stockInfo.descripcion || stockInfo.codRaw,
        lote: stockInfo.lote || "",
        stockActual,
        costo: stockInfo.costo,
        precio: precioFinal,
      },
    });
  }

  console.log("");
  console.log(`Huérfanos a crear (con info STOCK): ${huerfanos.length}`);
  console.log(`Huérfanos sin info en STOCK:         ${huerfanosSinInfo.length}`);
  if (huerfanosSinInfo.length > 0 && huerfanosSinInfo.length <= 20) {
    console.log(`  Códigos: ${huerfanosSinInfo.join(", ")}`);
  } else if (huerfanosSinInfo.length > 20) {
    console.log(`  Primeros 20: ${huerfanosSinInfo.slice(0, 20).join(", ")} ...`);
  }

  if (huerfanos.length > 0) {
    console.log("");
    console.log("Muestra (10 productos a crear):");
    for (const x of huerfanos.slice(0, 10)) {
      console.log(
        `  ${x.docId}: "${x.data.descripcion}" precio=${x.data.precio} costo=${x.data.costo} stock=${x.data.stockActual}`
      );
    }
  }

  if (!CONFIRMA) {
    console.log("");
    console.log("Modo preview. Para aplicar agregá --confirmo al final.");
    process.exit(0);
  }

  console.log("");
  console.log("Creando productos...");
  const CHUNK = 400;
  let creados = 0;
  for (let i = 0; i < huerfanos.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const x of huerfanos.slice(i, i + CHUNK)) {
      const ref = doc(db, "negocios", SLUG, "productos", x.docId);
      batch.set(ref, x.data);
      creados++;
    }
    await batch.commit();
    console.log(`  Batch ${Math.floor(i / CHUNK) + 1}: ${Math.min(CHUNK, huerfanos.length - i)} docs`);
  }
  console.log("");
  console.log(`Listo. ${creados} productos creados.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
