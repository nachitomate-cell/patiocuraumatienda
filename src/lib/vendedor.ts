// Nombre del vendedor activo, persistido en localStorage del navegador.
//
// Sin login, no hay correo desde Firebase Auth para estampar en ventas y
// entradas. En su lugar el vendedor tipea una vez su nombre (en el chip del
// AppShell) y queda guardado por dispositivo.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "patio-pos:vendedor";

let cache: string | null = null;
const listeners = new Set<() => void>();

function notificar(): void {
  listeners.forEach((fn) => fn());
}

function leer(): string {
  if (cache !== null) return cache;
  if (typeof window === "undefined") return "";
  cache = window.localStorage.getItem(STORAGE_KEY) ?? "";
  return cache;
}

export function getVendedor(): string {
  return leer();
}

export function setVendedor(nombre: string): void {
  const limpio = (nombre || "").trim();
  cache = limpio;
  if (typeof window !== "undefined") {
    if (limpio) window.localStorage.setItem(STORAGE_KEY, limpio);
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  notificar();
}

// Hook reactivo: se reactualiza cuando otro componente cambia el vendedor en
// la misma pestaña.
export function useVendedor(): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    leer,
    () => ""
  );
}

// Sincroniza si cambia desde otra pestaña (evento storage del navegador).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    cache = e.newValue ?? "";
    notificar();
  });
}
