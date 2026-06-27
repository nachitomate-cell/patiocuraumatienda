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
  onSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { getNegocioId, onCambioNegocio } from "./tenant";
import {
  subtotalLinea,
  type AnulacionInfo,
  type Caja,
  type Cliente,
  type Devolucion,
  type DevolucionCaja,
  type Emprendedor,
  type Entrada,
  type LineaEntrada,
  type LineaVenta,
  type MovimientoEmprendedor,
  type MovimientoFiado,
  type Producto,
  type Retiro,
  type Venta,
} from "./types";
import type { BoletaConfig } from "./negocio";

const NEGOCIOS = "negocios";
const PRODUCTOS = "productos";
const VENTAS = "ventas";
const ENTRADAS = "entradas";
const CLIENTES = "clientes";
const EMPRENDEDORES = "emprendedores";
const CONTADORES = "contadores";
const CONFIG = "config";
const CAJAS = "cajas";
const DEVOLUCIONES = "devoluciones";
const MOVIMIENTOS_EMP = "movimientos";

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

// Ajuste manual de un producto (stock, precio o costo). Si el producto pertenece
// a un emprendedor, deja registro en su bitácora con el actor que lo cambió.
export async function ajustarProducto(
  codigo: string,
  cambios: Partial<Producto>,
  quien = ""
): Promise<void> {
  const cod = codigo.trim();
  const ref = tdoc(PRODUCTOS, cod);
  // Snapshot anterior para comparar y registrar (si pertenece a un emprendedor).
  const snapAntes = await getDoc(ref);
  const antes = snapAntes.exists() ? (snapAntes.data() as Producto) : null;
  await setDoc(ref, cambios, { merge: true });
  parchearProducto(cod, cambios);

  if (!antes?.emprendedorId) return;
  const empId = antes.emprendedorId;
  const ahora = Date.now();
  const por = quien || "Admin";
  const desc = (cambios.descripcion ?? antes.descripcion) || "";

  if (cambios.precio !== undefined && Number(cambios.precio) !== Number(antes.precio ?? 0)) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen: "admin",
      accion: "precio_cambiado",
      codigo: cod, descripcion: desc,
      antes: String(antes.precio ?? 0),
      despues: String(cambios.precio),
    });
  }
  if (cambios.stockActual !== undefined && Number(cambios.stockActual) !== Number(antes.stockActual ?? 0)) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen: "admin",
      accion: "stock_cambiado",
      codigo: cod, descripcion: desc,
      antes: String(antes.stockActual ?? 0),
      despues: String(cambios.stockActual),
    });
  }
  if (cambios.costo !== undefined && Number(cambios.costo) !== Number(antes.costo ?? 0)) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen: "admin",
      accion: "costo_cambiado",
      codigo: cod, descripcion: desc,
      antes: String(antes.costo ?? 0),
      despues: String(cambios.costo),
    });
  }
  if (cambios.descripcion !== undefined && cambios.descripcion !== (antes.descripcion ?? "")) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen: "admin",
      accion: "descripcion_cambiada",
      codigo: cod, descripcion: cambios.descripcion,
      antes: String(antes.descripcion ?? ""),
      despues: String(cambios.descripcion),
    });
  }
  if (cambios.barcode !== undefined && (cambios.barcode ?? "") !== (antes.barcode ?? "")) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen: "admin",
      accion: "barcode_cambiado",
      codigo: cod, descripcion: desc,
      antes: String(antes.barcode ?? ""),
      despues: String(cambios.barcode ?? ""),
    });
  }
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
export async function renombrarProducto(
  viejo: string,
  nuevo: string,
  quien = ""
): Promise<void> {
  const db = getDb();
  const codViejo = viejo.trim();
  const codNuevo = nuevo.trim();
  if (!codNuevo) throw new Error("El código no puede quedar vacío.");
  if (codNuevo === codViejo) return;
  const refViejo = tdoc(PRODUCTOS, codViejo);
  const refNuevo = tdoc(PRODUCTOS, codNuevo);
  // Capturamos el doc original fuera de la transacción para conocer el dueño
  // (la transacción solo trae snapViejo a su scope local).
  const snapAntes = await getDoc(refViejo);
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

  const antes = snapAntes.exists() ? (snapAntes.data() as Producto) : null;
  if (antes?.emprendedorId) {
    await registrarMovEmp(antes.emprendedorId, {
      en: Date.now(),
      por: quien || "Admin",
      origen: "admin",
      accion: "codigo_renombrado",
      codigo: codNuevo,
      descripcion: antes.descripcion ?? "",
      antes: codViejo,
      despues: codNuevo,
    });
  }
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

// Correlativo NV-###### atomico mediante un documento contador. Padding a 6
// dígitos para que no se rompa la alineación al pasar las 999 ventas.
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
  return "NV-" + String(n).padStart(6, "0");
}

// Confirma una venta: registra el documento y descuenta stock de forma atomica.
export async function confirmarVenta(
  venta: Omit<Venta, "creadoEn">
): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);

  // Estampa emprendedorId/Nombre en cada línea de catálogo a partir del cache.
  // Esto permite análisis histórico fidedigno: las ventas no dependen del
  // estado actual del producto (que puede haber cambiado de dueño o
  // eliminado). Si el cache está vacío o el producto no se encuentra, la
  // línea queda sin emprendedor (se podrá cruzar al vuelo como fallback).
  const itemsConEmp = venta.items.map((l) => {
    if (l.manual || !l.codigo) return l;
    const p = _catalogo?.find((x) => x.codigo === l.codigo);
    if (!p?.emprendedorId) return l;
    return {
      ...l,
      emprendedorId: p.emprendedorId,
      emprendedorNombre: p.emprendedorNombre ?? "",
    };
  });
  const total = itemsConEmp.reduce((s, l) => s + subtotalLinea(l), 0);

  batch.set(tdoc(VENTAS, venta.nro), {
    ...venta,
    items: itemsConEmp,
    total,
    creadoEn: Date.now(),
  });

  for (const l of itemsConEmp) {
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

// ===== Bitácora del emprendedor =====
// Cada cambio sobre un producto del emprendedor o sobre su ficha se asienta
// como un documento en negocios/{slug}/emprendedores/{id}/movimientos. Lo
// consumen el portal del emprendedor (/alta/{token}) y el CRM (historial por
// emprendedor). No bloquea la operación si falla: el log es accesorio.

async function registrarMovEmp(
  empId: string,
  datos: MovimientoEmprendedor
): Promise<void> {
  if (!empId) return;
  // Firestore rechaza undefined. Limpiamos antes de persistir.
  const limpio: Record<string, unknown> = { ...datos };
  for (const k of Object.keys(limpio)) {
    if (limpio[k] === undefined) delete limpio[k];
  }
  try {
    await addDoc(tcol(EMPRENDEDORES, empId, MOVIMIENTOS_EMP), limpio);
  } catch {
    // No interrumpe el flujo del usuario si el log falla (red, permisos, etc.).
  }
}

export async function movimientosDeEmprendedor(
  empId: string,
  max = 200
): Promise<MovimientoEmprendedor[]> {
  if (!empId) return [];
  const q = query(
    tcol(EMPRENDEDORES, empId, MOVIMIENTOS_EMP),
    orderBy("en", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as MovimientoEmprendedor);
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
  prefijo = "",
  quien = ""
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
  await registrarMovEmp(token, {
    en: Date.now(),
    por: quien || "Admin",
    origen: "admin",
    accion: "emprendedor_creado",
    despues: `${datos.nombre} (${pref})`,
  });
  return { id: token, ...datos };
}

// Edita los datos de un emprendedor. Si cambia el prefijo, valida unicidad.
export async function actualizarEmprendedor(
  id: string,
  cambios: Partial<Pick<Emprendedor, "nombre" | "contacto" | "telefono" | "prefijo">>,
  quien = ""
): Promise<void> {
  // Snapshot anterior para registrar cambios efectivos campo por campo.
  const snapAntes = await getDoc(tdoc(EMPRENDEDORES, id));
  const antes = snapAntes.exists() ? (snapAntes.data() as Emprendedor) : null;

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

  // Una entrada por campo realmente modificado: lo que NO cambió no se loguea.
  const ahora = Date.now();
  const por = quien || "Admin";
  const campos: Array<["nombre" | "contacto" | "telefono" | "prefijo", string]> = [
    ["nombre", "nombre"],
    ["contacto", "contacto"],
    ["telefono", "teléfono"],
    ["prefijo", "prefijo"],
  ];
  for (const [k, label] of campos) {
    if (!(k in datos)) continue;
    const a = (antes?.[k] as string | undefined) ?? "";
    const b = datos[k] ?? "";
    if (a === b) continue;
    await registrarMovEmp(id, {
      en: ahora,
      por,
      origen: "admin",
      accion: "emprendedor_editado",
      descripcion: label,
      antes: a,
      despues: b,
    });
  }
}

// Elimina un emprendedor. Sus productos permanecen en el catálogo.
export async function eliminarEmprendedor(id: string): Promise<void> {
  await deleteDoc(tdoc(EMPRENDEDORES, id));
}

// Marca un emprendedor como activo o inactivo. Inactivo: NO puede cargar más
// productos desde /alta/{token} y se separa visualmente en /emprendedores.
// Sus productos en el catálogo siguen vivos (no se tocan).
export async function setEmprendedorActivo(
  id: string,
  activo: boolean,
  quien = ""
): Promise<void> {
  await setDoc(tdoc(EMPRENDEDORES, id), { activo }, { merge: true });
  await registrarMovEmp(id, {
    en: Date.now(),
    por: quien || "Admin",
    origen: "admin",
    accion: activo ? "emprendedor_activado" : "emprendedor_pausado",
  });
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
// origen distingue si lo cargó el propio emprendedor (/alta) o un admin (POS).
export async function agregarProductoEmprendedor(
  emp: Emprendedor,
  datos: { descripcion: string; precio: number; costo?: number; stock?: number; vence?: string },
  origen: "emprendedor" | "admin" = "emprendedor",
  quien = ""
): Promise<string> {
  const db = getDb();
  const empRef = tdoc(EMPRENDEDORES, emp.id);
  const vence = (datos.vence || "").trim();
  const codigo = await runTransaction(db, async (tx) => {
    const s = await tx.get(empRef);
    const n = (s.exists() ? (s.data().productosCount as number) || 0 : 0) + 1;
    const cod = `${emp.prefijo}-${String(n).padStart(4, "0")}`;
    tx.update(empRef, { productosCount: n });
    const docProd: Record<string, unknown> = {
      codigo: cod,
      descripcion: datos.descripcion.trim(),
      precio: datos.precio,
      costo: datos.costo ?? 0,
      stockActual: datos.stock ?? 0,
      emprendedorId: emp.id,
      emprendedorNombre: emp.nombre,
      creadoEn: Date.now(),
    };
    if (vence) docProd.vence = vence;
    tx.set(tdoc(PRODUCTOS, cod), docProd);
    return cod;
  });
  invalidarCatalogo(); // producto nuevo en el catálogo
  await registrarMovEmp(emp.id, {
    en: Date.now(),
    por: quien || (origen === "emprendedor" ? emp.nombre : "Admin"),
    origen,
    accion: "producto_agregado",
    codigo,
    descripcion: datos.descripcion.trim(),
    despues:
      `precio ${datos.precio} · stock ${datos.stock ?? 0}` +
      (vence ? ` · vence ${vence}` : ""),
  });
  return codigo;
}

// Productos de un emprendedor. Hace DOS lecturas y deduplica:
//  1) por campo emprendedorId (productos nuevos, estampados en alta).
//  2) por prefijo del código (productos legacy que jamás tuvieron el campo:
//     por la migración inicial el catálogo no traía emprendedorId; el doc
//     emprendedor se creó después, así que la query por campo devuelve 0).
// Tomar la unión permite que un emprendedor recién enrolado vea sus productos
// históricos al toque, sin necesidad de un backfill separado.
export async function productosDeEmprendedor(
  emp: { id: string; prefijo: string }
): Promise<Producto[]> {
  // Truco de prefix match en Firestore: rango [start, end] cubre todo lo que
  // empieza con `${prefijo}-`. end usa 0xF8FF como sentinel, mayor que
  // cualquier carácter ASCII normal.
  const start = `${emp.prefijo}-`;
  const end = `${emp.prefijo}-${String.fromCharCode(0xf8ff)}`;
  const [porIdSnap, porPrefijoSnap] = await Promise.all([
    getDocs(query(tcol(PRODUCTOS), where("emprendedorId", "==", emp.id))),
    getDocs(
      query(tcol(PRODUCTOS), where("codigo", ">=", start), where("codigo", "<=", end))
    ),
  ]);
  const map = new Map<string, Producto>();
  for (const d of porIdSnap.docs) {
    const p = d.data() as Producto;
    map.set(p.codigo, p);
  }
  for (const d of porPrefijoSnap.docs) {
    const p = d.data() as Producto;
    if (!map.has(p.codigo)) map.set(p.codigo, p);
  }
  return Array.from(map.values());
}


// Actualiza campos editables (precio/stock/descripción) de un producto del
// emprendedor desde el flujo /alta/{token}. Valida que el producto pertenezca
// al emprendedor: las reglas de Firestore aceptan escritura de cualquier
// signedIn anónimo, así que esta verificación es defensa en profundidad
// contra bugs de UI, no contra atacantes (un atacante con curl haría lo mismo).
export async function actualizarProductoEmprendedor(
  empId: string,
  codigo: string,
  cambios: { precio?: number; stockActual?: number; descripcion?: string; vence?: string },
  origen: "emprendedor" | "admin" = "emprendedor",
  quien = ""
): Promise<void> {
  const cod = codigo.trim();
  if (!cod) throw new Error("Falta el código del producto.");
  const ref = tdoc(PRODUCTOS, cod);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("El producto no existe.");
  const p = snap.data() as Producto;
  if (p.emprendedorId !== empId) {
    throw new Error("Este producto no pertenece a este emprendedor.");
  }
  const limpio: Record<string, unknown> = {};
  if (cambios.descripcion !== undefined) {
    const d = cambios.descripcion.trim();
    if (!d) throw new Error("La descripción no puede quedar vacía.");
    limpio.descripcion = d;
  }
  if (cambios.precio !== undefined) {
    limpio.precio = Math.max(0, Math.round(cambios.precio || 0));
  }
  if (cambios.stockActual !== undefined) {
    limpio.stockActual = Math.max(0, Math.round(cambios.stockActual || 0));
  }
  if (cambios.vence !== undefined) {
    // String vacío => limpiar el campo (se persiste como "" y la UI lo trata
    // como "sin vence"). No usamos deleteField para no complicar el merge.
    limpio.vence = (cambios.vence || "").trim();
  }
  if (Object.keys(limpio).length === 0) return;
  await setDoc(ref, limpio, { merge: true });
  parchearProducto(cod, limpio as Partial<Producto>);

  // Una entrada por campo realmente modificado (comparamos contra snapshot).
  const ahora = Date.now();
  const por = quien || (origen === "emprendedor" ? p.emprendedorNombre || "Emprendedor" : "Admin");
  if ("descripcion" in limpio && (limpio.descripcion as string) !== (p.descripcion ?? "")) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen,
      accion: "descripcion_cambiada",
      codigo: cod,
      descripcion: limpio.descripcion as string,
      antes: String(p.descripcion ?? ""),
      despues: String(limpio.descripcion),
    });
  }
  if ("precio" in limpio && (limpio.precio as number) !== (p.precio ?? 0)) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen,
      accion: "precio_cambiado",
      codigo: cod,
      descripcion: (limpio.descripcion as string) ?? p.descripcion,
      antes: String(p.precio ?? 0),
      despues: String(limpio.precio),
    });
  }
  if ("stockActual" in limpio && (limpio.stockActual as number) !== (p.stockActual ?? 0)) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen,
      accion: "stock_cambiado",
      codigo: cod,
      descripcion: (limpio.descripcion as string) ?? p.descripcion,
      antes: String(p.stockActual ?? 0),
      despues: String(limpio.stockActual),
    });
  }
  if ("vence" in limpio && (limpio.vence as string) !== (p.vence ?? "")) {
    await registrarMovEmp(empId, {
      en: ahora, por, origen,
      accion: "vencimiento_cambiado",
      codigo: cod,
      descripcion: (limpio.descripcion as string) ?? p.descripcion,
      antes: String(p.vence ?? ""),
      despues: String(limpio.vence),
    });
  }
}

// Ventas que tienen al menos una línea de este emprendedor (filtra las
// líneas para devolver solo lo del emprendedor). Lee las últimas N ventas y
// filtra cliente-side: suficiente para un POS chico; si crece, conviene una
// segunda colección indexada por emprendedor o un campo emprendedorIds en la
// venta (array) con un índice.
//
// Doble match (igual que productosDeEmprendedor): el emprendedorId estampado
// en la línea, O el prefijo del código. Esto cubre las ventas históricas
// hechas antes de que existiera el doc del emprendedor.
export async function ventasDeEmprendedor(
  emp: { id: string; prefijo: string },
  max = 500
): Promise<Venta[]> {
  const vs = await ultimasVentas(max);
  const pref = `${emp.prefijo}-`;
  return vs
    .map((v) => ({
      ...v,
      items: v.items.filter(
        (l) =>
          l.emprendedorId === emp.id ||
          (!!l.codigo && l.codigo.startsWith(pref))
      ),
    }))
    .filter((v) => v.items.length > 0);
}

// Asigna o reemplaza el código de boleta de una venta ya registrada. Pasar
// string vacío borra el código (lo deja como undefined en la lectura).
export async function actualizarCodigoBoleta(
  nro: string,
  codigo: string
): Promise<void> {
  const cod = (codigo || "").trim();
  await setDoc(tdoc(VENTAS, nro), { codigoBoleta: cod }, { merge: true });
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

// ===== Configuración de la boleta =====
// Vive como sub-doc del negocio (negocios/{slug}/config/boleta) en vez del doc
// negocios/{slug}, para que cualquier usuario signedIn (anónimo del POS) pueda
// editarla. El doc del negocio en sí queda restringido a moderador en las
// reglas (branding, logo: vandalismo > comodidad).
//
// Compatibilidad hacia atrás: si el doc del negocio aún trae boleta inline
// (datos viejos), negocio-context.tsx lo usa como fallback.
export async function getBoletaConfig(slug: string): Promise<BoletaConfig | null> {
  const ref = doc(getDb(), NEGOCIOS, slug, CONFIG, "boleta");
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as BoletaConfig;
}

export async function guardarBoletaConfig(slug: string, cfg: BoletaConfig): Promise<void> {
  const limpio: Record<string, unknown> = { ...cfg };
  if (typeof limpio.mensajeSuperior === "string") {
    limpio.mensajeSuperior = (limpio.mensajeSuperior as string).trim();
  }
  if (typeof limpio.mensajeInferior === "string") {
    limpio.mensajeInferior = (limpio.mensajeInferior as string).trim();
  }
  if (typeof limpio.textoGracias === "string") {
    limpio.textoGracias = (limpio.textoGracias as string).trim();
  }
  // Firestore no acepta undefined: limpio.
  for (const k of Object.keys(limpio)) {
    if (limpio[k] === undefined) delete limpio[k];
  }
  await setDoc(doc(getDb(), NEGOCIOS, slug, CONFIG, "boleta"), limpio, { merge: true });
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

// ===== Caja (turno) =====
// Convención: solo puede haber UNA caja abierta a la vez. Las funciones de
// apertura validan ese invariante; el cierre solo afecta a la caja abierta.

// Devuelve la caja abierta del negocio, si existe.
export async function cajaAbierta(): Promise<Caja | null> {
  const q = query(
    tcol(CAJAS),
    where("cerradaEn", "==", null),
    orderBy("aperturaEn", "desc"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<Caja, "id">) };
}

// Se suscribe en vivo a la caja abierta del negocio. cb recibe la caja actual
// (o null si no hay ninguna). Devuelve un unsubscribe que detiene el listener.
// Sirve para que aperturas/cierres hechos en otro PC se vean al instante en
// todas las pantallas conectadas.
export function escucharCajaAbierta(cb: (c: Caja | null) => void): () => void {
  const q = query(
    tcol(CAJAS),
    where("cerradaEn", "==", null),
    orderBy("aperturaEn", "desc"),
    limit(1)
  );
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) return cb(null);
      const d = snap.docs[0];
      cb({ id: d.id, ...(d.data() as Omit<Caja, "id">) });
    },
    () => cb(null)
  );
}

// Abre una caja nueva. Falla si ya hay una abierta.
export async function abrirCaja(
  fondoInicial: number,
  umbralRetiro: number,
  vendedor: string
): Promise<Caja> {
  const actual = await cajaAbierta();
  if (actual) {
    throw new Error("Ya hay una caja abierta. Ciérrala antes de abrir otra.");
  }
  const datos: Omit<Caja, "id"> = {
    aperturaEn: Date.now(),
    cerradaEn: null,
    fondoInicial: Math.max(0, Math.round(fondoInicial || 0)),
    umbralRetiro: Math.max(0, Math.round(umbralRetiro || 0)),
    retiros: [],
    abridoPor: vendedor || "",
  };
  const ref = await addDoc(tcol(CAJAS), datos);
  return { id: ref.id, ...datos };
}

// Registra un retiro (salida de efectivo). Solo aplica si la caja sigue
// abierta: actualiza el array de retiros de forma transaccional.
export async function registrarRetiro(cajaId: string, retiro: Retiro): Promise<void> {
  const db = getDb();
  const ref = tdoc(CAJAS, cajaId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("La caja no existe.");
    const c = snap.data() as Caja;
    if (c.cerradaEn) throw new Error("La caja ya está cerrada.");
    const retiros = [...(c.retiros ?? []), retiro];
    tx.update(ref, { retiros });
  });
}

// Cierra la caja: guarda lo contado, calcula la diferencia y la archiva.
export async function cerrarCaja(
  cajaId: string,
  cierreContado: number,
  esperado: number,
  vendedor: string,
  notas = ""
): Promise<void> {
  const db = getDb();
  const ref = tdoc(CAJAS, cajaId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("La caja no existe.");
    const c = snap.data() as Caja;
    if (c.cerradaEn) throw new Error("La caja ya está cerrada.");
    tx.update(ref, {
      cerradaEn: Date.now(),
      cierreContado: Math.max(0, Math.round(cierreContado || 0)),
      diferencia: Math.round((cierreContado || 0) - esperado),
      cerradoPor: vendedor || "",
      notas: notas.trim(),
    });
  });
}

export async function ultimasCajas(max = 30): Promise<Caja[]> {
  const q = query(tcol(CAJAS), orderBy("aperturaEn", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Caja, "id">) }));
}

// ===== Anulación de venta =====
// Distinta de la devolución: anula la venta entera (típicamente por error
// del cajero) en lugar de revertir productos puntuales. No borra el documento
// (los correlativos quedan); le pone un bloque "anulada" y revierte todos
// los efectos colaterales en el mismo batch:
//  - re-incrementa stock de las líneas con código,
//  - si era fiado: abona la deuda del cliente por el total,
//  - si era efectivo: egresa AN-NV-XXX en la caja abierta (igual estructura
//    que una devolución: comparten el array devoluciones[] de la caja).
//
// Lanza error si: la venta ya está anulada, tiene devoluciones previas (que
// las gestione el llamador), o era efectivo y no hay caja abierta.
export async function anularVenta(
  venta: Venta,
  motivo: string,
  vendedor: string
): Promise<void> {
  if (venta.anulada) throw new Error("Esta venta ya está anulada.");
  const tieneDev = await devolucionesDeVenta(venta.nro);
  if (tieneDev.length > 0) {
    throw new Error(
      "Esta venta tiene devoluciones registradas. Anular no es posible: revierte las devoluciones primero o trabaja sólo con devoluciones."
    );
  }

  let cajaSnap: Caja | null = null;
  if (venta.medioPago === "efectivo") {
    cajaSnap = await cajaAbierta();
    if (!cajaSnap) {
      throw new Error("Para anular una venta en efectivo primero abre la caja.");
    }
  }
  if (venta.medioPago === "fiado" && !venta.clienteId) {
    throw new Error("La venta a fiado no tiene cliente asociado: no se puede revertir la deuda.");
  }

  const ahora = Date.now();
  const db = getDb();
  const batch = writeBatch(db);

  const info: AnulacionInfo = {
    en: ahora,
    por: vendedor || "",
    motivo: (motivo || "").trim(),
  };
  batch.update(tdoc(VENTAS, venta.nro), { anulada: info });

  // Reingresa stock por línea (los manuales no tienen producto en catálogo).
  for (const l of venta.items) {
    if (l.manual || !l.codigo) continue;
    batch.update(tdoc(PRODUCTOS, l.codigo), {
      stockActual: increment(l.cantidad),
    });
  }

  if (venta.medioPago === "fiado" && venta.clienteId) {
    batch.set(doc(tcol(CLIENTES, venta.clienteId, "movimientos")), {
      tipo: "abono",
      monto: venta.total,
      fecha: hoy(),
      ventaNro: venta.nro,
      nota: `Anulación ${venta.nro}`,
      creadoEn: ahora,
    });
    batch.update(tdoc(CLIENTES, venta.clienteId), {
      saldo: increment(-venta.total),
    });
  }

  if (cajaSnap) {
    const entrada: DevolucionCaja = {
      nro: `AN-${venta.nro}`,
      ventaNro: venta.nro,
      monto: venta.total,
      hora: ahora,
      motivo: `Anulación: ${info.motivo}`,
      vendedor: vendedor || "",
    };
    batch.update(tdoc(CAJAS, cajaSnap.id), {
      devoluciones: [...(cajaSnap.devoluciones ?? []), entrada],
    });
  }

  await batch.commit();
  invalidarCatalogo();
  if (venta.medioPago === "fiado") invalidarClientes();
}

// ===== Devoluciones =====
// Una devolución es un documento aparte que referencia la venta original
// (ventaNro). NUNCA mutamos la venta: las comisiones, el historial y los
// reportes siguen viendo la venta original íntegra, y restan/cruzan las
// devoluciones para los netos.

export async function siguienteNroDevolucion(): Promise<string> {
  const db = getDb();
  const ref = tdoc(CONTADORES, "devoluciones");
  const n = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.exists() ? (snap.data().ultimo as number) : 0;
    const siguiente = actual + 1;
    tx.set(ref, { ultimo: siguiente }, { merge: true });
    return siguiente;
  });
  return "DV-" + String(n).padStart(3, "0");
}

// Registra una devolución contra una venta existente. Reaplica los efectos
// del cobro en reverso, todo en el mismo batch para mantener consistencia:
//  - re-incrementa stock de las líneas con código (las manuales se ignoran),
//  - si la venta era fiado: baja la deuda del cliente y deja "abono",
//  - si era efectivo: asienta el egreso en caja.devoluciones[],
//  - debito/credito/transferencia: solo deja registro.
// Lanza error si el medio era efectivo y no hay caja abierta.
export async function registrarDevolucion(
  input: Omit<Devolucion, "nro" | "creadoEn" | "total" | "cajaId">
): Promise<string> {
  if (!input.items.length) throw new Error("La devolución no tiene líneas.");
  for (const l of input.items) {
    if (l.cantidad <= 0) throw new Error("Las cantidades deben ser mayores a cero.");
  }

  const total = input.items.reduce((s, l) => s + subtotalLinea(l), 0);
  const ahora = Date.now();

  // Efectivo necesita caja abierta. Para el resto de medios, cajaSnap == null.
  let cajaSnap: Caja | null = null;
  if (input.medioPagoOriginal === "efectivo") {
    cajaSnap = await cajaAbierta();
    if (!cajaSnap) {
      throw new Error("Para devolver en efectivo primero abre la caja.");
    }
  }

  if (input.medioPagoOriginal === "fiado" && !input.clienteId) {
    throw new Error("La venta a fiado no tiene cliente asociado: no se puede revertir la deuda.");
  }

  const nro = await siguienteNroDevolucion();
  const db = getDb();
  const batch = writeBatch(db);

  // Firestore rechaza valores undefined. clienteId puede llegar undefined
  // cuando la venta no era a fiado: limpiamos las keys con valor undefined
  // antes de persistir, en vez de forzar null/empty (mantenemos el optional).
  const devolucion: Record<string, unknown> = {
    ...input,
    nro,
    total,
    creadoEn: ahora,
    cajaId: cajaSnap?.id ?? "",
  };
  for (const k of Object.keys(devolucion)) {
    if (devolucion[k] === undefined) delete devolucion[k];
  }
  batch.set(tdoc(DEVOLUCIONES, nro), devolucion);

  // Reingresa stock por línea (los manuales no tienen producto en catálogo).
  for (const l of input.items) {
    if (l.manual || !l.codigo) continue;
    batch.update(tdoc(PRODUCTOS, l.codigo), {
      stockActual: increment(l.cantidad),
    });
  }

  // Fiado: reduce la deuda del cliente y deja el movimiento como "abono"
  // ligado a la venta original (para que aparezca en su detalle de cuenta).
  if (input.medioPagoOriginal === "fiado" && input.clienteId) {
    batch.set(doc(tcol(CLIENTES, input.clienteId, "movimientos")), {
      tipo: "abono",
      monto: total,
      fecha: input.fecha,
      ventaNro: input.ventaNro,
      nota: `Devolución ${nro}`,
      creadoEn: ahora,
    });
    batch.update(tdoc(CLIENTES, input.clienteId), {
      saldo: increment(-total),
    });
  }

  // Efectivo: append al array devoluciones[] de la caja abierta. Optimista:
  // se lee la caja antes del batch; si otra escritura concurrente modificó el
  // array entre la lectura y el commit, la pisamos (riesgo aceptable en POS
  // de un solo cajero). Para el caso multi-cajero conviene runTransaction.
  if (cajaSnap) {
    const entrada: DevolucionCaja = {
      nro,
      ventaNro: input.ventaNro,
      monto: total,
      hora: ahora,
      motivo: input.motivo || "",
      vendedor: input.vendedor || "",
    };
    batch.update(tdoc(CAJAS, cajaSnap.id), {
      devoluciones: [...(cajaSnap.devoluciones ?? []), entrada],
    });
  }

  await batch.commit();

  invalidarCatalogo();
  if (input.medioPagoOriginal === "fiado") invalidarClientes();
  return nro;
}

// Devoluciones de una venta puntual (orden indefinido, suelen ser 1-2).
export async function devolucionesDeVenta(ventaNro: string): Promise<Devolucion[]> {
  const q = query(tcol(DEVOLUCIONES), where("ventaNro", "==", ventaNro));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Devolucion);
}

// Devoluciones recientes (para mostrar badges en el historial sin N+1).
export async function ultimasDevoluciones(max = 300): Promise<Devolucion[]> {
  const q = query(tcol(DEVOLUCIONES), orderBy("creadoEn", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Devolucion);
}

// Devoluciones en un rango de tiempo (para el cierre de caja y reportes).
export async function devolucionesEnRango(desde: number, hasta: number): Promise<Devolucion[]> {
  const q = query(
    tcol(DEVOLUCIONES),
    where("creadoEn", ">=", desde),
    where("creadoEn", "<=", hasta),
    orderBy("creadoEn", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Devolucion);
}

export type { Caja, Devolucion, DevolucionCaja, Entrada, LineaEntrada, LineaVenta, Producto, Retiro, Venta };
