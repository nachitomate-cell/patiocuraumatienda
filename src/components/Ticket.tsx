"use client";

import { subtotalLinea, type LineaVenta } from "@/lib/types";
import { money } from "@/lib/format";
import { useNegocio } from "@/lib/negocio-context";
import type { BoletaConfig } from "@/lib/negocio";

interface Props {
  nro: string;
  fecha: string;
  cliente: string;
  items: LineaVenta[];
  total: number;
  vendedor?: string;
  medioPago?: string;
  // Folio externo de la boleta (SII u otro), si fue asociado a la venta.
  codigoBoleta?: string;
  // Override de la config: la pantalla /boleta lo usa para mostrar el preview
  // en vivo de los cambios sin esperar al refresh del context.
  cfgOverride?: BoletaConfig;
}

// Boleta térmica (80mm). Solo este bloque se imprime (ver globals.css).
// Cada línea del header/footer depende de la config en negocios/{slug}.boleta.
// Si la config no está definida (boleta antigua), se muestran los valores que
// se mostraban antes (mostrar* === undefined → se trata como TRUE).
export function Ticket({ nro, fecha, cliente, items, total, vendedor, medioPago, codigoBoleta, cfgOverride }: Props) {
  const NEGOCIO = useNegocio();
  const cfg = cfgOverride ?? NEGOCIO.boleta ?? {};
  // Helper: TRUE si está activado o no está definido.
  const on = (v: boolean | undefined) => v !== false;
  // Override: el campo de la boleta gana sobre el del branding si está seteado
  // (string no vacío). Permite editar todo desde /boleta sin tocar el branding
  // global (que solo el moderador puede modificar).
  const pick = (override: string | undefined, base: string | undefined): string => {
    const o = (override ?? "").trim();
    return o || (base ?? "");
  };
  const nombre = pick(cfg.nombre, NEGOCIO.nombre);
  const eslogan = pick(cfg.eslogan, NEGOCIO.eslogan);
  const rubro = pick(cfg.rubro, NEGOCIO.rubro);
  const ubicacion = pick(cfg.ubicacion, NEGOCIO.ubicacion);
  const web = pick(cfg.web, NEGOCIO.web);
  const instagram = pick(cfg.instagram, NEGOCIO.instagram);
  const qrClub = pick(cfg.qrClub, NEGOCIO.qrClub);

  const textoGracias = (cfg.textoGracias || "¡GRACIAS POR SU COMPRA!").trim();

  return (
    <div
      id="ticket"
      className="bg-white rounded-xl shadow p-4 text-[12px] leading-tight font-mono text-slate-900"
      style={{ width: "80mm", maxWidth: "100%" }}
    >
      <div className="text-center">
        <div className="font-bold text-sm">{nombre.toUpperCase()}</div>
        {on(cfg.mostrarEslogan) && eslogan && (
          <div className="text-[10px] uppercase tracking-widest">{eslogan}</div>
        )}
        {on(cfg.mostrarRubro) && rubro && <div>{rubro}</div>}
        {on(cfg.mostrarUbicacion) && ubicacion && <div>📍 {ubicacion}</div>}
        {on(cfg.mostrarWeb) && web && <div>{web}</div>}
      </div>

      {cfg.mensajeSuperior && cfg.mensajeSuperior.trim() && (
        <div className="text-center mt-1 whitespace-pre-line">{cfg.mensajeSuperior.trim()}</div>
      )}

      <div className="my-1">════════════════════════</div>
      <div className="flex justify-between">
        <span>Nro: {nro}</span>
        <span>{fecha}</span>
      </div>
      {codigoBoleta && codigoBoleta.trim() && (
        <div>Boleta: {codigoBoleta.trim()}</div>
      )}
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
        {on(cfg.mostrarQrClub) && qrClub && (
          <>
            <div>📱 Club de Fidelización</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrClub}
              alt={`QR Club de Fidelización ${nombre}`}
              className="mx-auto my-2 w-28 h-28"
            />
            <div>¡Escanea y acumula puntos!</div>
          </>
        )}
        {textoGracias && <div className="mt-2">{textoGracias}</div>}
        {on(cfg.mostrarInstagram) && instagram && (
          <div>📷 {instagram}</div>
        )}
      </div>
    </div>
  );
}
