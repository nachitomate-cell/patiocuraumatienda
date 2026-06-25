export interface Producto {
  codigo: string;
  descripcion: string;
  lote?: string;
  stockActual: number;
  costo: number;
  precio: number;
  barcode?: string; // código de barras EAN/UPC (opcional)
  emprendedorId?: string;
  emprendedorNombre?: string;
}

// Emprendedor que deja productos en consignación.
export interface Emprendedor {
  id: string;
  nombre: string;
  contacto?: string;
  telefono?: string;
  token: string; // para el link individual /alta/{token}
  prefijo: string; // prefijo de código de sus productos (ej: MAR)
  productosCount: number;
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
