// Formato de moneda chilena (CLP, sin decimales).
const clp = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

export function money(n: number): string {
  return clp.format(Math.round(n || 0));
}

export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}
