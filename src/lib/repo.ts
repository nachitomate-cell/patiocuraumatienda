import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  increment,
  documentId,
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  subtotalLinea,
  type Cliente,
  type Entrada,
  type LineaEntrada,
  type LineaVenta,
  type MovimientoFiado,
  type Producto,
  type Venta,
} from "./types";

const PRODUCTOS = "productos";
const VENTAS = "ventas";
const ENTRADAS = "entradas";
const CLIENTES = "clientes";
const CONTADORES = "contadores";

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getProducto(codigo: string): Promise<Producto | null> {
  const ref = doc(getDb(), PRODUCTOS, codigo.trim());
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as Producto) : null;
}

// Búsqueda para venta/escáner: primero por código interno (id del documento)
// y, si no existe, por el campo código de barras (EAN/UPC).
export async function buscarParaVenta(valor: string): Promise<Producto | null> {
  const v = valor.trim();
  if (!v) return null;
  const directo = await getProducto(v);
  if (directo) return directo;
  const q = query(collection(getDb(), PRODUCTOS), where("barcode", "==", v), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : (snap.docs[0].data() as Producto);
}

// Busqueda por prefijo de codigo (usa el id del documento). Limitada para
// no leer todo el catalogo y mantener bajo el costo de Firestore.
export async function buscarProductos(term: string, max = 30): Promise<Producto[]> {
  const t = term.trim().toUpperCase();
  if (!t) return [];
  const hi = t + String.fromCharCode(0xf8ff);
  const q = query(
    collection(getDb(), PRODUCTOS),
    where(documentId(), ">=", t),
    where(documentId(), "<=", hi),
    orderBy(documentId()),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Producto);
}

// Carga todo el catalogo (para el panel de inventario). Tras la primera
// lectura, Firestore lo sirve desde la cache local (offline y sin costo).
export async function todosLosProductos(): Promise<Producto[]> {
  const snap = await getDocs(collection(getDb(), PRODUCTOS));
  return snap.docs.map((d) => d.data() as Producto);
}

// Ajuste manual de un producto (stock, precio o costo).
export async function ajustarProducto(
  codigo: string,
  cambios: Partial<Producto>
): Promise<void> {
  await setDoc(doc(getDb(), PRODUCTOS, codigo.trim()), cambios, { merge: true });
}

// Carga inicial del catalogo desde el Excel exportado. Escribe por lotes
// (max 500 ops por batch en Firestore).
export async function importarCatalogo(
  productos: Producto[],
  onProgress?: (hechos: number, total: number) => void
): Promise<number> {
  const db = getDb();
  const CHUNK = 450;
  let hechos = 0;
  for (let i = 0; i < productos.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const p of productos.slice(i, i + CHUNK)) {
      batch.set(doc(db, PRODUCTOS, p.codigo), p, { merge: true });
    }
    await batch.commit();
    hechos = Math.min(i + CHUNK, productos.length);
    onProgress?.(hechos, productos.length);
  }
  return hechos;
}

// Correlativo NV-### atomico mediante un documento contador.
export async function siguienteNroVenta(): Promise<string> {
  const db = getDb();
  const ref = doc(db, CONTADORES, "ventas");
  const n = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.exists() ? (snap.data().ultimo as number) : 0;
    const siguiente = actual + 1;
    tx.set(ref, { ultimo: siguiente }, { merge: true });
    return siguiente;
  });
  return "NV-" + String(n).padStart(3, "0");
}

// Confirma una venta: registra el documento y descuenta stock de forma atomica.
export async function confirmarVenta(
  venta: Omit<Venta, "creadoEn">
): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);
  const total = venta.items.reduce((s, l) => s + subtotalLinea(l), 0);

  batch.set(doc(db, VENTAS, venta.nro), {
    ...venta,
    total,
    creadoEn: Date.now(),
  });

  for (const l of venta.items) {
    batch.update(doc(db, PRODUCTOS, l.codigo), {
      stockActual: increment(-l.cantidad),
    });
  }

  // Si la venta es a fiado, carga la deuda al cliente en el mismo lote.
  if (venta.medioPago === "fiado" && venta.clienteId) {
    batch.set(doc(collection(db, CLIENTES, venta.clienteId, "movimientos")), {
      tipo: "cargo",
      monto: total,
      fecha: venta.fecha,
      ventaNro: venta.nro,
      nota: "Venta a fiado",
      creadoEn: Date.now(),
    });
    batch.update(doc(db, CLIENTES, venta.clienteId), {
      saldo: increment(total),
    });
  }

  await batch.commit();
}

// ===== Cuaderno de fiados =====

export async function listarClientes(): Promise<Cliente[]> {
  const snap = await getDocs(collection(getDb(), CLIENTES));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Cliente, "id">) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function crearCliente(nombre: string, telefono = ""): Promise<string> {
  const ref = await addDoc(collection(getDb(), CLIENTES), {
    nombre: nombre.trim(),
    telefono: telefono.trim(),
    saldo: 0,
    creadoEn: Date.now(),
  });
  return ref.id;
}

// Registra un abono (pago) del cliente: baja su deuda.
export async function registrarAbono(
  clienteId: string,
  monto: number,
  nota = ""
): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);
  batch.set(doc(collection(db, CLIENTES, clienteId, "movimientos")), {
    tipo: "abono",
    monto,
    fecha: hoy(),
    nota,
    creadoEn: Date.now(),
  });
  batch.update(doc(db, CLIENTES, clienteId), { saldo: increment(-monto) });
  await batch.commit();
}

export async function movimientosCliente(
  clienteId: string,
  max = 50
): Promise<MovimientoFiado[]> {
  const q = query(
    collection(getDb(), CLIENTES, clienteId, "movimientos"),
    orderBy("creadoEn", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as MovimientoFiado);
}

export async function ultimasVentas(max = 20): Promise<Venta[]> {
  const q = query(
    collection(getDb(), VENTAS),
    orderBy("creadoEn", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Venta);
}

// Correlativo EN-### para documentos de entrada.
export async function siguienteNroEntrada(): Promise<string> {
  const db = getDb();
  const ref = doc(db, CONTADORES, "entradas");
  const n = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.exists() ? (snap.data().ultimo as number) : 0;
    const siguiente = actual + 1;
    tx.set(ref, { ultimo: siguiente }, { merge: true });
    return siguiente;
  });
  return "EN-" + String(n).padStart(3, "0");
}

// Registra una entrada (ingreso de stock). Suma stockActual de forma atomica.
// Si el codigo no existe en el catalogo, crea el producto con los datos dados.
export async function registrarEntrada(
  nro: string,
  fecha: string,
  items: LineaEntrada[],
  usuario?: string
): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);

  for (const l of items) {
    const cod = l.codigo.trim();
    // Documento de movimiento (historial de entradas).
    batch.set(doc(collection(db, ENTRADAS)), {
      nro,
      fecha,
      codigo: cod,
      descripcion: l.descripcion,
      lote: l.lote ?? "",
      cantidad: l.cantidad,
      creadoEn: Date.now(),
      usuario: usuario ?? "",
    });
    // Suma al stock (crea el producto si no existia, con merge).
    batch.set(
      doc(db, PRODUCTOS, cod),
      {
        codigo: cod,
        descripcion: l.descripcion,
        lote: l.lote ?? "",
        stockActual: increment(l.cantidad),
      },
      { merge: true }
    );
  }
  await batch.commit();
}

export async function ultimasEntradas(max = 30): Promise<Entrada[]> {
  const q = query(
    collection(getDb(), ENTRADAS),
    orderBy("creadoEn", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Entrada);
}

export type { Entrada, LineaEntrada, LineaVenta, Producto, Venta };
