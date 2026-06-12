export interface Producto {
  codigo: string;
  descripcion: string;
  lote?: string;
  stockActual: number;
  costo: number;
  precio: number;
  barcode?: string; // código de barras EAN/UPC (opcional)
}

export interface LineaVenta {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precio: number;
  descuento: number; // porcentaje 0-100
}

export interface Venta {
  nro: string;
  fecha: string; // ISO yyyy-mm-dd
  cliente: string;
  items: LineaVenta[];
  total: number;
  creadoEn: number; // epoch ms
  vendedor?: string;
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
