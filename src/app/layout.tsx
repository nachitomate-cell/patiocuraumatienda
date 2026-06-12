import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { UiModeProvider } from "@/lib/uimode";
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "Patio Curauma POS",
  description: "Punto de venta e inventario - Patio Curauma",
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
    <html lang="es">
      <body className="min-h-screen">
        <AuthProvider>
          <UiModeProvider>{children}</UiModeProvider>
        </AuthProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
