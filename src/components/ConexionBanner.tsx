"use client";

import { useEffect, useState } from "react";
import { waitForPendingWrites } from "firebase/firestore";
import { WifiOff, RefreshCw, Check } from "lucide-react";
import { getDb, isFirebaseConfigured } from "@/lib/firebase";

type Estado = "online" | "offline" | "sincronizando" | "sincronizado";

export function ConexionBanner() {
  const [estado, setEstado] = useState<Estado>("online");

  useEffect(() => {
    if (!navigator.onLine) setEstado("offline");

    const onOffline = () => setEstado("offline");
    const onOnline = async () => {
      setEstado("sincronizando");
      try {
        // Espera a que Firestore termine de subir lo guardado sin conexión.
        if (isFirebaseConfigured) await waitForPendingWrites(getDb());
      } catch {
        /* ignore */
      }
      setEstado("sincronizado");
      setTimeout(() => setEstado("online"), 3000);
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (estado === "online") return null;

  const cfg: Record<
    "offline" | "sincronizando" | "sincronizado",
    { bg: string; texto: string; Icon: typeof WifiOff; girar?: boolean }
  > = {
    offline: {
      bg: "bg-amber-500",
      texto:
        "Sin conexión — puedes seguir trabajando; los cambios se subirán solos al reconectar.",
      Icon: WifiOff,
    },
    sincronizando: {
      bg: "bg-cyan-600",
      texto: "Conexión restablecida. Subiendo datos guardados…",
      Icon: RefreshCw,
      girar: true,
    },
    sincronizado: {
      bg: "bg-emerald-600",
      texto: "Datos sincronizados con la nube.",
      Icon: Check,
    },
  };

  const { bg, texto, Icon, girar } = cfg[estado];

  return (
    <div className={`no-print fixed bottom-0 left-0 right-0 z-50 ${bg} text-white shadow-lg`}>
      <div className="mx-auto max-w-[1600px] px-4 py-2.5 flex items-center gap-2 justify-center text-center text-sm font-medium">
        <Icon size={18} className={girar ? "animate-spin" : ""} />
        <span>{texto}</span>
      </div>
    </div>
  );
}
