"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Check, Upload, X, QrCode } from "lucide-react";
import Image from "next/image";
import type { BoletaConfig } from "@/lib/negocio";
import { useNegocio } from "@/lib/negocio-context";

interface Props {
  // Valor inicial (puede ser {}). Si cambia (ej. cambiar de negocio en
  // moderador), el editor se reinicia con los nuevos valores.
  inicial: BoletaConfig;
  onGuardar: (cfg: BoletaConfig) => Promise<void>;
  // Notifica al padre cada cambio del state local: útil para que el preview
  // del Ticket se actualice en vivo mientras se edita.
  onCambio?: (cfg: BoletaConfig) => void;
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
// Tamaño máximo del QR subido como data URL embebido en Firestore. Por
// encima de esto el doc empieza a competir con el límite de 1 MiB. 200 KB del
// archivo original -> ~270 KB en base64, suficiente para un QR razonable.
const MAX_QR_BYTES = 200 * 1024;

export function BoletaEditor({ inicial, onGuardar, onCambio, textoBoton, conTitulo }: Props) {
  const NEGOCIO = useNegocio();
  const [boleta, setBoleta] = useState<BoletaConfig>(inicial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const fileQrRef = useRef<HTMLInputElement>(null);

  // Si cambia el inicial (ej. recarga, cambio de tenant), re-syncear. NO
  // limpia msg: el padre puede reusar `inicial` justo tras guardar (para
  // re-syncear con lo persistido) y nos pisaría el toast de éxito.
  useEffect(() => {
    setBoleta(inicial);
  }, [inicial]);

  // Notifica al padre tras cada cambio del state. Va en un effect (no dentro
  // del updater de setBoleta) para no setear estado de otro componente
  // durante el render: React lo rechaza con un warning visible al usuario.
  useEffect(() => {
    onCambio?.(boleta);
  }, [boleta, onCambio]);

  function set<K extends keyof BoletaConfig>(k: K, v: BoletaConfig[K]) {
    setBoleta((b) => ({ ...b, [k]: v }));
  }

  async function guardar() {
    setBusy(true);
    setMsg(null);
    try {
      // Limpia espacios alrededor de todos los textos antes de persistir.
      const trim = (s: string | undefined) => (s ?? "").trim();
      await onGuardar({
        ...boleta,
        mensajeSuperior: trim(boleta.mensajeSuperior),
        mensajeInferior: trim(boleta.mensajeInferior),
        textoGracias: trim(boleta.textoGracias),
        nombre: trim(boleta.nombre),
        eslogan: trim(boleta.eslogan),
        rubro: trim(boleta.rubro),
        ubicacion: trim(boleta.ubicacion),
        web: trim(boleta.web),
        instagram: trim(boleta.instagram),
        qrClub: trim(boleta.qrClub),
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

  // Lee la imagen elegida y la convierte a data URL para guardarla embebida
  // en el subdoc de la boleta. Limita el tamaño para no romper el doc.
  function onElegirQr(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-elegir el mismo archivo
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg({ tipo: "error", texto: "Elige un archivo de imagen." });
      return;
    }
    if (file.size > MAX_QR_BYTES) {
      setMsg({
        tipo: "error",
        texto: `La imagen pesa ${Math.round(file.size / 1024)} KB. Máximo ${Math.round(MAX_QR_BYTES / 1024)} KB.`,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      set("qrClub", dataUrl);
    };
    reader.onerror = () =>
      setMsg({ tipo: "error", texto: "No se pudo leer la imagen." });
    reader.readAsDataURL(file);
  }

  function quitarQr() {
    set("qrClub", "");
  }

  // Lo que se ve realmente en la boleta para este campo: override si está, si
  // no el branding. Útil como placeholder visible en los inputs.
  const efectivo = (k: "nombre" | "eslogan" | "rubro" | "ubicacion" | "web" | "instagram"): string => {
    const v = (boleta[k] ?? "").trim();
    if (v) return v;
    return String((NEGOCIO[k] as string | undefined) ?? "");
  };
  const qrEfectivo = (boleta.qrClub ?? "").trim() || NEGOCIO.qrClub || "";

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

      {/* Datos visibles en la boleta: si dejas algo en blanco, se usa lo del
          branding del negocio (lo gestiona el moderador). Si escribes algo,
          esa boleta usa tu valor. */}
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
          Datos visibles
        </div>
        <p className="text-xs text-slate-500 mb-2">
          Vacío = se usa el valor del negocio. Con texto = reemplaza solo en la
          boleta impresa.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo label="Nombre del negocio">
            <input
              value={boleta.nombre || ""}
              onChange={(e) => set("nombre", e.target.value)}
              placeholder={NEGOCIO.nombre || ""}
              className={inputCls}
            />
          </Campo>
          <Campo label="Eslogan">
            <input
              value={boleta.eslogan || ""}
              onChange={(e) => set("eslogan", e.target.value)}
              placeholder={NEGOCIO.eslogan || ""}
              className={inputCls}
            />
          </Campo>
          <Campo label="Rubro">
            <input
              value={boleta.rubro || ""}
              onChange={(e) => set("rubro", e.target.value)}
              placeholder={NEGOCIO.rubro || ""}
              className={inputCls}
            />
          </Campo>
          <Campo label="Ubicación">
            <input
              value={boleta.ubicacion || ""}
              onChange={(e) => set("ubicacion", e.target.value)}
              placeholder={NEGOCIO.ubicacion || ""}
              className={inputCls}
            />
          </Campo>
          <Campo label="Sitio web">
            <input
              value={boleta.web || ""}
              onChange={(e) => set("web", e.target.value)}
              placeholder={NEGOCIO.web || ""}
              className={inputCls}
            />
          </Campo>
          <Campo label="Instagram">
            <input
              value={boleta.instagram || ""}
              onChange={(e) => set("instagram", e.target.value)}
              placeholder={NEGOCIO.instagram || ""}
              className={inputCls}
            />
          </Campo>
        </div>
        {/* Indicador de qué valor se está usando si el operador NO escribió override. */}
        <div className="mt-2 text-[11px] text-slate-400">
          Valor actual: {efectivo("nombre")}
        </div>
      </div>

      {/* QR del Club. Acepta URL pegada o imagen subida (se guarda embebida
          como data URL en el subdoc, sin Firebase Storage). */}
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide flex items-center gap-1.5">
          <QrCode size={14} /> QR del Club de Fidelización
        </div>
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-start">
          <Campo label="URL o ruta de la imagen">
            <input
              value={boleta.qrClub || ""}
              onChange={(e) => set("qrClub", e.target.value)}
              placeholder={NEGOCIO.qrClub || "https://… o /qr-club.png"}
              className={inputCls}
            />
          </Campo>
          <div className="flex flex-col gap-1.5 sm:pt-5">
            <input
              ref={fileQrRef}
              type="file"
              accept="image/*"
              onChange={onElegirQr}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileQrRef.current?.click()}
              className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm font-semibold"
            >
              <Upload size={14} /> Subir imagen
            </button>
            {boleta.qrClub && (
              <button
                type="button"
                onClick={quitarQr}
                className="flex items-center gap-1.5 border border-red-300 text-red-600 hover:bg-red-50 rounded-lg px-3 py-2 text-xs font-semibold"
              >
                <X size={14} /> Quitar
              </button>
            )}
          </div>
        </div>
        {qrEfectivo && (
          <div className="mt-2 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Image
              src={qrEfectivo}
              alt="Vista previa del QR"
              width={64}
              height={64}
              unoptimized
              className="rounded border border-slate-200 bg-white object-contain"
            />
            <span className="text-[11px] text-slate-500">
              {boleta.qrClub
                ? boleta.qrClub.startsWith("data:")
                  ? "Imagen subida desde tu dispositivo."
                  : "Usando URL personalizada."
                : "Usando QR del negocio por defecto."}
            </span>
          </div>
        )}
      </div>

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
