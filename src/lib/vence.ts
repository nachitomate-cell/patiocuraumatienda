// Helpers de fecha de vencimiento. Productos perecibles (alimentos) llevan un
// ISO yyyy-mm-dd en producto.vence. El badge cambia de color según cuánto falta.

export type EstadoVence = {
  diasRestantes: number; // negativo = ya vencido
  // Categoría usada para colorear el badge y filtrar listados.
  nivel: "vencido" | "critico" | "cerca" | "ok";
  label: string; // texto corto para mostrar
  // Clases Tailwind listas para usar (badge bg + text).
  bgText: string;
};

function isoAFecha(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Devuelve null si no hay vence (no es perecible).
export function estadoVence(vence: string | undefined | null): EstadoVence | null {
  if (!vence) return null;
  const f = isoAFecha(vence);
  if (!f) return null;
  const hoy = new Date();
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const ms = f.getTime() - hoy0.getTime();
  const dias = Math.round(ms / 86400000);
  if (dias < 0) {
    return {
      diasRestantes: dias,
      nivel: "vencido",
      label: dias === -1 ? "Vencido ayer" : `Vencido hace ${-dias} días`,
      bgText: "bg-red-100 text-red-800",
    };
  }
  if (dias <= 7) {
    return {
      diasRestantes: dias,
      nivel: "critico",
      label: dias === 0 ? "Vence hoy" : dias === 1 ? "Vence mañana" : `Vence en ${dias} días`,
      bgText: "bg-amber-100 text-amber-800",
    };
  }
  if (dias <= 30) {
    return {
      diasRestantes: dias,
      nivel: "cerca",
      label: `Vence en ${dias} días`,
      bgText: "bg-yellow-50 text-yellow-700",
    };
  }
  return {
    diasRestantes: dias,
    nivel: "ok",
    label: `Vence ${formatearCorto(f)}`,
    bgText: "bg-emerald-50 text-emerald-700",
  };
}

function formatearCorto(f: Date): string {
  return `${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(2, "0")}/${f.getFullYear()}`;
}
