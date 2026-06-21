import type { MetadataRoute } from "next";
import { NEGOCIO } from "@/lib/negocio";

// Manifest de la PWA generado desde la configuración del negocio, para que el
// nombre del ícono instalado en el teléfono salga con la marca correcta.
// Next.js lo sirve en /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${NEGOCIO.nombre} POS`,
    short_name: NEGOCIO.nombreCorto,
    description: `Punto de venta e inventario - ${NEGOCIO.nombre}`,
    start_url: "/venta",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
