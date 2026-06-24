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

export interface Caja {
  id: string;
  aperturaEn: number; // epoch ms
  // cerradaEn = null mientras la caja está abierta (se usa así para poder
  // consultarla con where("cerradaEn", "==", null) en Firestore).
  cerradaEn: number | null;
  fondoInicial: number; // efectivo con que se abre la caja
  umbralRetiro: number; // sobre este saldo de efectivo el POS sugiere retirar
  retiros: Retiro[];
  abridoPor?: string; // nombre del vendedor que abrió
  cerradoPor?: string;
  cierreContado?: number; // efectivo físico contado al cerrar
  diferencia?: number; // contado - esperado (sobrante > 0, faltante < 0)
  notas?: string;
}
