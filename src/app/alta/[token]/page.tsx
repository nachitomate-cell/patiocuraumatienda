import type { Metadata } from "next";
import { AltaEmprendedorScreen } from "./AltaEmprendedorScreen";
import { NEGOCIO } from "@/lib/negocio";

// Manifest propio por token: la PWA instalada desde el portal abre el
// portal del emprendedor, no el POS (ver manifest.webmanifest/route.ts).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return {
    title: `Mi Portal — ${NEGOCIO.nombre}`,
    manifest: `/alta/${token}/manifest.webmanifest`,
  };
}

export default async function AltaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AltaEmprendedorScreen token={token} />;
}
