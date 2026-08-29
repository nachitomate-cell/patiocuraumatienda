"use client";

import type { IngresoEmprendedor } from "@/lib/types";
import { useNegocio } from "@/lib/negocio-context";

interface Props {
  emprendedorNombre: string;
  emprendedorPrefijo: string;
  items: IngresoEmprendedor[];
  // Texto del periodo cubierto ("06/08/2026" o "agosto 2026").
  periodo: string;
  // Quién atiende en caja: se imprime bajo la firma de recepción.
  recibidoPor?: string;
  id?: string;
}

// Comprobante imprimible de lo que un emprendedor dejó (o retiró) en el
// local, para firmar en papel: es el respaldo físico de la consignación.
// Separa INGRESOS de RETIROS porque son compromisos opuestos (el local queda
// responsable de la mercadería que entra; el emprendedor se lleva la que
// sale). Cuando caja verificó una cantidad distinta a la declarada, se
// imprime la diferencia — es justamente lo que ambos firman.
//
// Se imprime vía window.print(); el CSS de globals.css deja visible solo
// #comprobante.
export function ComprobanteMovimientos({
  emprendedorNombre,
  emprendedorPrefijo,
  items,
  periodo,
  recibidoPor,
  id = "comprobante",
}: Props) {
  const NEGOCIO = useNegocio();
  // Las ediciones de ficha (precio/descripción) no mueven unidades físicas:
  // quedan fuera del documento que se firma por mercadería contada.
  const ingresos = items.filter((x) => x.tipo === "alta" || x.tipo === "reposicion");
  const retiros = items.filter((x) => x.tipo === "retiro");

  // La cantidad que vale es la contada por caja cuando existe.
  const real = (x: IngresoEmprendedor) =>
    x.verificacion?.cantidadReal ?? x.cantidad;
  const sum = (arr: IngresoEmprendedor[]) => arr.reduce((s, x) => s + real(x), 0);
  const totalIn = sum(ingresos);
  const totalOut = sum(retiros);
  const hayDiferencias = items.some(
    (x) => x.verificacion?.cantidadReal !== undefined &&
      x.verificacion.cantidadReal !== x.cantidad
  );

  const Tabla = ({
    titulo,
    filas,
    total,
  }: {
    titulo: string;
    filas: IngresoEmprendedor[];
    total: number;
  }) => (
    <div className="mt-4">
      <div className="font-bold text-[13px] border-b border-slate-800 pb-1 mb-1">
        {titulo}
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-slate-300">
            <th className="text-left py-1 w-[70px]">Fecha</th>
            <th className="text-left py-1 w-[95px]">Código</th>
            <th className="text-left py-1">Producto</th>
            <th className="text-right py-1 w-[60px]">Declar.</th>
            <th className="text-right py-1 w-[60px]">Contado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((x) => {
            const cr = x.verificacion?.cantidadReal;
            const difiere = cr !== undefined && cr !== x.cantidad;
            return (
              <tr key={`${x.emprendedorId}-${x.movId}`} className="border-b border-slate-100 fila-comprobante">
                <td className="py-1">
                  {new Date(x.en).toLocaleDateString("es-CL", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </td>
                <td className="py-1 font-mono">{x.codigo}</td>
                <td className="py-1">
                  {x.descripcion || "—"}
                  {x.tipo === "alta" && (
                    <span className="ml-1 text-[9px] uppercase">(nuevo)</span>
                  )}
                </td>
                <td className="py-1 text-right">{x.cantidad}</td>
                <td className={`py-1 text-right ${difiere ? "font-bold" : ""}`}>
                  {cr === undefined ? "—" : cr}
                  {difiere && (
                    <span className="ml-1 text-[9px]">
                      ({cr > x.cantidad ? "+" : ""}
                      {cr - x.cantidad})
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-800 font-bold">
            <td className="py-1" colSpan={3}>
              Total {titulo.toLowerCase()} ({filas.length}{" "}
              {filas.length === 1 ? "línea" : "líneas"})
            </td>
            <td className="py-1 text-right">
              {filas.reduce((s, x) => s + x.cantidad, 0)}
            </td>
            <td className="py-1 text-right">{total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div
      {...(id ? { id } : {})}
      className="bg-white rounded-xl shadow p-6 text-slate-900"
      style={{ maxWidth: "190mm" }}
    >
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2">
        <div>
          <div className="font-bold text-base">{NEGOCIO.nombre}</div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600">
            Comprobante de movimiento de mercadería
          </div>
        </div>
        <div className="text-right text-[11px]">
          <div>
            Emitido:{" "}
            {new Date().toLocaleString("es-CL", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div>Periodo: {periodo}</div>
        </div>
      </div>

      <div className="mt-3 text-[12px]">
        <div>
          <span className="text-slate-600">Emprendedor: </span>
          <span className="font-bold">{emprendedorNombre}</span>
          {emprendedorPrefijo && (
            <span className="font-mono text-slate-600"> ({emprendedorPrefijo})</span>
          )}
        </div>
        {recibidoPor && (
          <div>
            <span className="text-slate-600">Atendido por: </span>
            {recibidoPor}
          </div>
        )}
      </div>

      {ingresos.length > 0 && (
        <Tabla
          titulo="Ingresos (mercadería entregada al local)"
          filas={ingresos}
          total={totalIn}
        />
      )}
      {retiros.length > 0 && (
        <Tabla
          titulo="Retiros (mercadería devuelta al emprendedor)"
          filas={retiros}
          total={totalOut}
        />
      )}
      {items.length === 0 && (
        <p className="mt-6 text-center text-[12px] text-slate-500">
          Sin movimientos en el periodo.
        </p>
      )}

      {hayDiferencias && (
        <p className="mt-3 text-[10px] border border-slate-400 rounded px-2 py-1">
          <b>Nota:</b> las cantidades marcadas en negrita difieren de lo
          declarado en la app. Vale lo contado en el local.
        </p>
      )}

      {/* Declaración + firmas: es el objeto del documento. */}
      <p className="mt-5 text-[10px] leading-snug text-slate-700">
        Ambas partes declaran que las cantidades detalladas corresponden a la
        mercadería efectivamente entregada y contada en el local. La mercadería
        en ingreso queda en consignación y se liquida según las ventas
        registradas en el sistema.
      </p>

      <div className="mt-10 grid grid-cols-2 gap-8 text-[11px]">
        <div className="text-center">
          <div className="border-t border-slate-800 pt-1">
            Firma emprendedor
          </div>
          <div className="text-slate-600">{emprendedorNombre}</div>
        </div>
        <div className="text-center">
          <div className="border-t border-slate-800 pt-1">Firma recepción</div>
          <div className="text-slate-600">{recibidoPor || NEGOCIO.nombre}</div>
        </div>
      </div>

      <div className="mt-4 text-center text-[9px] text-slate-500">
        {NEGOCIO.nombre}
        {NEGOCIO.ubicacion ? ` · ${NEGOCIO.ubicacion}` : ""}
      </div>
    </div>
  );
}
