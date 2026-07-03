// Formato de moneda chilena (CLP, sin decimales).
const clp = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

export function money(n: number): string {
  return clp.format(Math.round(n || 0));
}

// Fecha "de hoy" en formato yyyy-mm-dd según la zona horaria local del usuario
// (America/Santiago en el uso real). toISOString() da UTC y por eso, después
// de las 20:00 CLT (UTC-4), retornaba mañana — bug en /historial que abría
// el día siguiente. Componer con getFullYear/getMonth/getDate evita el desfase.
export function hoyISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
