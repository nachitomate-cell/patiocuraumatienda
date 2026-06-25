"use client";

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import type { BoletaConfig } from "@/lib/negocio";

interface Props {
  // Valor inicial (puede ser {}). Si cambia (ej. cambiar de negocio en
  // moderador), el editor se reinicia con los nuevos valores.
  inicial: BoletaConfig;
  onGuardar: (cfg: BoletaConfig) => Promise<void>;
  // Texto del botón. Default: "Guardar cambios".
  textoBoton?: string;
  // Si true, muestra un encabezado/título. En la página /boleta no hace
  // falta porque ya hay un h1 arriba; en el modal del moderador sí.
  conTitulo?: boolean;
}

// Editor de la boleta impresa. Lo usan dos pantallas:
//  - /boleta (POS): para que el cajero/dueño edite sin login.
//  - /moderador (modal de negocio): para que un moderador remoto la edite.
// El persistence lo controla el padre vía onGuardar (puede apuntar a la
// sub-colección o, en el moderador, también a otros campos del negocio).
export function BoletaEditor({ inicial, onGuardar, textoBoton, conTitulo }: Props) {
  const [boleta, setBoleta] = useState<BoletaConfig>(inicial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // Si cambia el inicial (ej. recarga, cambio de tenant), re-syncear.
  useEffect(() => {
    setBoleta(inicial);
    setMsg(null);
  }, [inicial]);

  function set<K extends keyof BoletaConfig>(k: K, v: BoletaConfig[K]) {
    setBoleta((b) => ({ ...b, [k]: v }));
  }

  async function guardar() {
    setBusy(true);
    setMsg(null);
    try {
      await onGuardar({
        ...boleta,
        mensajeSuperior: (boleta.mensajeSuperior || "").trim(),
        mensajeInferior: (boleta.mensajeInferior || "").trim(),
        textoGracias: (boleta.textoGracias || "").trim(),
      });
      setMsg({ tipo: "ok", texto: "Boleta guardada." });
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg({
        tipo: "error",
        texto: e instanceof Error ? e.message : "No se pudo guardar.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {conTitulo && (
        <div>
          <h3 className="font-semibold text-slate-800">Boleta impresa</h3>
          <p className="text-xs text-slate-500">
            Controla qué líneas aparecen y agrega textos arriba/abajo del detalle.
            Lo que dejes en blanco no se imprime.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <Campo label="Mensaje superior (bajo el nombre)">
          <textarea
            value={boleta.mensajeSuperior || ""}
            onChange={(e) => set("mensajeSuperior", e.target.value)}
            placeholder="Ej: RUT 76.123.456-7&#10;Horario: L-V 10-21 hrs"
            rows={2}
            className={inputCls}
          />
        </Campo>
        <Campo label="Mensaje inferior (antes del gracias)">
          <textarea
            value={boleta.mensajeInferior || ""}
            onChange={(e) => set("mensajeInferior", e.target.value)}
            placeholder="Ej: Cambios hasta 7 días con boleta"
            rows={2}
            className={inputCls}
          />
        </Campo>
        <Campo label='Texto de cierre (default "¡GRACIAS POR SU COMPRA!")'>
          <input
            value={boleta.textoGracias || ""}
            onChange={(e) => set("textoGracias", e.target.value)}
            placeholder="¡GRACIAS POR SU COMPRA!"
            className={inputCls}
          />
        </Campo>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Toggle
          label="Eslogan"
          valor={boleta.mostrarEslogan ?? false}
          onChange={(v) => set("mostrarEslogan", v)}
          hint="(default: oculto)"
        />
        <Toggle
          label="Rubro"
          valor={boleta.mostrarRubro ?? true}
          onChange={(v) => set("mostrarRubro", v)}
        />
        <Toggle
          label="Ubicación"
          valor={boleta.mostrarUbicacion ?? true}
          onChange={(v) => set("mostrarUbicacion", v)}
        />
        <Toggle
          label="Web"
          valor={boleta.mostrarWeb ?? true}
          onChange={(v) => set("mostrarWeb", v)}
        />
        <Toggle
          label="Instagram"
          valor={boleta.mostrarInstagram ?? true}
          onChange={(v) => set("mostrarInstagram", v)}
        />
        <Toggle
          label="QR Club de Fidelización"
          valor={boleta.mostrarQrClub ?? true}
          onChange={(v) => set("mostrarQrClub", v)}
        />
        <Toggle
          label="Nombre del vendedor"
          valor={boleta.mostrarVendedor ?? false}
          onChange={(v) => set("mostrarVendedor", v)}
          hint="(default: oculto)"
        />
        <Toggle
          label="Medio de pago"
          valor={boleta.mostrarMedioPago ?? false}
          onChange={(v) => set("mostrarMedioPago", v)}
          hint="(default: oculto)"
        />
      </div>

      {msg && (
        <div
          className={`text-sm rounded-lg px-3 py-2 border ${
            msg.tipo === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {msg.texto}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={guardar}
          disabled={busy}
          className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {textoBoton || "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

const inputCls = "w-full border rounded-lg px-3 py-2 text-sm";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Toggle({
  label,
  valor,
  onChange,
  hint,
}: {
  label: string;
  valor: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer">
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-cyan-600"
      />
      <span className="text-slate-700">{label}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
