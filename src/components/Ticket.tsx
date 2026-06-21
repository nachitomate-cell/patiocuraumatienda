"use client";

import { subtotalLinea, type LineaVenta } from "@/lib/types";
import { money } from "@/lib/format";
import { useNegocio } from "@/lib/negocio-context";

interface Props {
  nro: string;
  fecha: string;
  cliente: string;
  items: LineaVenta[];
  total: number;
}

// Boleta termica (80mm). Solo este bloque se imprime (ver globals.css).
export function Ticket({ nro, fecha, cliente, items, total }: Props) {
  const NEGOCIO = useNegocio();
  return (
    <div
      id="ticket"
      className="bg-white rounded-xl shadow p-4 text-[12px] leading-tight font-mono text-slate-900"
      style={{ width: "80mm", maxWidth: "100%" }}
    >
      <div className="text-center">
        <div className="font-bold text-sm">{NEGOCIO.nombre.toUpperCase()}</div>
        {NEGOCIO.rubro && <div>{NEGOCIO.rubro}</div>}
        {NEGOCIO.ubicacion && <div>📍 {NEGOCIO.ubicacion}</div>}
        {NEGOCIO.web && <div>{NEGOCIO.web}</div>}
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
        {NEGOCIO.qrClub && (
          <>
            <div>📱 Club de Fidelización</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={NEGOCIO.qrClub}
              alt={`QR Club de Fidelización ${NEGOCIO.nombre}`}
              className="mx-auto my-2 w-28 h-28"
            />
            <div>¡Escanea y acumula puntos!</div>
          </>
        )}
        <div className="mt-2">¡GRACIAS POR SU COMPRA!</div>
        {NEGOCIO.instagram && <div>📷 {NEGOCIO.instagram}</div>}
      </div>
    </div>
  );
}
