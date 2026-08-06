import {
  collection,
  collectionGroup,
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
  deleteField,
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
  type IngresoEmprendedor,
  type LineaEntrada,
  type LineaVenta,
  type MedioPago,
  type MovimientoEmprendedor,
  type MovimientoFiado,
  type Producto,
  type Retiro,
  type Venta,
  type VerificacionMov,
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
// Cache del listado de emprendedores: se usa en /historial para enriquecer
// los movimientos del collectionGroup con nombre/prefijo sin relistar la
// colección en cada refresh. Invalidado por crear/editar/eliminar/activar.
let _emprendedores: Emprendedor[] | null = null;

// Al cambiar de negocio, el cache deja de ser válido: se descarta.
onCambioNegocio(() => {
  _catalogo = null;
  _clientes = null;
  _emprendedores = null;
});

function invalidarCatalogo(): void {
  _catalogo = null;
}

function invalidarClientes(): void {
  _clientes = null;
}

function invalidarEmprendedores(): void {
  _emprendedores = null;
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
// y, si no existe, por el campo código de barras (EAN/UPC). Los productos
// soft-deleted (`eliminado === true`) se ocultan: el cajero no puede tocarlos.
export async function buscarParaVenta(valor: string): Promise<Producto | null> {
  const v = valor.trim();
  if (!v) return null;
  // Si el catálogo ya está en memoria, resolver sin tocar la red (0 lecturas).
  if (_catalogo) {
    const enCache = _catalogo.find((p) => p.codigo === v || p.barcode === v);
    if (enCache) return enCache;
  }
  const directo = await getProducto(v);
  if (directo && !directo.eliminado) return directo;
  const q = query(tcol(PRODUCTOS), where("barcode", "==", v), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const p = snap.docs[0].data() as Producto;
  return p.eliminado ? null : p;
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
  return snap.docs
    .map((d) => d.data() as Producto)
    .filter((p) => !p.eliminado);
}

// ===== Cache persistente del catálogo (localStorage) + sync delta =====
// El catálogo completo (3.500+ docs) era la lectura más cara del sistema:
// cada carga de página del POS pagaba la colección entera. Ahora el catálogo
// vive en localStorage (clave por negocio) y al abrir sesión solo se piden
// los productos con actualizadoEn posterior a la última sincronización
// (todas las escrituras de producto estampan ese campo). Un doc config
// (config/catalogo.recargaEn) marca los eventos que el delta no puede ver
// —renombrados, que borran documentos físicamente— y fuerza recarga total.
//
// Los docs que nunca han cambiado desde su carga inicial no tienen
// actualizadoEn: el where(">") simplemente no los devuelve, que es lo
// correcto (no cambiaron).
type CacheCatalogo = { sync: number; productos: Producto[] };

function claveCacheCatalogo(): string {
  return `pc:catalogo:v1:${getNegocioId()}`;
}

function leerCacheCatalogo(): CacheCatalogo | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(claveCacheCatalogo());
    if (!raw) return null;
    const c = JSON.parse(raw) as CacheCatalogo;
    if (!c || typeof c.sync !== "number" || !Array.isArray(c.productos)) return null;
    return c;
  } catch {
    return null;
  }
}

function guardarCacheCatalogo(productos: Producto[], sync: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(claveCacheCatalogo(), JSON.stringify({ sync, productos }));
  } catch {
    // Cuota llena o modo privado: se sigue sin cache persistente.
  }
}

// Marca que hubo un borrado físico de documentos de producto (renombrar un
// código crea doc nuevo y borra el viejo). Los caches delta no pueden
// enterarse de un doc que desapareció; con esta marca, la próxima
// sincronización de cada dispositivo hace recarga completa. Best-effort.
async function marcarRecargaCatalogo(): Promise<void> {
  try {
    await setDoc(tdoc(CONFIG, "catalogo"), { recargaEn: Date.now() }, { merge: true });
  } catch {
    // no-op: en el peor caso un cache queda viejo hasta su Refrescar manual.
  }
}

// Sincroniza el cache local con Firestore leyendo SOLO lo que cambió.
// Devuelve null si corresponde recarga completa (marca de recarga, error).
async function sincronizarCatalogo(cache: CacheCatalogo): Promise<Producto[] | null> {
  try {
    // 1 lectura: ¿hubo renombrados desde la última sync?
    const meta = await getDoc(tdoc(CONFIG, "catalogo"));
    const recargaEn = meta.exists() ? (meta.data().recargaEn as number) || 0 : 0;
    if (recargaEn > cache.sync) return null;

    // Margen de 60 min contra relojes desfasados entre dispositivos (todas
    // las escrituras estampan actualizadoEn con Date.now() local). Releer
    // un puñado de docs recientes es barato; perder una escritura no.
    const desde = cache.sync - 60 * 60 * 1000;
    const snap = await getDocs(
      query(tcol(PRODUCTOS), where("actualizadoEn", ">", desde))
    );
    const porCodigo = new Map(cache.productos.map((p) => [p.codigo, p]));
    for (const d of snap.docs) {
      const p = d.data() as Producto;
      const k = p.codigo || d.id;
      if (p.eliminado) porCodigo.delete(k);
      else porCodigo.set(k, p);
    }
    const lista = Array.from(porCodigo.values());
    guardarCacheCatalogo(lista, Date.now());
    return lista;
  } catch {
    return null;
  }
}

// Carga todo el catalogo (para el panel de inventario y el buscador de venta).
// Cacheado en memoria por sesión y en localStorage entre sesiones; ver el
// bloque de sync delta arriba. `force` fuerza relectura completa (Refrescar).
// Excluye productos soft-deleted (`eliminado === true`): las ventas históricas
// siguen intactas pero el POS y el stock ya no los ven.
export async function todosLosProductos(force = false): Promise<Producto[]> {
  if (_catalogo && !force) return _catalogo;

  if (!force) {
    const cache = leerCacheCatalogo();
    if (cache) {
      const sincronizado = await sincronizarCatalogo(cache);
      if (sincronizado) {
        _catalogo = sincronizado;
        return _catalogo;
      }
    }
  }

  const snap = await getDocs(tcol(PRODUCTOS));
  const ahora = Date.now();
  _catalogo = snap.docs
    .map((d) => d.data() as Producto)
    .filter((p) => !p.eliminado);
  guardarCacheCatalogo(_catalogo, ahora);
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
  await setDoc(ref, { ...cambios, actualizadoEn: Date.now() }, { merge: true });
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
    tx.set(refNuevo, {
      ...(snapViejo.data() as Producto),
      codigo: codNuevo,
      actualizadoEn: Date.now(),
    });
    tx.delete(refViejo);
  });
  invalidarCatalogo();
  // El delete físico es invisible para los caches delta de otros
  // dispositivos: se marca recarga completa.
  await marcarRecargaCatalogo();

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
      batch.set(tdoc(PRODUCTOS, c.a), {
        ...data,
        codigo: c.a,
        actualizadoEn: Date.now(),
      });
      batch.delete(tdoc(PRODUCTOS, c.de));
    }
    await batch.commit();
    hechos = Math.min(i + CHUNK, cambios.length);
    onProgress?.(hechos, cambios.length);
  }
  invalidarCatalogo();
  // Deletes físicos masivos: los caches delta necesitan recarga completa.
  if (cambios.length > 0) await marcarRecargaCatalogo();
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
      batch.set(
        tdoc(PRODUCTOS, p.codigo),
        { ...p, actualizadoEn: Date.now() },
        { merge: true }
      );
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

  // empKeys: ids de emprendedor y prefijos de código presentes en la venta.
  // Permite que /alta consulte SOLO las ventas del emprendedor
  // (array-contains-any) en vez de leer las últimas 500 del negocio entero.
  // Se guardan ambas llaves porque una línea puede venir sin emprendedorId
  // (cache frío o producto legacy) pero el prefijo siempre está en el código.
  const empKeys = new Set<string>();
  for (const l of itemsConEmp) {
    if (l.emprendedorId) empKeys.add(l.emprendedorId);
    if (!l.manual && l.codigo) {
      const m = String(l.codigo).match(/^([A-Z0-9]+)-/);
      if (m) empKeys.add(`PREF:${m[1]}`);
    }
  }

  batch.set(tdoc(VENTAS, venta.nro), {
    ...venta,
    items: itemsConEmp,
    total,
    empKeys: Array.from(empKeys),
    creadoEn: Date.now(),
  });

  for (const l of itemsConEmp) {
    // Los productos manuales (fuera de catálogo) no existen como documento,
    // así que no se les descuenta stock: actualizarlos rompería el lote.
    if (l.manual || !l.codigo) continue;
    batch.update(tdoc(PRODUCTOS, l.codigo), {
      stockActual: increment(-l.cantidad),
      // Acumulado histórico de unidades vendidas: viaja en el mismo update
      // que el stock, así que no agrega costo. Lo revierten anular/devolver.
      vendidasTotal: increment(l.cantidad),
      actualizadoEn: Date.now(),
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
  // Estampamos el negocioId para poder filtrar todas las bitácoras del tenant
  // desde una sola query con collectionGroup("movimientos"). Sin este campo
  // habría que escanear N emprendedores (una query cada uno) para armar el
  // panel de "Ingresos del día" en /historial.
  limpio.negocioId = getNegocioId();
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

// Solo los movimientos posteriores a `despuesDe` (epoch ms). Para refrescar
// la bitácora tras una acción en /alta leyendo 1-2 docs en vez de volver a
// pagar los 100 más recientes en cada alta/ajuste. where + orderBy sobre el
// mismo campo: no necesita índice compuesto.
export async function movimientosNuevosDeEmprendedor(
  empId: string,
  despuesDe: number,
  max = 50
): Promise<MovimientoEmprendedor[]> {
  if (!empId) return [];
  const q = query(
    tcol(EMPRENDEDORES, empId, MOVIMIENTOS_EMP),
    where("en", ">", despuesDe),
    orderBy("en", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as MovimientoEmprendedor);
}

// El campo `despues` de un producto_agregado se serializa como
// "precio 1234 · stock 5" (con un opcional "· vence YYYY-MM-DD"). Esta
// función extrae los dos números sin depender del orden ni del separador.
function parseDespuesAlta(s: string | undefined): { precio: number; stock: number } {
  const txt = s || "";
  const precioM = txt.match(/precio\s+(-?\d+)/i);
  const stockM = txt.match(/stock\s+(-?\d+)/i);
  return {
    precio: precioM ? Number(precioM[1]) : 0,
    stock: stockM ? Number(stockM[1]) : 0,
  };
}

// Lista los ingresos de stock que cargaron los emprendedores en un rango.
// Estrategia: UNA query collectionGroup sobre todas las bitácoras
// "movimientos" filtrando por negocioId + rango de tiempo. Esto evita el
// patrón anterior de 1+N queries (listar + una por emprendedor), que
// dispara muchas lecturas vacías en negocios con muchos emprendedores que
// no cargaron nada hoy.
//
// Considera dos acciones como ingreso de stock:
//   - producto_agregado: alta de un nuevo SKU (cantidad = stock inicial).
//   - stock_cambiado con delta > 0: el emprendedor declaró "Recibí" más
//     unidades. Si el delta es negativo (retiró) NO cuenta.
//
// Requisitos:
//   - Cada doc en /negocios/{slug}/emprendedores/{id}/movimientos lleva
//     campo negocioId (estampado en registrarMovEmp). Los docs anteriores
//     a este cambio no lo tienen y por eso quedan excluidos del query —
//     no afecta el caso "hoy" que es el principal del panel.
//   - Las reglas de Firestore deben permitir lectura por collectionGroup
//     en /{path=**}/movimientos.
//   - Firestore creará un índice compuesto (negocioId asc, en asc/desc)
//     la primera vez que se ejecute: el error trae el link directo.
export async function ingresosDeEmprendedoresEnRango(
  desde: number,
  hasta: number
): Promise<IngresoEmprendedor[]> {
  const q = query(
    collectionGroup(getDb(), MOVIMIENTOS_EMP),
    where("negocioId", "==", getNegocioId()),
    where("en", ">=", desde),
    where("en", "<=", hasta),
    orderBy("en", "desc")
  );
  const snap = await getDocs(q);

  // Cache de emprendedores para enriquecer nombre/prefijo en cada fila sin
  // tocar la red por cada doc. Si el ingreso pertenece a un emprendedor que
  // ya no existe (eliminado), usamos el id del path como fallback.
  const emps = await listarEmprendedores();
  const empPorId = new Map(emps.map((e) => [e.id, e]));

  const resultados: IngresoEmprendedor[] = [];
  for (const d of snap.docs) {
    const m = d.data() as MovimientoEmprendedor;
    // El padre de la subcolección "movimientos" es el doc del emprendedor.
    const empId = d.ref.parent.parent?.id || "";
    const e = empPorId.get(empId);
    const nombre = e?.nombre || "(emprendedor eliminado)";
    const prefijo = e?.prefijo || "";

    if (m.accion === "producto_agregado") {
      const { precio, stock } = parseDespuesAlta(m.despues);
      resultados.push({
        en: m.en,
        movId: d.id,
        emprendedorId: empId,
        emprendedorNombre: nombre,
        emprendedorPrefijo: prefijo,
        tipo: "alta",
        codigo: m.codigo || "",
        descripcion: m.descripcion || "",
        cantidad: Math.max(0, stock),
        precio,
        por: m.por,
        origen: m.origen,
        verificacion: m.verificacion,
      });
    } else if (m.accion === "stock_cambiado") {
      const antes = Number(m.antes ?? 0);
      const despues = Number(m.despues ?? 0);
      const delta = despues - antes;
      // delta < 0 = el emprendedor retiró unidades. Se incluye porque la
      // auditoría de caja y el comprobante que firma cubren ambos sentidos:
      // lo que trajo y lo que se llevó.
      if (delta !== 0) {
        resultados.push({
          en: m.en,
          movId: d.id,
          emprendedorId: empId,
          emprendedorNombre: nombre,
          emprendedorPrefijo: prefijo,
          tipo: delta > 0 ? "reposicion" : "retiro",
          codigo: m.codigo || "",
          descripcion: m.descripcion || "",
          cantidad: Math.abs(delta),
          por: m.por,
          origen: m.origen,
          verificacion: m.verificacion,
        });
      }
    }
  }
  return resultados;
}

// ===== Auditoría física de movimientos =====
// Caja cuenta lo que el emprendedor trajo/retiró y firma el movimiento. La
// verificación se guarda EN el movimiento original (subcolección movimientos
// del emprendedor), así viaja con la bitácora y el emprendedor puede verla.
//
// cantidadReal: solo cuando lo contado difiere de lo declarado. No corrige el
// stock automáticamente — deja constancia de la diferencia; el ajuste lo hace
// caja explícitamente si corresponde.
export async function verificarMovimiento(
  empId: string,
  movId: string,
  quien: string,
  cantidadReal?: number,
  nota?: string
): Promise<VerificacionMov> {
  if (!empId || !movId) throw new Error("Movimiento inválido.");
  const v: VerificacionMov = {
    en: Date.now(),
    por: quien || "Caja",
  };
  if (cantidadReal !== undefined && Number.isFinite(cantidadReal)) {
    v.cantidadReal = Math.max(0, Math.round(cantidadReal));
  }
  const n = (nota || "").trim();
  if (n) v.nota = n;
  await setDoc(
    tdoc(EMPRENDEDORES, empId, MOVIMIENTOS_EMP, movId),
    { verificacion: v },
    { merge: true }
  );
  return v;
}

// Deshace una verificación (se marcó por error).
export async function desverificarMovimiento(
  empId: string,
  movId: string
): Promise<void> {
  if (!empId || !movId) throw new Error("Movimiento inválido.");
  await setDoc(
    tdoc(EMPRENDEDORES, empId, MOVIMIENTOS_EMP, movId),
    { verificacion: deleteField() },
    { merge: true }
  );
}

// Verifica varios movimientos de una vez (el emprendedor llegó con toda su
// tanda y caja la contó completa). Un batch: 1 escritura por movimiento.
export async function verificarLote(
  items: Array<{ emprendedorId: string; movId: string }>,
  quien: string
): Promise<VerificacionMov> {
  const v: VerificacionMov = { en: Date.now(), por: quien || "Caja" };
  const db = getDb();
  const CHUNK = 400;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const it of items.slice(i, i + CHUNK)) {
      if (!it.emprendedorId || !it.movId) continue;
      batch.set(
        tdoc(EMPRENDEDORES, it.emprendedorId, MOVIMIENTOS_EMP, it.movId),
        { verificacion: v },
        { merge: true }
      );
    }
    await batch.commit();
  }
  return v;
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

export async function listarEmprendedores(force = false): Promise<Emprendedor[]> {
  if (_emprendedores && !force) return _emprendedores;
  const snap = await getDocs(tcol(EMPRENDEDORES));
  _emprendedores = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Emprendedor, "id">) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  return _emprendedores;
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
  invalidarEmprendedores();
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
  invalidarEmprendedores();

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
  invalidarEmprendedores();
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
  invalidarEmprendedores();
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
// codigo (opcional): si viene, se usa el código que el emprendedor escribió en
// vez de auto-generar. Debe normalizar a `${prefijo}-...` y no chocar con un
// código existente. Los códigos manuales NUNCA mueven productosCount: el
// contador sigue solo la secuencia automática, y la auto-generación esquiva
// los códigos manuales consultando lo que realmente existe.
export async function agregarProductoEmprendedor(
  emp: Emprendedor,
  datos: { descripcion: string; precio: number; costo?: number; stock?: number; vence?: string; codigo?: string },
  origen: "emprendedor" | "admin" = "emprendedor",
  quien = "",
  // Códigos que el caller ya tiene en memoria (el inventario cargado en
  // /alta). Evita pagar una query de TODO el prefijo en cada alta: con esta
  // pista + el contador, la auto-generación acierta al primer intento.
  codigosOcupados?: string[]
): Promise<string> {
  const db = getDb();
  const empRef = tdoc(EMPRENDEDORES, emp.id);
  const vence = (datos.vence || "").trim();
  const codigoPedido = (datos.codigo || "").trim();

  // Saneo defensivo antes de tocar Firestore: ambas UIs validan, pero un
  // input type=number permite tipear negativos/decimales y un NaN aquí
  // dejaría un doc corrupto que después revienta buscadores y reportes.
  if (!emp.prefijo) throw new Error("El emprendedor no tiene prefijo asignado.");
  const descLimpia = (datos.descripcion || "").trim();
  if (!descLimpia) throw new Error("Falta el nombre del producto.");
  const precioN = Math.max(0, Math.round(Number(datos.precio) || 0));
  const costoN = Math.max(0, Math.round(Number(datos.costo) || 0));
  const stockN = Math.max(0, Math.round(Number(datos.stock) || 0));

  // Correlativos ya ocupados. La auto-generación toma el PRIMER hueco libre
  // desde el contador, saltando de a uno sobre este set en memoria: así los
  // códigos manuales fuera de serie (p.ej. BEND-03381 tipeado a mano) no
  // arrastran la secuencia. Para no pagar lecturas de más, la primera pasada
  // usa solo la pista del caller + el bucle defensivo con tx.get (costo
  // normal: 1-2 lecturas); la query de TODO el prefijo queda como fallback
  // para el caso raro de un contador muy desviado de la realidad.
  // Number() normaliza ceros a la izquierda ("03381" → 3381).
  const reCanon = new RegExp(`^${emp.prefijo}-(\\d+)$`);
  const pista = new Set<number>();
  for (const c of codigosOcupados || []) {
    const m = (c || "").trim().toUpperCase().match(reCanon);
    if (m) pista.add(Number(m[1]));
  }

  const AGOTADO = "No pude generar un código libre.";
  const correrAlta = (tomados: Set<number>, cap: number) =>
    runTransaction(db, async (tx) => {
      const s = await tx.get(empRef);
      const curCount = (s.exists() ? (s.data().productosCount as number) || 0 : 0);

      let cod: string;
      let nuevoCount = curCount;
      // True cuando el código pedido correspondía a un producto eliminado y
      // se está reutilizando: hay que limpiar los campos del anterior.
      let reactivado = false;

      if (codigoPedido) {
        // Solo dígitos => el emprendedor escribió el correlativo a secas
        // (p.ej. "483" desde el móvil): se antepone su prefijo y se canoniza
        // a 4 dígitos vía Number (evita variantes tipo BEND-03381).
        cod = /^\d+$/.test(codigoPedido)
          ? `${emp.prefijo}-${String(Number(codigoPedido)).padStart(4, "0")}`
          : normalizarCodigo(codigoPedido);
        if (!cod.startsWith(`${emp.prefijo}-`)) {
          throw new Error(
            `El código debe empezar con "${emp.prefijo}-" (tu prefijo de emprendedor).`
          );
        }
        // Conflict check: si ya existe un producto VIVO con ese código, no lo
        // pisamos. tx.get dentro de la transacción garantiza atomicidad.
        //
        // Si el doc existe pero está soft-eliminado, el código se reutiliza:
        // el producto ya no está en el catálogo ni en el inventario del
        // emprendedor, así que bloquearlo dejaba el código "quemado" para
        // siempre con un mensaje incomprensible ("ya existe" sobre algo que
        // no se ve en ninguna pantalla). Se sobrescribe con los datos nuevos
        // y se resetean los acumulados: es otro producto ocupando el código,
        // y las ventas históricas conservan su propio snapshot.
        const snapProd = await tx.get(tdoc(PRODUCTOS, cod));
        if (snapProd.exists()) {
          const prev = snapProd.data() as Producto;
          if (!prev.eliminado) {
            throw new Error(`Ya existe un producto con el código ${cod}.`);
          }
          reactivado = true;
        }
        // Ojo: NO se mueve productosCount aquí. Un código manual alto (p.ej.
        // BEND-3381) arrastraría la secuencia automática hasta ahí; el set
        // `tomados` ya garantiza que la auto-generación no choque con él.
      } else {
        // Primer correlativo libre después del contador según el set; el
        // bucle con tx.get verifica contra Firestore lo que el set no ve
        // (soft-eliminados fuera del inventario, altas concurrentes).
        nuevoCount = curCount;
        do {
          nuevoCount++;
        } while (tomados.has(nuevoCount));
        cod = `${emp.prefijo}-${String(nuevoCount).padStart(4, "0")}`;
        for (let i = 0; ; i++) {
          const snapProd = await tx.get(tdoc(PRODUCTOS, cod));
          if (!snapProd.exists()) break;
          if (i >= cap) throw new Error(AGOTADO);
          do {
            nuevoCount++;
          } while (tomados.has(nuevoCount));
          cod = `${emp.prefijo}-${String(nuevoCount).padStart(4, "0")}`;
        }
      }

      if (nuevoCount !== curCount) {
        tx.update(empRef, { productosCount: nuevoCount });
      }

      const docProd: Record<string, unknown> = {
        codigo: cod,
        descripcion: descLimpia,
        precio: precioN,
        costo: costoN,
        stockActual: stockN,
        emprendedorId: emp.id,
        emprendedorNombre: emp.nombre,
        creadoEn: Date.now(),
        actualizadoEn: Date.now(),
        // El stock inicial del alta es la primera entrada física del producto.
        ingresadasTotal: stockN,
      };
      if (vence) docProd.vence = vence;
      if (reactivado) {
        // Reutilización de un código liberado: los acumulados del producto
        // anterior no son de este. `eliminado`/`eliminadoEn` no se copian:
        // el set sin merge reemplaza el doc entero y desaparecen solos.
        docProd.vendidasTotal = 0;
        docProd.egresadasTotal = 0;
      }
      // set sin merge: el doc queda exactamente con estos campos, sin
      // arrastrar restos (lote, barcode, vence) del producto reemplazado.
      tx.set(tdoc(PRODUCTOS, cod), docProd);
      return cod;
    });

  let codigo: string;
  try {
    codigo = await correrAlta(pista, 12);
  } catch (e) {
    if (codigoPedido || !(e instanceof Error) || e.message !== AGOTADO) throw e;
    // Fallback caro (raro): set completo por ID de documento, que cubre docs
    // legacy sin campo codigo y soft-eliminados que siguen ocupando código.
    const tomados = new Set<number>(pista);
    const snapCods = await getDocs(
      query(
        tcol(PRODUCTOS),
        where(documentId(), ">=", `${emp.prefijo}-`),
        where(documentId(), "<=", `${emp.prefijo}-${String.fromCharCode(0xf8ff)}`)
      )
    );
    for (const d of snapCods.docs) {
      const m = d.id.match(reCanon);
      if (m) tomados.add(Number(m[1]));
    }
    codigo = await correrAlta(tomados, 50);
  }
  invalidarCatalogo(); // producto nuevo en el catálogo
  await registrarMovEmp(emp.id, {
    en: Date.now(),
    por: quien || (origen === "emprendedor" ? emp.nombre : "Admin"),
    origen,
    accion: "producto_agregado",
    codigo,
    descripcion: descLimpia,
    despues:
      `precio ${precioN} · stock ${stockN}` +
      (vence ? ` · vence ${vence}` : ""),
  });
  return codigo;
}

// Productos de un emprendedor. Query única por campo emprendedorId: el
// backfill (scripts/backfill-links-lecturas.mjs) estampó el campo en todo el
// catálogo histórico, y las altas nuevas siempre lo estampan. Antes se
// hacían DOS queries (por campo Y por prefijo del código) y Firestore
// cobraba dos veces casi todos los docs — con catálogos de 400+ productos
// eso duplicaba el costo de cada visita a /alta.
//
// Fallback: si la query por campo devuelve 0, se consulta por prefijo del
// código (rango sobre el ID del doc). Cubre al emprendedor recién enrolado
// cuyos productos históricos aún no tienen el campo — y cuesta 0 lecturas
// extra cuando de verdad no hay nada.
export async function productosDeEmprendedor(
  emp: { id: string; prefijo: string }
): Promise<Producto[]> {
  const porId = await getDocs(
    query(tcol(PRODUCTOS), where("emprendedorId", "==", emp.id))
  );
  let docs = porId.docs;
  if (docs.length === 0) {
    // Prefix match por ID de documento: rango [PREF-, PREF-].
    const porPrefijo = await getDocs(
      query(
        tcol(PRODUCTOS),
        where(documentId(), ">=", `${emp.prefijo}-`),
        where(documentId(), "<=", `${emp.prefijo}-${String.fromCharCode(0xf8ff)}`)
      )
    );
    docs = porPrefijo.docs;
  }
  const res: Producto[] = [];
  for (const d of docs) {
    const p = d.data() as Producto;
    if (p.eliminado) continue;
    res.push(p);
  }
  return res;
}

// Elimina un producto del catálogo del emprendedor (soft-delete). Valida que
// el producto le pertenezca — por `emprendedorId` estampado o, para legacy sin
// campo, por prefijo del código — antes de tocar Firestore. Si no matchea,
// tira un error de "no autorizado" que la UI puede mostrar.
//
// Por qué soft-delete y no borrado físico: las ventas históricas referencian
// el producto por `codigo` en cada línea. Aunque `LineaVenta` snapshottea
// descripción/precio al momento de la venta, `productosDeEmprendedor` y las
// consultas del historial siguen cruzando por código; hard-delete dejaría
// referencias colgando y podría contarse doble si alguien recrea el código.
// Marcar con `eliminado: true` mantiene consistencia y permite reactivar sin
// perder el trabajo de estampado.
export async function eliminarProductoEmprendedor(
  emp: { id: string; prefijo: string },
  codigo: string,
  origen: "emprendedor" | "admin" = "emprendedor",
  quien = ""
): Promise<void> {
  const empId = emp.id;
  const cod = codigo.trim();
  if (!cod) throw new Error("Falta el código del producto.");
  const ref = tdoc(PRODUCTOS, cod);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("El producto no existe.");
  const p = snap.data() as Producto;
  if (p.eliminado) return; // ya está eliminado, no repetimos escritura ni log
  const propioPorId = !!p.emprendedorId && p.emprendedorId === empId;
  const propioPorPrefijo =
    !p.emprendedorId && !!p.codigo && p.codigo.startsWith(`${emp.prefijo}-`);
  if (!propioPorId && !propioPorPrefijo) {
    throw new Error("No autorizado: este producto no te pertenece.");
  }
  const ahora = Date.now();
  await setDoc(
    ref,
    { eliminado: true, eliminadoEn: ahora, actualizadoEn: ahora },
    { merge: true }
  );
  // El producto ya no debe aparecer en el catálogo cacheado del POS.
  if (_catalogo) {
    _catalogo = _catalogo.filter((x) => x.codigo !== cod);
  }
  await registrarMovEmp(empId, {
    en: ahora,
    por: quien || (origen === "emprendedor" ? "Emprendedor" : "Admin"),
    origen,
    accion: "producto_eliminado",
    codigo: cod,
    descripcion: p.descripcion || "",
    antes: `precio ${p.precio || 0} · stock ${p.stockActual || 0}`,
    despues: "eliminado",
  });
}


// Actualiza campos editables (precio/stock/descripción) de un producto del
// emprendedor desde el flujo /alta/{token}. Valida que el producto pertenezca
// al emprendedor: las reglas de Firestore aceptan escritura de cualquier
// signedIn anónimo, así que esta verificación es defensa en profundidad
// contra bugs de UI, no contra atacantes (un atacante con curl haría lo mismo).
//
// Doble criterio de propiedad (espeja `productosDeEmprendedor`): por
// `emprendedorId` estampado, o para productos legacy (sin campo) por prefijo
// del código. Cuando toca un legacy, aprovecha para estampar el campo y
// curar la fila (backfill perezoso).
export async function actualizarProductoEmprendedor(
  emp: { id: string; prefijo: string; nombre?: string },
  codigo: string,
  cambios: { precio?: number; stockActual?: number; descripcion?: string; vence?: string },
  origen: "emprendedor" | "admin" = "emprendedor",
  quien = ""
): Promise<void> {
  const empId = emp.id;
  const cod = codigo.trim();
  if (!cod) throw new Error("Falta el código del producto.");
  const ref = tdoc(PRODUCTOS, cod);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("El producto no existe.");
  const p = snap.data() as Producto;
  const propioPorId = !!p.emprendedorId && p.emprendedorId === empId;
  const propioPorPrefijo =
    !p.emprendedorId && !!p.codigo && p.codigo.startsWith(`${emp.prefijo}-`);
  if (!propioPorId && !propioPorPrefijo) {
    throw new Error("Este producto no pertenece a este emprendedor.");
  }
  const limpio: Record<string, unknown> = {};
  if (propioPorPrefijo) {
    // Estampa el vínculo para que la próxima edición matchee por campo
    // directo y para que quede consistente con productos nuevos.
    limpio.emprendedorId = empId;
    if (emp.nombre) limpio.emprendedorNombre = emp.nombre;
  }
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
  limpio.actualizadoEn = Date.now();
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

// Ajuste de stock por DELTA (Ingreso/Retiro de /alta). A diferencia de
// actualizarProductoEmprendedor —que escribe un valor absoluto y sirve para
// "editar la ficha"—, esto corre en transacción sobre el stock FRESCO de
// Firestore: si el POS vendió unidades entre que el emprendedor cargó la
// página y confirmó el ajuste, la venta no se pisa (las ventas descuentan
// con increment(), que la transacción ve al reintentar). También valida el
// "no puedes retirar más de lo que tienes" contra el valor fresco, no contra
// el snapshot posiblemente viejo de la UI. Devuelve antes/después reales
// para que la pantalla muestre números correctos.
export async function ajustarStockEmprendedor(
  emp: { id: string; prefijo: string; nombre?: string },
  codigo: string,
  delta: number,
  origen: "emprendedor" | "admin" = "emprendedor",
  quien = ""
): Promise<{ antes: number; despues: number }> {
  const cod = codigo.trim();
  if (!cod) throw new Error("Falta el código del producto.");
  const d = Math.round(Number(delta) || 0);
  if (d === 0) throw new Error("Ingresa una cantidad mayor a 0.");
  const ref = tdoc(PRODUCTOS, cod);
  const res = await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("El producto no existe.");
    const p = snap.data() as Producto;
    if (p.eliminado) {
      throw new Error("El producto fue eliminado del inventario.");
    }
    const propioPorId = !!p.emprendedorId && p.emprendedorId === emp.id;
    const propioPorPrefijo =
      !p.emprendedorId && !!p.codigo && p.codigo.startsWith(`${emp.prefijo}-`);
    if (!propioPorId && !propioPorPrefijo) {
      throw new Error("Este producto no pertenece a este emprendedor.");
    }
    const antes = p.stockActual || 0;
    const despues = antes + d;
    if (despues < 0) {
      throw new Error(`No puedes retirar ${-d}: solo tienes ${antes} en stock.`);
    }
    const cambios: Record<string, unknown> = {
      stockActual: despues,
      // Acumulados de movimiento físico: lo que el emprendedor trajo vs. lo
      // que se llevó. Viajan en la misma escritura, sin costo adicional.
      ...(d > 0
        ? { ingresadasTotal: increment(d) }
        : { egresadasTotal: increment(-d) }),
      actualizadoEn: Date.now(),
    };
    if (propioPorPrefijo) {
      // Backfill perezoso del vínculo, igual que actualizarProductoEmprendedor.
      cambios.emprendedorId = emp.id;
      if (emp.nombre) cambios.emprendedorNombre = emp.nombre;
    }
    tx.set(ref, cambios, { merge: true });
    return { antes, despues, descripcion: p.descripcion || "" };
  });
  parchearProducto(cod, { stockActual: res.despues });
  await registrarMovEmp(emp.id, {
    en: Date.now(),
    por: quien || (origen === "emprendedor" ? emp.nombre || "Emprendedor" : "Admin"),
    origen,
    accion: "stock_cambiado",
    codigo: cod,
    descripcion: res.descripcion,
    antes: String(res.antes),
    despues: String(res.despues),
  });
  return { antes: res.antes, despues: res.despues };
}

// Ventas que tienen al menos una línea de este emprendedor (filtra las
// líneas para devolver solo lo del emprendedor).
//
// Camino barato: query dirigida por empKeys (estampado en confirmarVenta y
// backfilleado en el histórico) — Firestore devuelve SOLO las ventas del
// emprendedor, en vez de cobrar las últimas 500 del negocio entero en cada
// visita a /alta. Requiere el índice compuesto empKeys(CONTAINS) +
// creadoEn(DESC) de firestore.indexes.json.
//
// Fallback: si el índice no existe o aún se está construyendo, cae al
// camino caro anterior (últimas 500 filtradas cliente-side) para no romper
// el portal; el warn en consola delata que se está pagando de más.
export async function ventasDeEmprendedor(
  emp: { id: string; prefijo: string },
  max = 300
): Promise<Venta[]> {
  const pref = `${emp.prefijo}-`;
  let vs: Venta[];
  try {
    const snap = await getDocs(
      query(
        tcol(VENTAS),
        where("empKeys", "array-contains-any", [emp.id, `PREF:${emp.prefijo}`]),
        orderBy("creadoEn", "desc"),
        limit(max)
      )
    );
    vs = snap.docs.map((d) => d.data() as Venta);
  } catch (e) {
    console.warn(
      "ventasDeEmprendedor: query por empKeys falló (¿falta el índice compuesto?); usando fallback caro.",
      e
    );
    vs = await ultimasVentas(500);
  }
  return vs
    .map((v) => ({
      ...v,
      // (v.items || []): un doc de venta corrupto/legacy sin items no debe
      // reventar todo el portal del emprendedor.
      items: (v.items || []).filter(
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

// Cambia el medio de pago de una venta ya registrada (corrección de un
// registro mal ingresado). Corre en un batch para mantener consistencia:
//  - No permitido si la venta está anulada.
//  - Efectivo ↔ no-efectivo: no toca la caja como documento — el cálculo
//    del "efectivo esperado" se hace on-the-fly desde la colección VENTAS,
//    así que la caja abierta refleja el cambio automáticamente.
//  - fiado → otro: registra un abono por el total y baja el saldo del
//    cliente original.
//  - otro → fiado: exige un clienteId, deja un cargo y sube el saldo.
//  - fiado → fiado con cliente distinto: abona al viejo y carga al nuevo.
// vendedor queda anotado en el motivo del movimiento (auditoría).
export async function actualizarMedioPago(
  venta: Venta,
  nuevoMedio: MedioPago,
  vendedor: string,
  nuevoCliente?: { id: string; nombre?: string },
): Promise<void> {
  if (venta.anulada) throw new Error("La venta está anulada: no se puede cambiar el medio de pago.");

  const actual = venta.medioPago;
  const clienteActualId = venta.clienteId || "";
  const clienteNuevoId = nuevoCliente?.id || "";
  if (actual === nuevoMedio && clienteActualId === clienteNuevoId) return;

  if (nuevoMedio === "fiado" && !clienteNuevoId) {
    throw new Error("Cambiar a fiado requiere seleccionar un cliente.");
  }

  const total = venta.total || 0;
  const ahora = Date.now();
  const db = getDb();
  const batch = writeBatch(db);

  // 1) Revertir la deuda del cliente original si venía de fiado.
  if (actual === "fiado" && clienteActualId) {
    batch.set(doc(tcol(CLIENTES, clienteActualId, "movimientos")), {
      tipo: "abono",
      monto: total,
      fecha: hoy(),
      ventaNro: venta.nro,
      nota: `Cambio medio de pago ${venta.nro}: ${actual} → ${nuevoMedio}`,
      creadoEn: ahora,
    });
    batch.update(tdoc(CLIENTES, clienteActualId), { saldo: increment(-total) });
  }

  // 2) Aplicar la deuda al cliente nuevo si el destino es fiado.
  if (nuevoMedio === "fiado" && clienteNuevoId) {
    batch.set(doc(tcol(CLIENTES, clienteNuevoId, "movimientos")), {
      tipo: "cargo",
      monto: total,
      fecha: venta.fecha,
      ventaNro: venta.nro,
      nota: `Cambio medio de pago ${venta.nro}: ${actual} → fiado`,
      creadoEn: ahora,
    });
    batch.update(tdoc(CLIENTES, clienteNuevoId), { saldo: increment(total) });
  }

  // 3) Actualizar el documento de la venta.
  const updates: Record<string, unknown> = { medioPago: nuevoMedio };
  if (nuevoMedio === "fiado") {
    updates.clienteId = clienteNuevoId;
    if (nuevoCliente?.nombre) updates.clienteNombre = nuevoCliente.nombre;
  } else if (actual === "fiado") {
    // Al salir de fiado limpiamos el vínculo con el cliente para que no aparezca
    // como fiado en el detalle. Usamos "" porque Firestore rechaza undefined en
    // un update parcial.
    updates.clienteId = "";
    updates.clienteNombre = "";
  }
  batch.update(tdoc(VENTAS, venta.nro), updates);

  await batch.commit();
  if (actual === "fiado" || nuevoMedio === "fiado") invalidarClientes();
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
        // Una entrada del admin también es mercadería que entró al local.
        ingresadasTotal: increment(l.cantidad),
        actualizadoEn: Date.now(),
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

// Inyecta efectivo extra a la caja (espejo del retiro). Pensado para casos
// fuera de venta: el dueño deja plata para vueltos, fondo extra, etc.
export async function registrarIngreso(cajaId: string, ingreso: Retiro): Promise<void> {
  const db = getDb();
  const ref = tdoc(CAJAS, cajaId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("La caja no existe.");
    const c = snap.data() as Caja;
    if (c.cerradaEn) throw new Error("La caja ya está cerrada.");
    const ingresos = [...(c.ingresos ?? []), ingreso];
    tx.update(ref, { ingresos });
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
      // La venta se deshace: el acumulado de vendidas también.
      vendidasTotal: increment(-l.cantidad),
      actualizadoEn: Date.now(),
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
      // Unidades devueltas dejan de contar como vendidas.
      vendidasTotal: increment(-l.cantidad),
      actualizadoEn: Date.now(),
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
