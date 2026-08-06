export interface Producto {
  codigo: string;
  descripcion: string;
  lote?: string;
  stockActual: number;
  costo: number;
  precio: number;
  barcode?: string; // código de barras EAN/UPC (opcional)
  // Fecha de vencimiento ISO yyyy-mm-dd. Opcional: solo aplica a productos
  // perecibles (alimentos, fármacos). Patio Curauma típicamente no la usa.
  vence?: string;
  emprendedorId?: string;
  emprendedorNombre?: string;
  // Soft delete: cuando true, el producto queda oculto en el catálogo POS y en
  // "Mi inventario" del emprendedor, pero el doc se conserva para no romper
  // ventas/devoluciones/movimientos históricos que lo referencian por código.
  eliminado?: boolean;
  eliminadoEn?: number; // epoch ms
  // Última escritura sobre el doc (epoch ms del dispositivo que escribió).
  // TODAS las rutas que escriben productos lo estampan: es la base de la
  // sincronización delta del catálogo (ver todosLosProductos en repo.ts).
  actualizadoEn?: number;
  // Unidades vendidas acumuladas (histórico). Se mantiene con increment() en
  // el MISMO batch que descuenta stock, así que no cuesta lecturas ni
  // escrituras extra; anulaciones y devoluciones lo revierten. Permite
  // mostrar "cuánto se ha vendido" en el inventario sin leer la colección
  // de ventas. Backfill: scripts/backfill-vendidas.mjs.
  vendidasTotal?: number;
}

// Emprendedor que deja productos en consignación.
// activo: cuando es false (o "inactivo" explícito) el emprendedor no aparece
// con su link en el flujo normal: no puede cargar nuevos productos desde
// /alta/{token}, ni recibe sales attribution mostrada como activa. Sus
// productos del catálogo NO se borran — son historia y siguen vendiéndose.
// activo === undefined se trata como TRUE (back-compat con docs antiguos).
export interface Emprendedor {
  id: string;
  nombre: string;
  contacto?: string;
  telefono?: string;
  token: string; // para el link individual /alta/{token}
  prefijo: string; // prefijo de código de sus productos (ej: MAR)
  productosCount: number;
  activo?: boolean;
  creadoEn: number;
}

export interface LineaVenta {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precio: number;
  descuento: number; // porcentaje 0-100
  manual?: boolean; // producto fuera de catálogo: no descuenta stock
  // Snapshot del emprendedor dueño del producto al momento de la venta. Se
  // estampa en confirmarVenta para que el análisis histórico no dependa del
  // catálogo actual (un producto puede cambiar de dueño o eliminarse).
  emprendedorId?: string;
  emprendedorNombre?: string;
}

export type MedioPago = "efectivo" | "debito" | "credito" | "transferencia" | "fiado";

// Una venta anulada se marca con este bloque: NO se borra el documento (las
// boletas correlativas no pueden saltar números y queremos auditoría).
// Cuando "anulada" existe la venta cuenta como invalidada: el stock fue
// devuelto, la deuda fiado fue abonada y, si era efectivo, hubo egreso de
// caja por el total.
export interface AnulacionInfo {
  en: number; // epoch ms
  por: string; // vendedor que la anuló
  motivo: string;
}

export interface Venta {
  nro: string;
  fecha: string; // ISO yyyy-mm-dd
  cliente: string;
  items: LineaVenta[];
  total: number;
  creadoEn: number; // epoch ms
  vendedor?: string;
  medioPago?: MedioPago;
  clienteId?: string; // referencia al cliente del fiado
  clienteNombre?: string;
  anulada?: AnulacionInfo;
  // Folio que entrega la boleta legal (SII u otra), opcional. Se ingresa al
  // momento de finalizar la venta o desde el historial. Es texto libre porque
  // varía según el sistema externo que lo emite.
  codigoBoleta?: string;
  // Llaves de búsqueda por emprendedor: ids de emprendedor y prefijos
  // ("PREF:BEND") presentes en las líneas. Permite a /alta traer solo las
  // ventas del emprendedor con array-contains-any en vez de escanear todas.
  empKeys?: string[];
}

// Cliente del cuaderno de fiados.
export interface Cliente {
  id: string;
  nombre: string;
  telefono?: string;
  saldo: number; // deuda actual (positivo = debe)
  creadoEn: number;
}

export interface MovimientoFiado {
  tipo: "cargo" | "abono";
  monto: number;
  fecha: string;
  nota?: string;
  ventaNro?: string;
  creadoEn: number;
}

// Bitácora de cambios sobre el catálogo de un emprendedor y sobre la ficha del
// emprendedor mismo. Se almacena en negocios/{slug}/emprendedores/{id}/movimientos.
// Se registra tanto lo que hace el emprendedor (desde /alta/{token}) como lo
// que hace el admin (POS/stock/CRM). Cuando se elimina el emprendedor, su
// historial deja de mostrarse junto con la ficha (los docs quedan huérfanos
// como subcolección hasta limpieza manual: no hay UI que los liste sin padre).
export type AccionMovEmprendedor =
  | "producto_agregado"
  | "producto_eliminado"
  | "precio_cambiado"
  | "stock_cambiado"
  | "descripcion_cambiada"
  | "barcode_cambiado"
  | "codigo_renombrado"
  | "costo_cambiado"
  | "vencimiento_cambiado"
  | "emprendedor_creado"
  | "emprendedor_editado"
  | "emprendedor_activado"
  | "emprendedor_pausado";

export interface MovimientoEmprendedor {
  en: number; // epoch ms
  por: string; // nombre del actor (vendedor o emprendedor)
  origen: "admin" | "emprendedor";
  accion: AccionMovEmprendedor;
  // Para acciones de producto: código y descripción snapshot al momento del cambio.
  codigo?: string;
  descripcion?: string;
  // Valor anterior y nuevo. Strings para descripción/código/barcode/etc., números
  // para precio/stock/costo. Se guardan como string siempre para simplificar la UI.
  antes?: string;
  despues?: string;
}

// Evento de ingreso de stock atribuible a un emprendedor: o bien dio de alta
// un producto nuevo desde /alta/{token}, o bien declaró "Recibí" más unidades
// de uno existente. Se deriva de la bitácora del emprendedor (movimientos),
// no se persiste como entidad propia: el historial del POS lo arma sobre la
// marcha cruzando todos los emprendedores.
export interface IngresoEmprendedor {
  en: number; // epoch ms del movimiento original
  emprendedorId: string;
  emprendedorNombre: string;
  emprendedorPrefijo: string;
  // "alta" = producto nuevo cargado; "reposicion" = stock_cambiado con delta > 0.
  tipo: "alta" | "reposicion";
  codigo: string;
  descripcion: string;
  cantidad: number; // unidades efectivamente ingresadas
  precio?: number; // solo en alta (se parsea del campo "despues")
  por: string; // nombre del actor que registró el movimiento
  origen: "admin" | "emprendedor";
}

export interface LineaEntrada {
  codigo: string;
  descripcion: string;
  lote?: string;
  cantidad: number;
}

export interface Entrada {
  nro: string; // correlativo EN-###
  fecha: string; // ISO yyyy-mm-dd
  codigo: string;
  descripcion: string;
  lote?: string;
  cantidad: number;
  creadoEn: number;
  usuario?: string;
}

export function subtotalLinea(l: LineaVenta): number {
  return l.cantidad * l.precio * (1 - (l.descuento || 0) / 100);
}

// ===== Caja (turno) =====
// Una caja agrupa el efectivo de un turno: se abre con un fondo inicial, se le
// registran retiros durante el turno y se cierra contando físicamente el
// efectivo. Las ventas del turno son las que tienen creadoEn dentro del rango
// [aperturaEn, cerradaEn || ahora]: no hay foreign key.

export interface Retiro {
  monto: number;
  hora: number; // epoch ms
  motivo: string;
  vendedor: string;
}

// Snapshot mínimo de una devolución dentro del array caja.devoluciones[].
// Permite calcular el efectivo esperado del turno sin releer la colección
// devoluciones en cada render.
export interface DevolucionCaja {
  nro: string; // DV-###
  ventaNro: string;
  monto: number;
  hora: number; // epoch ms
  motivo: string;
  vendedor: string;
}

export interface Caja {
  id: string;
  aperturaEn: number; // epoch ms
  // cerradaEn = null mientras la caja está abierta (se usa así para poder
  // consultarla con where("cerradaEn", "==", null) en Firestore).
  cerradaEn: number | null;
  fondoInicial: number; // efectivo con que se abre la caja
  umbralRetiro: number; // sobre este saldo de efectivo el POS sugiere retirar
  retiros: Retiro[];
  // Ingresos de efectivo del turno fuera de venta (inyecciones de plata para
  // vueltos, fondo extra del dueño, etc.). Motivo obligatorio para auditoría.
  ingresos?: Retiro[];
  // Devoluciones en efectivo del turno (egreso de caja). Solo se llenan cuando
  // el medio original de la venta era "efectivo".
  devoluciones?: DevolucionCaja[];
  abridoPor?: string; // nombre del vendedor que abrió
  cerradoPor?: string;
  cierreContado?: number; // efectivo físico contado al cerrar
  diferencia?: number; // contado - esperado (sobrante > 0, faltante < 0)
  notas?: string;
}

// Devolución de productos: revierte (parcial o totalmente) una venta sin
// mutarla. Se guarda como documento aparte para no romper el histórico de
// ventas ni el snapshot de emprendedores. Los efectos se aplican al crearla:
//  - re-incrementa stock de las líneas con código,
//  - reduce la deuda del cliente si la venta era fiado,
//  - asienta el egreso en la caja abierta si era efectivo,
//  - los medios electrónicos solo dejan registro (chargeback manual).
export interface Devolucion {
  nro: string; // DV-###
  fecha: string; // ISO yyyy-mm-dd
  creadoEn: number; // epoch ms
  ventaNro: string; // referencia a la venta original
  vendedor: string; // quién hizo la devolución
  motivo: string;
  items: LineaVenta[]; // misma forma que las líneas de venta
  total: number;
  medioPagoOriginal: MedioPago;
  // Heredados de la venta para revertir su efecto. Vacíos si no aplica.
  clienteId?: string; // si era fiado, cliente al que se le bajó la deuda
  cajaId?: string; // si era efectivo, caja en la que se asentó
}
