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
import { getNegocioId, onCambioNegocio } from "./tenant";
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

const NEGOCIOS = "negocios";
const PRODUCTOS = "productos";
const VENTAS = "ventas";
const ENTRADAS = "entradas";
const CLIENTES = "clientes";
const EMPRENDEDORES = "emprendedores";
const CONTADORES = "contadores";
const CONFIG = "config";

// ===== Helpers de tenant =====
// Todas las colecciones del negocio cuelgan de negocios/{negocioId}/... Estos
// dos helpers anteponen ese prefijo, de modo que el resto del archivo trabaja
// con rutas relativas al negocio activo (PRODUCTOS, VENTAS, etc.).
function tcol(...segs: string[]) {
  return collection(getDb(), NEGOCIOS, getNegocioId(), ...segs);
}
function tdoc(...segs: string[]) {
  return doc(getDb(), NEGOCIOS, getNegocioId(), ...segs);
}

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

// Al cambiar de negocio, el cache deja de ser válido: se descarta.
onCambioNegocio(() => {
  _catalogo = null;
  _clientes = null;
});

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
  const ref = tdoc(PRODUCTOS, codigo.trim());
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
  const q = query(tcol(PRODUCTOS), where("barcode", "==", v), limit(1));
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
    tcol(PRODUCTOS),
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
  const snap = await getDocs(tcol(PRODUCTOS));
  _catalogo = snap.docs.map((d) => d.data() as Producto);
  return _catalogo;
}

// Ajuste manual de un producto (stock, precio o costo).
export async function ajustarProducto(
  codigo: string,
  cambios: Partial<Producto>
): Promise<void> {
  await setDoc(tdoc(PRODUCTOS, codigo.trim()), cambios, { merge: true });
  parchearProducto(codigo, cambios);
}

// ===== Códigos: normalización y renombrado =====
// Formato canónico: PREFIJO-NNNN (letras en MAYÚSCULA, guion, número con al
// menos 4 dígitos). Unifica los que claramente son "letras + número" aunque
// vengan sin guion, con espacios o en minúsculas (ALFO0050, "AMO -0001",
// "JO  0081", Herb-0001 → ALFO-0050, AMO-0001, JO-0081, HERB-0001). Los que no
// encajan en ese patrón (descriptivos o con sufijo: "DIST BAMBU", VH0091CO,
// "PR J-0001") se devuelven solo en mayúsculas/sin espacios extra, sin forzar
// el formato.
export function normalizarCodigo(codigo: string): string {
  const limpio = (codigo || "").trim().toUpperCase().replace(/\s+/g, " ");
  const m = limpio.match(/^([A-Z]+)[\s-]*(\d+)$/);
  if (m) {
    const [, prefijo, numero] = m;
    return `${prefijo}-${numero.padStart(4, "0")}`;
  }
  return limpio;
}

// Renombra un producto = cambia el id de su documento (Firestore no permite
// renombrar in situ: hay que crear el nuevo y borrar el viejo). Atómico, y
// valida que el destino no esté ocupado. No actualiza referencias históricas
// (ventas/entradas guardan el código como etiqueta, no como vínculo).
export async function renombrarProducto(viejo: string, nuevo: string): Promise<void> {
  const db = getDb();
  const codViejo = viejo.trim();
  const codNuevo = nuevo.trim();
  if (!codNuevo) throw new Error("El código no puede quedar vacío.");
  if (codNuevo === codViejo) return;
  const refViejo = tdoc(PRODUCTOS, codViejo);
  const refNuevo = tdoc(PRODUCTOS, codNuevo);
  await runTransaction(db, async (tx) => {
    const snapViejo = await tx.get(refViejo);
    if (!snapViejo.exists()) throw new Error(`El producto ${codViejo} no existe.`);
    const snapNuevo = await tx.get(refNuevo);
    if (snapNuevo.exists()) {
      throw new Error(`Ya existe un producto con el código ${codNuevo}.`);
    }
    tx.set(refNuevo, { ...(snapViejo.data() as Producto), codigo: codNuevo });
    tx.delete(refViejo);
  });
  invalidarCatalogo();
}

export interface CambioCodigo {
  de: string;
  a: string;
}
export interface ConflictoCodigo extends CambioCodigo {
  motivo: string;
}

// Calcula el plan de unificación sobre el catálogo dado: qué códigos cambian,
// cuáles chocan (destino ocupado o dos códigos que quedarían iguales) y cuántos
// ya están bien. No escribe nada; solo arma la vista previa.
export function planearNormalizacion(productos: Producto[]): {
  cambios: CambioCodigo[];
  conflictos: ConflictoCodigo[];
  sinCambio: number;
} {
  const existentes = new Set(productos.map((p) => p.codigo));
  const candidatos: CambioCodigo[] = [];
  let sinCambio = 0;
  for (const p of productos) {
    const a = normalizarCodigo(p.codigo);
    if (a === p.codigo) sinCambio++;
    else candidatos.push({ de: p.codigo, a });
  }

  const conteoDestino = new Map<string, number>();
  for (const c of candidatos) conteoDestino.set(c.a, (conteoDestino.get(c.a) ?? 0) + 1);
  const renombrados = new Set(candidatos.map((c) => c.de));

  const cambios: CambioCodigo[] = [];
  const conflictos: ConflictoCodigo[] = [];
  for (const c of candidatos) {
    if ((conteoDestino.get(c.a) ?? 0) > 1) {
      conflictos.push({ ...c, motivo: "Otro código quedaría igual" });
    } else if (existentes.has(c.a) && !renombrados.has(c.a)) {
      conflictos.push({ ...c, motivo: `Ya existe ${c.a}` });
    } else {
      cambios.push(c);
    }
  }
  return { cambios, conflictos, sinCambio };
}

// Aplica un lote de renombrados en bloques (cada renombrado = set + delete = 2
// ops; tope de 500 ops por batch). Usa los datos ya cargados del catálogo para
// no releer la colección.
export async function aplicarRenombrados(
  productos: Producto[],
  cambios: CambioCodigo[],
  onProgress?: (hechos: number, total: number) => void
): Promise<number> {
  const db = getDb();
  const mapa = new Map(productos.map((p) => [p.codigo, p]));
  const CHUNK = 200;
  let hechos = 0;
  for (let i = 0; i < cambios.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const c of cambios.slice(i, i + CHUNK)) {
      const data = mapa.get(c.de);
      if (!data) continue;
      batch.set(tdoc(PRODUCTOS, c.a), { ...data, codigo: c.a });
      batch.delete(tdoc(PRODUCTOS, c.de));
    }
    await batch.commit();
    hechos = Math.min(i + CHUNK, cambios.length);
    onProgress?.(hechos, cambios.length);
  }
  invalidarCatalogo();
  return hechos;
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
      batch.set(tdoc(PRODUCTOS, p.codigo), p, { merge: true });
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
  const ref = tdoc(CONTADORES, "ventas");
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

  batch.set(tdoc(VENTAS, venta.nro), {
    ...venta,
    total,
    creadoEn: Date.now(),
  });

  for (const l of venta.items) {
    // Los productos manuales (fuera de catálogo) no existen como documento,
    // así que no se les descuenta stock: actualizarlos rompería el lote.
    if (l.manual || !l.codigo) continue;
    batch.update(tdoc(PRODUCTOS, l.codigo), {
      stockActual: increment(-l.cantidad),
    });
  }

  // Si la venta es a fiado, carga la deuda al cliente en el mismo lote.
  if (venta.medioPago === "fiado" && venta.clienteId) {
    batch.set(doc(tcol(CLIENTES, venta.clienteId, "movimientos")), {
      tipo: "cargo",
      monto: total,
      fecha: venta.fecha,
      ventaNro: venta.nro,
      nota: "Venta a fiado",
      creadoEn: Date.now(),
    });
    batch.update(tdoc(CLIENTES, venta.clienteId), {
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
  const snap = await getDocs(tcol(CLIENTES));
  _clientes = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Cliente, "id">) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  return _clientes;
}

export async function crearCliente(nombre: string, telefono = ""): Promise<string> {
  const ref = await addDoc(tcol(CLIENTES), {
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
  batch.set(doc(tcol(CLIENTES, clienteId, "movimientos")), {
    tipo: "abono",
    monto,
    fecha: hoy(),
    nota,
    creadoEn: Date.now(),
  });
  batch.update(tdoc(CLIENTES, clienteId), { saldo: increment(-monto) });
  await batch.commit();
  invalidarClientes();
}

export async function movimientosCliente(
  clienteId: string,
  max = 50
): Promise<MovimientoFiado[]> {
  const q = query(
    tcol(CLIENTES, clienteId, "movimientos"),
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
  const snap = await getDocs(tcol(EMPRENDEDORES));
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
  // El id del documento ES el token: permite que la página pública /alta lo
  // lea por id (get) sin poder listar la colección, lo que mantiene seguros
  // los tokens del resto de emprendedores bajo las reglas de Firestore.
  const token = nuevoToken();
  const datos = {
    nombre: nombre.trim(),
    contacto: contacto.trim(),
    telefono: telefono.trim(),
    token,
    prefijo: pref,
    productosCount: 0,
    creadoEn: Date.now(),
  };
  await setDoc(tdoc(EMPRENDEDORES, token), datos);
  return { id: token, ...datos };
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
  await setDoc(tdoc(EMPRENDEDORES, id), datos, { merge: true });
}

// Elimina un emprendedor. Sus productos permanecen en el catálogo.
export async function eliminarEmprendedor(id: string): Promise<void> {
  await deleteDoc(tdoc(EMPRENDEDORES, id));
}

export async function getEmprendedorPorToken(
  token: string
): Promise<Emprendedor | null> {
  // El id del documento es el token: lectura directa por id (sin listar).
  const snap = await getDoc(tdoc(EMPRENDEDORES, token.trim()));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Emprendedor, "id">) };
}

// El emprendedor agrega un producto: se crea en el stock real con código único.
export async function agregarProductoEmprendedor(
  emp: Emprendedor,
  datos: { descripcion: string; precio: number; costo?: number; stock?: number }
): Promise<string> {
  const db = getDb();
  const empRef = tdoc(EMPRENDEDORES, emp.id);
  const codigo = await runTransaction(db, async (tx) => {
    const s = await tx.get(empRef);
    const n = (s.exists() ? (s.data().productosCount as number) || 0 : 0) + 1;
    const cod = `${emp.prefijo}-${String(n).padStart(4, "0")}`;
    tx.update(empRef, { productosCount: n });
    tx.set(tdoc(PRODUCTOS, cod), {
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
  const q = query(tcol(PRODUCTOS), where("emprendedorId", "==", empId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Producto);
}

export async function ultimasVentas(max = 20): Promise<Venta[]> {
  const q = query(tcol(VENTAS), orderBy("creadoEn", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Venta);
}

// Ventas dentro de un rango de tiempo [desde, hasta] en epoch ms (para el CRM).
// Rango + orden sobre el mismo campo no requiere índice compuesto.
export async function ventasEnRango(desde: number, hasta: number): Promise<Venta[]> {
  const q = query(
    tcol(VENTAS),
    where("creadoEn", ">=", desde),
    where("creadoEn", "<=", hasta),
    orderBy("creadoEn", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Venta);
}

// ===== Metas de venta (configuración del CRM) =====
// Se guarda una meta diaria; el CRM la escala por la cantidad de días del
// periodo (semana, mes, etc.). Documento único config/metas.

export async function getMetaDiaria(): Promise<number> {
  const snap = await getDoc(tdoc(CONFIG, "metas"));
  return snap.exists() ? Number(snap.data().diaria) || 0 : 0;
}

export async function guardarMetaDiaria(diaria: number): Promise<void> {
  await setDoc(
    tdoc(CONFIG, "metas"),
    { diaria: Math.max(0, Math.round(diaria || 0)), actualizado: Date.now() },
    { merge: true }
  );
}

// Correlativo EN-### para documentos de entrada.
export async function siguienteNroEntrada(): Promise<string> {
  const db = getDb();
  const ref = tdoc(CONTADORES, "entradas");
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
    batch.set(doc(tcol(ENTRADAS)), {
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
      tdoc(PRODUCTOS, cod),
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
  const q = query(tcol(ENTRADAS), orderBy("creadoEn", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Entrada);
}

export type { Entrada, LineaEntrada, LineaVenta, Producto, Venta };
