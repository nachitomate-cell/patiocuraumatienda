"use client";

import { useEffect, useState } from "react";
import { Receipt, Eye, EyeOff } from "lucide-react";
import { BoletaEditor } from "@/components/BoletaEditor";
import { Ticket } from "@/components/Ticket";
import { getBoletaConfig, guardarBoletaConfig } from "@/lib/repo";
import { useNegocio, useRecargarNegocio } from "@/lib/negocio-context";
import type { BoletaConfig } from "@/lib/negocio";

// Página /boleta del POS: edita el formato y los textos de la boleta impresa
// y muestra una vista previa con datos de ejemplo. Se guarda en la sub-doc
// negocios/{slug}/config/boleta (escritura permitida a anónimos por las
// reglas; el doc raíz del negocio sigue restringido a moderador).
export function BoletaConfigScreen() {
  const NEGOCIO = useNegocio();
  const recargarNegocio = useRecargarNegocio();
  const [inicial, setInicial] = useState<BoletaConfig | null>(null);
  // `vivo` refleja en tiempo real lo que está editando el usuario para
  // alimentar el preview del Ticket sin tener que esperar el save.
  const [vivo, setVivo] = useState<BoletaConfig>({});
  const [cargando, setCargando] = useState(true);
  const [verPreview, setVerPreview] = useState(true);

  useEffect(() => {
    if (!NEGOCIO.slug) return;
    getBoletaConfig(NEGOCIO.slug)
      .then((b) => {
        const cfg = b || {};
        setInicial(cfg);
        setVivo(cfg);
      })
      .catch(() => {
        setInicial({});
        setVivo({});
      })
      .finally(() => setCargando(false));
  }, [NEGOCIO.slug]);

  async function guardar(cfg: BoletaConfig) {
    await guardarBoletaConfig(NEGOCIO.slug, cfg);
    setInicial(cfg);
    setVivo(cfg);
    // Vuelve a leer el branding completo desde Firestore para que el resto
    // del POS (impresión real, historial, reimpresiones) tome la config
    // recién guardada sin que el usuario tenga que recargar.
    await recargarNegocio();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Receipt className="text-cyan-600" size={22} /> Boleta
        </h1>
        <p className="text-sm text-slate-500">
          Cambia los textos y qué se imprime en la boleta de este negocio.
          Los cambios se aplican a todas las ventas nuevas y a las
          reimpresiones del historial.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_auto] gap-4 items-start">
        {/* Editor */}
        <div className="bg-white rounded-xl shadow p-5 anim-in">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">Configuración</h2>
            <button
              onClick={() => setVerPreview((v) => !v)}
              className="text-xs flex items-center gap-1.5 text-slate-500 hover:text-slate-700"
            >
              {verPreview ? <EyeOff size={14} /> : <Eye size={14} />}
              {verPreview ? "Ocultar preview" : "Ver preview"}
            </button>
          </div>
          {cargando ? (
            <p className="text-slate-400 text-sm py-3 text-center">Cargando…</p>
          ) : (
            <BoletaEditor inicial={inicial || {}} onGuardar={guardar} onCambio={setVivo} />
          )}
        </div>

        {/* Preview */}
        {verPreview && !cargando && (
          <aside className="anim-in flex justify-center lg:sticky lg:top-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">
                Vista previa
              </div>
              <Ticket
                nro="NV-EJEMPLO"
                fecha={new Date().toISOString().slice(0, 10)}
                cliente="Consumidor Final"
                items={[
                  {
                    codigo: "ALFO-0001",
                    descripcion: "Ejemplo de producto",
                    cantidad: 2,
                    precio: 3500,
                    descuento: 0,
                  },
                  {
                    codigo: "AMON-0042",
                    descripcion: "Otro ejemplo",
                    cantidad: 1,
                    precio: 9990,
                    descuento: 10,
                  },
                ]}
                total={2 * 3500 + 9990 * 0.9}
                vendedor="Camila"
                medioPago="efectivo"
                cfgOverride={vivo}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
