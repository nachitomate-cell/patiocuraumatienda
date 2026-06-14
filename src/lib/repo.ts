import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
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
  type Emprendedor,
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
const EMPRENDEDORES = "emprendedores";
const CONTADORES = "contadores";

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// ===== Cache en memoria (por sesión) =====
// El catálogo y los clientes se leen una vez y se reutilizan entre pantallas
// (Stock, Venta, Fiados), evitando releer la colección completa en cada
// navegación. Las escrituras actualizan el cache en sitio (venta, ajuste,
// abono) o lo invalidan (importación, entradas, alta) para no desincronizar.
let _catalogo: Producto[] | null = null;
let _clientes: Cliente[] | null = null;

function invalidarCatalogo(): void {
  _catalogo = null;
}

function invalidarClientes(): void {
  _clientes = null;
}

// Aplica cambios a un producto en el cache. Si no estaba (código nuevo),
// invalida el cache para forzar una relectura fresca.
function parchearProducto(codigo: string, cambios: Partial<Producto>): void {
  if (!_catalogo) return;
  const cod = codigo.trim();
  let encontrado = false;
  _catalogo = _catalogo.map((p) => {
    if (p.codigo !== cod) return p;
    encontrado = true;
    return { ...p, ...cambios };
  });
  if (!encontrado) _catalogo = null;
}

// Descuenta del cache el stock vendido (ignora líneas manuales).
function aplicarVentaACache(items: LineaVenta[]): void {
  if (!_catalogo) return;
  const vendidos = new Map<string, number>();
  for (const l of items) {
    if (l.manual || !l.codigo) continue;
    vendidos.set(l.codigo, (vendidos.get(l.codigo) ?? 0) + l.cantidad);
  }
  if (vendidos.size === 0) return;
  _catalogo = _catalogo.map((p) =>
    vendidos.has(p.codigo)
      ? { ...p, stockActual: (p.stockActual ?? 0) - (vendidos.get(p.codigo) as number) }
      : p
  );
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
  // Si el catálogo ya está en memoria, resolver sin tocar la red (0 lecturas).
  if (_catalogo) {
    const enCache = _catalogo.find((p) => p.codigo === v || p.barcode === v);
    if (enCache) return enCache;
  }
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

// Carga todo el catalogo (para el panel de inventario y el buscador de venta).
// Se cachea en memoria: la primera vez lee la colección, luego se reutiliza
// entre pantallas sin volver a leer. `force` fuerza una relectura (Refrescar).
export async function todosLosProductos(force = false): Promise<Producto[]> {
  if (_catalogo && !force) return _catalogo;
  const snap = await getDocs(collection(getDb(), PRODUCTOS));
  _catalogo = snap.docs.map((d) => d.data() as Producto);
  return _catalogo;
}

// Ajuste manual de un producto (stock, precio o costo).
export async function ajustarProducto(
  codigo: string,
  cambios: Partial<Producto>
): Promise<void> {
  await setDoc(doc(getDb(), PRODUCTOS, codigo.trim()), cambios, { merge: true });
  parchearProducto(codigo, cambios);
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
  invalidarCatalogo();
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
    // Los productos manuales (fuera de catálogo) no existen como documento,
    // así que no se les descuenta stock: actualizarlos rompería el lote.
    if (l.manual || !l.codigo) continue;
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
  // Mantener el cache al día sin releer la colección.
  aplicarVentaACache(venta.items);
  if (venta.medioPago === "fiado" && venta.clienteId) invalidarClientes();
}

// ===== Cuaderno de fiados =====

export async function listarClientes(force = false): Promise<Cliente[]> {
  if (_clientes && !force) return _clientes;
  const snap = await getDocs(collection(getDb(), CLIENTES));
  _clientes = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Cliente, "id">) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  return _clientes;
}

export async function crearCliente(nombre: string, telefono = ""): Promise<string> {
  const ref = await addDoc(collection(getDb(), CLIENTES), {
    nombre: nombre.trim(),
    telefono: telefono.trim(),
    saldo: 0,
    creadoEn: Date.now(),
  });
  invalidarClientes();
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
  invalidarClientes();
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

// ===== Emprendedores (consignación) =====

// Normaliza un prefijo: solo letras/números en MAYÚSCULA (ej. "amon" -> "AMON").
export function normalizarPrefijo(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function generarPrefijo(nombre: string, usados: string[]): string {
  const letras = nombre.toUpperCase().replace(/[^A-Z]/g, "");
  const base = letras.slice(0, 4) || "EMP";
  if (!usados.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    const c = base.slice(0, 3) + i;
    if (!usados.includes(c)) return c;
  }
  return base + Date.now().toString().slice(-3);
}

function nuevoToken(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

export async function listarEmprendedores(): Promise<Emprendedor[]> {
  const snap = await getDocs(collection(getDb(), EMPRENDEDORES));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Emprendedor, "id">) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function crearEmprendedor(
  nombre: string,
  contacto = "",
  telefono = "",
  prefijo = ""
): Promise<Emprendedor> {
  const existentes = await listarEmprendedores();
  const usados = existentes.map((e) => e.prefijo);
  const pref = normalizarPrefijo(prefijo) || generarPrefijo(nombre, usados);
  if (usados.includes(pref)) {
    throw new Error(`El prefijo ${pref} ya está en uso por otro emprendedor.`);
  }
  const datos = {
    nombre: nombre.trim(),
    contacto: contacto.trim(),
    telefono: telefono.trim(),
    token: nuevoToken(),
    prefijo: pref,
    productosCount: 0,
    creadoEn: Date.now(),
  };
  const ref = await addDoc(collection(getDb(), EMPRENDEDORES), datos);
  return { id: ref.id, ...datos };
}

// Edita los datos de un emprendedor. Si cambia el prefijo, valida unicidad.
export async function actualizarEmprendedor(
  id: string,
  cambios: Partial<Pick<Emprendedor, "nombre" | "contacto" | "telefono" | "prefijo">>
): Promise<void> {
  const datos: Record<string, string> = {};
  if (cambios.nombre !== undefined) datos.nombre = cambios.nombre.trim();
  if (cambios.contacto !== undefined) datos.contacto = cambios.contacto.trim();
  if (cambios.telefono !== undefined) datos.telefono = cambios.telefono.trim();
  if (cambios.prefijo !== undefined) {
    const pref = normalizarPrefijo(cambios.prefijo);
    if (!pref) throw new Error("El prefijo no puede quedar vacío.");
    const existentes = await listarEmprendedores();
    if (existentes.some((e) => e.id !== id && e.prefijo === pref)) {
      throw new Error(`El prefijo ${pref} ya está en uso por otro emprendedor.`);
    }
    datos.prefijo = pref;
  }
  await setDoc(doc(getDb(), EMPRENDEDORES, id), datos, { merge: true });
}

// Elimina un emprendedor. Sus productos permanecen en el catálogo.
export async function eliminarEmprendedor(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), EMPRENDEDORES, id));
}

export async function getEmprendedorPorToken(
  token: string
): Promise<Emprendedor | null> {
  const q = query(
    collection(getDb(), EMPRENDEDORES),
    where("token", "==", token),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<Emprendedor, "id">) };
}

// El emprendedor agrega un producto: se crea en el stock real con código único.
export async function agregarProductoEmprendedor(
  emp: Emprendedor,
  datos: { descripcion: string; precio: number; costo?: number; stock?: number }
): Promise<string> {
  const db = getDb();
  const empRef = doc(db, EMPRENDEDORES, emp.id);
  const codigo = await runTransaction(db, async (tx) => {
    const s = await tx.get(empRef);
    const n = (s.exists() ? (s.data().productosCount as number) || 0 : 0) + 1;
    const cod = `${emp.prefijo}-${String(n).padStart(4, "0")}`;
    tx.update(empRef, { productosCount: n });
    tx.set(doc(db, PRODUCTOS, cod), {
      codigo: cod,
      descripcion: datos.descripcion.trim(),
      precio: datos.precio,
      costo: datos.costo ?? 0,
      stockActual: datos.stock ?? 0,
      emprendedorId: emp.id,
      emprendedorNombre: emp.nombre,
      creadoEn: Date.now(),
    });
    return cod;
  });
  invalidarCatalogo(); // producto nuevo en el catálogo
  return codigo;
}

export async function productosDeEmprendedor(empId: string): Promise<Producto[]> {
  const q = query(collection(getDb(), PRODUCTOS), where("emprendedorId", "==", empId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Producto);
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
  invalidarCatalogo(); // pudo crear o modificar productos del catálogo
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
