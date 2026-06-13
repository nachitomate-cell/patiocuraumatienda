"use client";

import { subtotalLinea, type LineaVenta } from "@/lib/types";
import { money } from "@/lib/format";

interface Props {
  nro: string;
  fecha: string;
  cliente: string;
  items: LineaVenta[];
  total: number;
}

// Boleta termica (80mm). Solo este bloque se imprime (ver globals.css).
export function Ticket({ nro, fecha, cliente, items, total }: Props) {
  return (
    <div
      id="ticket"
      className="bg-white rounded-xl shadow p-4 text-[12px] leading-tight font-mono text-slate-900"
      style={{ width: "80mm", maxWidth: "100%" }}
    >
      <div className="text-center">
        <div className="font-bold text-sm">🏡 PATIO CURAUMA</div>
        <div>Productos Naturales y Artesanales</div>
        <div>📍 Curauma, Valparaíso</div>
        <div>www.patiocuraumaonline.com</div>
      </div>
      <div className="my-1">════════════════════════</div>
      <div className="flex justify-between">
        <span>Nro: {nro}</span>
        <span>{fecha}</span>
      </div>
      <div>Cliente: {cliente}</div>
      <div className="my-1">────────────────────────</div>
      <table className="w-full">
        <thead>
          <tr className="text-left">
            <th>Producto</th>
            <th className="text-right">Cant</th>
            <th className="text-right">Subt.</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l, i) => (
            <tr key={i}>
              <td className="pr-1">{l.descripcion}</td>
              <td className="text-right">{l.cantidad}</td>
              <td className="text-right">{money(subtotalLinea(l))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-1">════════════════════════</div>
      <div className="flex justify-between font-bold text-sm">
        <span>TOTAL</span>
        <span>{money(total)}</span>
      </div>
      <div className="my-1">════════════════════════</div>
      <div className="text-center mt-2">
        <div>📱 Club de Fidelización</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/qr-club.png"
          alt="QR Club de Fidelización Patio Curauma"
          className="mx-auto my-2 w-28 h-28"
        />
        <div>¡Escanea y acumula puntos!</div>
        <div className="mt-2">¡GRACIAS POR SU COMPRA!</div>
        <div>📷 @patiocurauma</div>
      </div>
    </div>
  );
}
