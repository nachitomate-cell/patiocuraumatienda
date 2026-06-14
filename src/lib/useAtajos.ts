"use client";

import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;
type Mapa = Record<string, Handler>;

// ¿El foco está en un campo de texto? (para no disparar atajos sin modificador
// mientras el usuario escribe).
export function enCampo(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
  );
}

// Construye una clave tipo "alt+b", "alt+arrowright", "?" desde el evento.
function combo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.altKey) parts.push("alt");
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

// Registra atajos de teclado. El mapa puede recrearse en cada render: se guarda
// en un ref para mantener el listener estable y usar siempre los handlers nuevos.
// Los atajos SIN Alt/Ctrl no se disparan mientras se escribe en un campo.
export function useAtajos(mapa: Mapa, activo = true) {
  const ref = useRef(mapa);
  ref.current = mapa;

  useEffect(() => {
    if (!activo) return;
    function onKey(e: KeyboardEvent) {
      const sinMod = !e.altKey && !e.ctrlKey && !e.metaKey;
      if (sinMod && enCampo()) return;
      const fn = ref.current[combo(e)] || ref.current[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activo]);
}
