import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const sora = Sora({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});
import { UiModeProvider } from "@/lib/uimode";
import { RegisterSW } from "@/components/RegisterSW";
import { ConexionBanner } from "@/components/ConexionBanner";
import { NEGOCIO } from "@/lib/negocio";
import { NegocioProvider } from "@/lib/negocio-context";

export const metadata: Metadata = {
  title: `${NEGOCIO.nombre} POS`,
  description: `Punto de venta e inventario - ${NEGOCIO.nombre}`,
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${sora.variable}`}>
      <body className="min-h-screen">
        <AuthProvider>
          <NegocioProvider>
            <UiModeProvider>{children}</UiModeProvider>
          </NegocioProvider>
        </AuthProvider>
        <ConexionBanner />
        <RegisterSW />
      </body>
    </html>
  );
}
