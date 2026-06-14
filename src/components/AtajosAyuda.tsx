"use client";

import { Modal } from "./Modal";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block min-w-[26px] text-center font-mono text-xs font-semibold bg-slate-100 border border-slate-300 border-b-2 rounded px-1.5 py-0.5 text-slate-700">
      {children}
    </kbd>
  );
}

interface Atajo {
  teclas: string[];
  desc: string;
}
interface Grupo {
  titulo: string;
  atajos: Atajo[];
}

// Lista de referencia de todos los atajos de la app.
export const GRUPOS_ATAJOS: Grupo[] = [
  {
    titulo: "Navegación (cualquier pantalla)",
    atajos: [
      { teclas: ["Alt", "1"], desc: "Venta" },
      { teclas: ["Alt", "2"], desc: "Entradas" },
      { teclas: ["Alt", "3"], desc: "Stock" },
      { teclas: ["Alt", "4"], desc: "Etiquetas" },
      { teclas: ["Alt", "5"], desc: "Fiados" },
      { teclas: ["Alt", "6"], desc: "Emprendedores" },
      { teclas: ["Alt", "7"], desc: "CRM" },
      { teclas: ["Alt", "8"], desc: "Historial" },
      { teclas: ["Alt", "9"], desc: "Admin" },
      { teclas: ["?"], desc: "Mostrar / ocultar esta ayuda" },
      { teclas: ["Esc"], desc: "Cerrar ventana / cancelar" },
    ],
  },
  {
    titulo: "Venta",
    atajos: [
      { teclas: ["Alt", "B"], desc: "Buscar producto" },
      { teclas: ["Enter"], desc: "Agregar el primer resultado de la búsqueda" },
      { teclas: ["Alt", "S"], desc: "Modo escáner on/off" },
      { teclas: ["Alt", "E"], desc: "Pago: Efectivo" },
      { teclas: ["Alt", "D"], desc: "Pago: Débito" },
      { teclas: ["Alt", "C"], desc: "Pago: Crédito" },
      { teclas: ["Alt", "T"], desc: "Pago: Transferencia" },
      { teclas: ["Alt", "F"], desc: "Pago: Fiado" },
      { teclas: ["Alt", "G"], desc: "Confirmar (guardar) venta" },
      { teclas: ["Alt", "N"], desc: "Nueva venta" },
    ],
  },
  {
    titulo: "Stock",
    atajos: [
      { teclas: ["Alt", "B"], desc: "Buscar" },
      { teclas: ["Alt", "R"], desc: "Refrescar" },
      { teclas: ["Alt", "→"], desc: "Página siguiente" },
      { teclas: ["Alt", "←"], desc: "Página anterior" },
    ],
  },
  {
    titulo: "CRM",
    atajos: [
      { teclas: ["Alt", "D"], desc: "Período: Día" },
      { teclas: ["Alt", "S"], desc: "Período: Semana" },
      { teclas: ["Alt", "M"], desc: "Período: Mes" },
      { teclas: ["Alt", "A"], desc: "Período: Año" },
      { teclas: ["Alt", "P"], desc: "Período personalizado" },
    ],
  },
  {
    titulo: "Etiquetas",
    atajos: [
      { teclas: ["Alt", "B"], desc: "Buscar" },
      { teclas: ["Alt", "I"], desc: "Imprimir" },
    ],
  },
];

export function AtajosAyuda({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Atajos de teclado" maxW="max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
        {GRUPOS_ATAJOS.map((g) => (
          <div key={g.titulo}>
            <h4 className="text-xs font-bold uppercase tracking-wide text-cyan-700 mb-2">
              {g.titulo}
            </h4>
            <ul className="space-y-1.5">
              {g.atajos.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-600">{a.desc}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {a.teclas.map((t, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && <span className="text-slate-300 text-xs">+</span>}
                        <Kbd>{t}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-4">
        Consejo: los atajos con <Kbd>Alt</Kbd> funcionan aunque estés escribiendo en un campo.
      </p>
    </Modal>
  );
}
