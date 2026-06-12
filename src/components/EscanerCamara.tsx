"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { X } from "lucide-react";

interface Props {
  onDetectar: (codigo: string) => void;
  onCerrar: () => void;
}

// Escáner de código de barras con la cámara del dispositivo (tablet/celular/webcam).
export function EscanerCamara({ onDetectar, onCerrar }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const ultimo = useRef<{ valor: string; t: number }>({ valor: "", t: 0 });

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (!result) return;
        const valor = result.getText();
        const ahora = Date.now();
        // Evita lecturas repetidas del mismo código en menos de 1,5 s.
        if (valor === ultimo.current.valor && ahora - ultimo.current.t < 1500) return;
        ultimo.current = { valor, t: ahora };
        onDetectar(valor);
      })
      .then((c) => {
        controls = c;
      })
      .catch(() => {
        setError("No se pudo abrir la cámara. Revise los permisos del navegador.");
      });

    return () => controls?.stop();
  }, [onDetectar]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
          <span className="font-semibold">Escanear código de barras</span>
          <button onClick={onCerrar} aria-label="Cerrar" className="p-1 hover:bg-slate-700 rounded">
            <X size={22} />
          </button>
        </div>
        <div className="relative bg-black aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-3/4 h-1/3 border-2 border-cyan-400 rounded-lg" />
          </div>
        </div>
        <div className="p-3 text-center text-sm text-slate-600">
          {error ? (
            <span className="text-red-600">{error}</span>
          ) : (
            "Apunte la cámara al código de barras del producto"
          )}
        </div>
      </div>
    </div>
  );
}
