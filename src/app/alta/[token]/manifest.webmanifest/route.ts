import { NEGOCIO } from "@/lib/negocio";

// Manifest PWA específico del portal del emprendedor. El manifest global
// (/manifest.webmanifest) tiene start_url /venta: si un emprendedor
// instalara desde ahí, la app abriría el POS del local (la misma confusión
// del caso Nimapa). Este manifest apunta start_url/scope a SU link con
// token, y el `id` distinto permite que su portal conviva instalado junto
// al POS en el mismo teléfono.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  // Va incrustado en URLs del manifest: solo caracteres de token válidos.
  const t = token.replace(/[^a-zA-Z0-9_-]/g, "");
  const manifest = {
    name: `Mi Portal — ${NEGOCIO.nombre}`,
    short_name: "Mi Portal",
    description: `Portal del emprendedor — ${NEGOCIO.nombre}`,
    id: `/alta/${t}`,
    start_url: `/alta/${t}`,
    scope: `/alta/${t}`,
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
