"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  titulo?: string;
  children: React.ReactNode;
  maxW?: string; // clase tailwind, ej: "max-w-md"
}

// Modal propio de la app (sin diálogos del navegador). Cierra con Escape,
// clic en el fondo o el botón ✕, y bloquea el scroll de fondo mientras está abierto.
export function Modal({ abierto, onCerrar, titulo, children, maxW = "max-w-lg" }: Props) {
  useEffect(() => {
    if (!abierto) return;
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 no-print"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onCerrar} />
      <div
        className={`relative w-full ${maxW} bg-white rounded-2xl shadow-2xl anim-pop max-h-[90vh] flex flex-col`}
      >
        {titulo && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
            <h3 className="font-bold text-slate-900">{titulo}</h3>
            <button
              onClick={onCerrar}
              className="text-slate-400 hover:text-white hover:bg-slate-500 p-1.5 rounded-lg"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
          </div>
        )}
        <div className="p-5 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
