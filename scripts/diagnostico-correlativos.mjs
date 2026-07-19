// Diagnostica (y opcionalmente repara) los contadores productosCount de los
// emprendedores comparándolos con los códigos PREFIJO-NNNN que realmente
// existen en negocios/<slug>/productos.
//
// "denseMax" = último correlativo del bloque contiguo real: se recorren los
// correlativos ordenados y se corta en el primer salto > 100. Códigos aislados
// muy por encima (p.ej. BEND-3381 escrito a mano) quedan como outliers y NO
// arrastran el contador.
//
// Uso:
//   node --env-file=.env.local scripts/diagnostico-correlativos.mjs [slug]
//   node --env-file=.env.local scripts/diagnostico-correlativos.mjs [slug] --fix
//
// Sin --fix solo imprime el reporte. Con --fix:
//   - count < denseMax  → sube a denseMax (siempre seguro: los docs existen).
//   - count > denseMax  → baja a denseMax SOLO si hay un doc outlier con
//     correlativo >= count (prueba de que el contador fue arrastrado por un
//     código manual fuera de serie). Si no hay doc que lo explique, se deja:
//     es una reserva deliberada del seed (códigos históricos en etiquetas
//     físicas nunca importados, p.ej. TASH=20 con 0 docs).

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const args = process.argv.slice(2).filter((a) => a !== "--fix");
const FIX = process.argv.includes("--fix");
const SLUG = (args[0] || "patiocurauma").trim();

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
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const [empSnap, prodSnap] = await Promise.all([
  getDocs(collection(db, "negocios", SLUG, "emprendedores")),
  getDocs(collection(db, "negocios", SLUG, "productos")),
]);

// Correlativos por prefijo, a partir del ID del doc (cubre docs sin campo
// codigo y soft-eliminados). Guardamos también datos para reportar outliers.
const porPrefijo = new Map(); // prefijo -> [{ n, id, desc, eliminado }]
for (const d of prodSnap.docs) {
  const m = d.id.match(/^([A-Z]+)-(\d+)$/);
  if (!m) continue;
  const lista = porPrefijo.get(m[1]) || [];
  const data = d.data();
  lista.push({
    n: Number(m[2]),
    id: d.id,
    desc: data.descripcion || "",
    eliminado: !!data.eliminado,
  });
  porPrefijo.set(m[1], lista);
}

function denseMax(nums) {
  // nums ordenado ascendente y sin duplicados. Corta en el primer salto > 100.
  let max = 0;
  for (const n of nums) {
    if (n - max > 100) break;
    max = n;
  }
  return max;
}

console.log(
  `negocios/${SLUG}: ${prodSnap.size} productos, ${empSnap.size} emprendedores.\n`
);

let desviados = 0;
for (const e of empSnap.docs.sort((a, b) =>
  (a.data().prefijo || "").localeCompare(b.data().prefijo || "")
)) {
  const { prefijo, nombre, productosCount = 0 } = e.data();
  if (!prefijo) continue;
  const items = (porPrefijo.get(prefijo) || []).sort((a, b) => a.n - b.n);
  const nums = [...new Set(items.map((i) => i.n))];
  const dmax = denseMax(nums);
  const outliers = items.filter((i) => i.n > dmax);
  // Corregible: subir siempre; bajar solo si un outlier explica el arrastre.
  const corregible =
    productosCount < dmax ||
    (productosCount > dmax && outliers.some((o) => o.n >= productosCount));
  const ok = productosCount === dmax || !corregible;
  if (!ok) desviados++;

  // Próximo código real bajo la regla del backend: primer hueco libre
  // después del contador (el corregido, si aplica), saltando ocupados.
  const setNums = new Set(nums);
  let prox = corregible ? dmax : productosCount;
  do {
    prox++;
  } while (setNums.has(prox));

  console.log(
    `${ok ? "  " : "✗ "}${prefijo.padEnd(4)} ${String(nombre).padEnd(22)} ` +
      `count=${String(productosCount).padStart(5)}  denseMax=${String(dmax).padStart(5)}  ` +
      `docs=${String(items.length).padStart(4)}  proximo=${prefijo}-${String(prox).padStart(4, "0")}`
  );
  for (const o of outliers) {
    console.log(
      `        outlier: ${o.id}  "${o.desc}"${o.eliminado ? "  [eliminado]" : ""}`
    );
  }

  if (FIX && corregible && productosCount !== dmax) {
    await updateDoc(doc(db, "negocios", SLUG, "emprendedores", e.id), {
      productosCount: dmax,
    });
    console.log(`        → productosCount corregido: ${productosCount} → ${dmax}`);
  }
}

console.log(
  `\n${desviados} emprendedor(es) con contador desviado.` +
    (FIX ? " Corregidos." : desviados ? " Corre con --fix para corregirlos." : "")
);
process.exit(0);
