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
  vendedor?: string;
  medioPago?: string;
}

// Boleta térmica (80mm). Solo este bloque se imprime (ver globals.css).
// Cada línea del header/footer depende de la config en negocios/{slug}.boleta.
// Si la config no está definida (boleta antigua), se muestran los valores que
// se mostraban antes (mostrar* === undefined → se trata como TRUE).
export function Ticket({ nro, fecha, cliente, items, total, vendedor, medioPago }: Props) {
  const NEGOCIO = useNegocio();
  const cfg = NEGOCIO.boleta || {};
  // Helper: TRUE si está activado o no está definido.
  const on = (v: boolean | undefined) => v !== false;

  const textoGracias = (cfg.textoGracias || "¡GRACIAS POR SU COMPRA!").trim();

  return (
    <div
      id="ticket"
      className="bg-white rounded-xl shadow p-4 text-[12px] leading-tight font-mono text-slate-900"
      style={{ width: "80mm", maxWidth: "100%" }}
    >
      <div className="text-center">
        <div className="font-bold text-sm">{NEGOCIO.nombre.toUpperCase()}</div>
        {on(cfg.mostrarEslogan) && NEGOCIO.eslogan && (
          <div className="text-[10px] uppercase tracking-widest">{NEGOCIO.eslogan}</div>
        )}
        {on(cfg.mostrarRubro) && NEGOCIO.rubro && <div>{NEGOCIO.rubro}</div>}
        {on(cfg.mostrarUbicacion) && NEGOCIO.ubicacion && <div>📍 {NEGOCIO.ubicacion}</div>}
        {on(cfg.mostrarWeb) && NEGOCIO.web && <div>{NEGOCIO.web}</div>}
      </div>

      {cfg.mensajeSuperior && cfg.mensajeSuperior.trim() && (
        <div className="text-center mt-1 whitespace-pre-line">{cfg.mensajeSuperior.trim()}</div>
      )}

      <div className="my-1">════════════════════════</div>
      <div className="flex justify-between">
        <span>Nro: {nro}</span>
        <span>{fecha}</span>
      </div>
      <div>Cliente: {cliente}</div>
      {cfg.mostrarVendedor && vendedor && <div>Atiende: {vendedor}</div>}
      {cfg.mostrarMedioPago && medioPago && (
        <div className="capitalize">Pago: {medioPago}</div>
      )}
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

      {cfg.mensajeInferior && cfg.mensajeInferior.trim() && (
        <div className="text-center mt-1 whitespace-pre-line">{cfg.mensajeInferior.trim()}</div>
      )}

      <div className="text-center mt-2">
        {on(cfg.mostrarQrClub) && NEGOCIO.qrClub && (
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
        {textoGracias && <div className="mt-2">{textoGracias}</div>}
        {on(cfg.mostrarInstagram) && NEGOCIO.instagram && (
          <div>📷 {NEGOCIO.instagram}</div>
        )}
      </div>
    </div>
  );
}
