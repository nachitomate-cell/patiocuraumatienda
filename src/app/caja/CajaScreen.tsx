"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet,
  Banknote,
  CreditCard,
  WalletCards,
  ArrowLeftRight,
  Notebook,
  PlayCircle,
  StopCircle,
  Plus,
  Minus,
  TriangleAlert,
  History,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  abrirCaja,
  cajaAbierta,
  cerrarCaja,
  registrarRetiro,
  ultimasCajas,
  ventasEnRango,
} from "@/lib/repo";
import type { Caja, MedioPago, Venta } from "@/lib/types";
import { money } from "@/lib/format";
import { Modal } from "@/components/Modal";
import { useVendedor } from "@/lib/vendedor";

const MEDIO_LABEL: Record<MedioPago, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  fiado: "Fiado",
};

const MEDIO_ICONO: Record<MedioPago, React.ReactNode> = {
  efectivo: <Banknote size={16} />,
  debito: <CreditCard size={16} />,
  credito: <WalletCards size={16} />,
  transferencia: <ArrowLeftRight size={16} />,
  fiado: <Notebook size={16} />,
};

export function CajaScreen() {
  const vendedor = useVendedor();
  const [caja, setCaja] = useState<Caja | null>(null);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [historial, setHistorial] = useState<Caja[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Modales
  const [abrirModal, setAbrirModal] = useState(false);
  const [retiroModal, setRetiroModal] = useState(false);
  const [cerrarModal, setCerrarModal] = useState(false);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const actual = await cajaAbierta();
      setCaja(actual);
      if (actual) {
        const vs = await ventasEnRango(actual.aperturaEn, Date.now());
        setVentas(vs);
      } else {
        setVentas([]);
      }
      setHistorial(await ultimasCajas(20));
    } catch (e) {
      setError((e as Error).message || "No se pudo cargar la caja.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Totales del turno
  const m = useMemo(() => {
    const porMedio: Record<MedioPago, number> = {
      efectivo: 0, debito: 0, credito: 0, transferencia: 0, fiado: 0,
    };
    let totalVentas = 0;
    let nVentas = 0;
    for (const v of ventas) {
      totalVentas += v.total;
      nVentas++;
      if (v.medioPago && porMedio[v.medioPago] !== undefined) {
        porMedio[v.medioPago] += v.total;
      }
    }
    const totalRetiros = (caja?.retiros ?? []).reduce((s, r) => s + r.monto, 0);
    const efectivoEsperado = (caja?.fondoInicial ?? 0) + porMedio.efectivo - totalRetiros;
    return { porMedio, totalVentas, nVentas, totalRetiros, efectivoEsperado };
  }, [ventas, caja]);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Wallet className="text-cyan-600" size={22} /> Caja
        </h1>
        <p className="text-sm text-slate-500">
          Lleva el control del efectivo del turno: ventas, retiros y diferencia al cerrar.
        </p>
      </div>

      {cargando && (
        <div className="bg-white rounded-xl shadow p-6 text-center text-slate-500 flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin" /> Cargando…
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}

      {!cargando && !caja && (
        <div className="bg-white rounded-xl shadow p-5 anim-in space-y-3">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <PlayCircle size={18} className="text-emerald-600" /> No hay caja abierta
          </h2>
          <p className="text-sm text-slate-500">
            Abre una caja para empezar a registrar el efectivo del turno.
          </p>
          <button
            onClick={() => setAbrirModal(true)}
            className="btn-accion bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 flex items-center gap-2"
          >
            <PlayCircle size={18} /> Abrir caja
          </button>
        </div>
      )}

      {!cargando && caja && (
        <>
          {/* Saldo + alerta */}
          <SaldoEfectivo
            esperado={m.efectivoEsperado}
            umbral={caja.umbralRetiro}
            fondo={caja.fondoInicial}
            ingresosEf={m.porMedio.efectivo}
            salidas={m.totalRetiros}
            onRetiro={() => setRetiroModal(true)}
            onCerrar={() => setCerrarModal(true)}
            onRefresh={cargar}
          />

          {/* Resumen del turno */}
          <div className="bg-white rounded-xl shadow p-4 anim-in">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="font-semibold text-slate-800">Turno actual</h2>
              <span className="text-xs text-slate-500">
                Abierta el {fmtFechaHora(caja.aperturaEn)}
                {caja.abridoPor && ` por ${caja.abridoPor}`}
              </span>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <Mini label="Ventas del turno" valor={m.nVentas.toLocaleString("es-CL")} />
              <Mini label="Total vendido" valor={money(m.totalVentas)} />
              <Mini label="Fondo inicial" valor={money(caja.fondoInicial)} />
            </div>
            <div className="mt-4 space-y-2">
              {(Object.keys(MEDIO_LABEL) as MedioPago[]).map((mp) => (
                <FilaMedio key={mp} medio={mp} monto={m.porMedio[mp]} total={m.totalVentas} />
              ))}
            </div>
          </div>

          {/* Retiros del turno */}
          <div className="bg-white rounded-xl shadow p-4 anim-in">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                <Minus size={18} className="text-red-600" /> Retiros del turno (
                {caja.retiros?.length ?? 0})
              </h2>
              <button
                onClick={() => setRetiroModal(true)}
                className="text-sm font-semibold text-cyan-700 hover:text-cyan-800 flex items-center gap-1"
              >
                <Plus size={14} /> Registrar retiro
              </button>
            </div>
            {(!caja.retiros || caja.retiros.length === 0) ? (
              <p className="text-sm text-slate-400 py-3 text-center">Aún no hay retiros.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {caja.retiros.map((r, i) => (
                  <li key={i} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800">{money(r.monto)}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {fmtHora(r.hora)} · {r.motivo || "sin motivo"} ·{" "}
                        {r.vendedor || "sin vendedor"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Historial de cajas */}
      <div className="bg-white rounded-xl shadow anim-in">
        <button
          onClick={() => setHistorialAbierto((a) => !a)}
          className="w-full px-4 py-3 flex items-center justify-between text-left"
        >
          <span className="font-semibold text-slate-800 flex items-center gap-2">
            <History size={18} className="text-slate-500" /> Cajas anteriores ({historial.length})
          </span>
          {historialAbierto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {historialAbierto && (
          <div className="border-t border-slate-100">
            {historial.length === 0 ? (
              <p className="p-4 text-sm text-slate-400 text-center">Aún no hay cajas cerradas.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {historial.map((c) => (
                  <FilaHistorial key={c.id} c={c} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Modales */}
      <ModalAbrirCaja
        abierto={abrirModal}
        vendedor={vendedor}
        busy={busy}
        onCerrar={() => setAbrirModal(false)}
        onConfirmar={async (fondo, umbral) => {
          setBusy(true);
          try {
            await abrirCaja(fondo, umbral, vendedor);
            setAbrirModal(false);
            await cargar();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />

      <ModalRetiro
        abierto={retiroModal}
        saldoEfectivo={m.efectivoEsperado}
        vendedor={vendedor}
        busy={busy}
        onCerrar={() => setRetiroModal(false)}
        onConfirmar={async (monto, motivo) => {
          if (!caja) return;
          setBusy(true);
          try {
            await registrarRetiro(caja.id, {
              monto,
              motivo,
              hora: Date.now(),
              vendedor,
            });
            setRetiroModal(false);
            await cargar();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />

      <ModalCerrarCaja
        abierto={cerrarModal}
        esperado={m.efectivoEsperado}
        vendedor={vendedor}
        busy={busy}
        onCerrar={() => setCerrarModal(false)}
        onConfirmar={async (contado, notas) => {
          if (!caja) return;
          setBusy(true);
          try {
            await cerrarCaja(caja.id, contado, m.efectivoEsperado, vendedor, notas);
            setCerrarModal(false);
            await cargar();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

// ===== Sub-componentes =====

function SaldoEfectivo({
  esperado, umbral, fondo, ingresosEf, salidas, onRetiro, onCerrar, onRefresh,
}: {
  esperado: number;
  umbral: number;
  fondo: number;
  ingresosEf: number;
  salidas: number;
  onRetiro: () => void;
  onCerrar: () => void;
  onRefresh: () => void;
}) {
  const superaUmbral = umbral > 0 && esperado > umbral;
  return (
    <div className={`rounded-xl shadow p-5 anim-in ${
      superaUmbral
        ? "bg-amber-50 border-2 border-amber-300"
        : "bg-gradient-to-br from-emerald-600 to-emerald-700 text-white"
    }`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className={`text-xs uppercase tracking-wider ${
            superaUmbral ? "text-amber-700" : "text-emerald-100"
          }`}>
            Efectivo esperado en caja
          </div>
          <div className={`text-4xl font-bold leading-tight ${
            superaUmbral ? "text-amber-900" : "text-white"
          }`}>
            {money(esperado)}
          </div>
          {superaUmbral && (
            <div className="mt-2 text-sm text-amber-900 flex items-center gap-1.5 font-semibold">
              <TriangleAlert size={16} />
              Superó el umbral de {money(umbral)}. Conviene retirar.
            </div>
          )}
          <div className={`mt-2 text-xs ${
            superaUmbral ? "text-amber-700" : "text-emerald-100"
          }`}>
            {money(fondo)} fondo + {money(ingresosEf)} ventas efectivo − {money(salidas)} retiros
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={onRetiro}
            className={`btn-accion font-semibold rounded-lg px-4 py-2 flex items-center gap-2 ${
              superaUmbral
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "bg-white/95 hover:bg-white text-emerald-700"
            }`}
          >
            <Minus size={16} /> Retiro
          </button>
          <button
            onClick={onCerrar}
            className={`btn-accion font-semibold rounded-lg px-4 py-2 flex items-center gap-2 ${
              superaUmbral
                ? "bg-slate-200 hover:bg-slate-300 text-slate-800"
                : "bg-emerald-800 hover:bg-emerald-900 text-white"
            }`}
          >
            <StopCircle size={16} /> Cerrar caja
          </button>
          <button
            onClick={onRefresh}
            className={`text-xs ${
              superaUmbral ? "text-amber-700 hover:text-amber-900" : "text-emerald-100 hover:text-white"
            }`}
            title="Refrescar"
          >
            Refrescar
          </button>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-800">{valor}</div>
    </div>
  );
}

function FilaMedio({ medio, monto, total }: { medio: MedioPago; monto: number; total: number }) {
  const pct = total > 0 ? (monto / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="flex items-center gap-1.5 text-slate-700 font-medium">
          {MEDIO_ICONO[medio]} {MEDIO_LABEL[medio]}
        </span>
        <span className="text-slate-500">
          <span className="font-semibold text-slate-800">{money(monto)}</span> · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FilaHistorial({ c }: { c: Caja }) {
  const [open, setOpen] = useState(false);
  const cerrada = c.cerradaEn != null;
  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-slate-50"
      >
        <div>
          <div className="font-semibold text-slate-800 text-sm">
            {fmtFechaHora(c.aperturaEn)}
            {cerrada ? (
              <span className="text-slate-500 font-normal">
                {" "}→ {fmtFechaHora(c.cerradaEn as number)}
              </span>
            ) : (
              <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-semibold">
                Abierta
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Fondo {money(c.fondoInicial)} · {(c.retiros ?? []).length} retiro(s)
            {cerrada && c.diferencia !== undefined && (
              <span className={`ml-2 font-semibold ${
                c.diferencia === 0 ? "text-emerald-600"
                : c.diferencia > 0 ? "text-cyan-600"
                : "text-red-600"
              }`}>
                {c.diferencia === 0 ? "cuadrada" : `${c.diferencia > 0 ? "+" : ""}${money(c.diferencia)}`}
              </span>
            )}
          </div>
        </div>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="px-4 pb-3 text-xs text-slate-600 grid sm:grid-cols-2 gap-1">
          <span>Abrió: <strong>{c.abridoPor || "—"}</strong></span>
          <span>Cerró: <strong>{c.cerradoPor || "—"}</strong></span>
          <span>Umbral retiro: <strong>{money(c.umbralRetiro)}</strong></span>
          {c.cierreContado !== undefined && (
            <span>Contado al cerrar: <strong>{money(c.cierreContado)}</strong></span>
          )}
          {c.notas && <span className="sm:col-span-2 italic">Notas: {c.notas}</span>}
          {(c.retiros ?? []).length > 0 && (
            <ul className="sm:col-span-2 mt-2 space-y-0.5">
              {c.retiros.map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span>{fmtHora(r.hora)} · {r.motivo || "—"} ({r.vendedor || "—"})</span>
                  <span className="font-semibold text-slate-700">{money(r.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ===== Modales =====

function ModalAbrirCaja({
  abierto, vendedor, busy, onCerrar, onConfirmar,
}: {
  abierto: boolean; vendedor: string; busy: boolean;
  onCerrar: () => void;
  onConfirmar: (fondo: number, umbral: number) => Promise<void>;
}) {
  const [fondo, setFondo] = useState(0);
  const [umbral, setUmbral] = useState(200000);

  useEffect(() => {
    if (abierto) { setFondo(0); setUmbral(200000); }
  }, [abierto]);

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Abrir caja" maxW="max-w-md">
      <div className="space-y-3">
        <Campo label="Fondo inicial (efectivo con que abres)">
          <input
            type="number" min={0} inputMode="numeric" autoFocus
            value={fondo || ""}
            onChange={(e) => setFondo(Math.max(0, Number(e.target.value) || 0))}
            placeholder="0"
            className="w-full border-2 rounded-xl px-4 py-2.5 text-lg"
          />
        </Campo>
        <Campo label="Umbral para sugerir retiro (alerta cuando el efectivo lo supere)">
          <input
            type="number" min={0} inputMode="numeric"
            value={umbral || ""}
            onChange={(e) => setUmbral(Math.max(0, Number(e.target.value) || 0))}
            placeholder="0 = sin alerta"
            className="w-full border-2 rounded-xl px-4 py-2.5 text-lg"
          />
        </Campo>
        <p className="text-xs text-slate-500">
          Abre como: <strong>{vendedor || "Sin vendedor"}</strong> (cámbialo en el chip del header).
        </p>
        <button
          onClick={() => onConfirmar(fondo, umbral)}
          disabled={busy}
          className="btn-accion w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <PlayCircle size={18} />}
          Abrir caja
        </button>
      </div>
    </Modal>
  );
}

function ModalRetiro({
  abierto, saldoEfectivo, vendedor, busy, onCerrar, onConfirmar,
}: {
  abierto: boolean; saldoEfectivo: number; vendedor: string; busy: boolean;
  onCerrar: () => void;
  onConfirmar: (monto: number, motivo: string) => Promise<void>;
}) {
  const [monto, setMonto] = useState(0);
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (abierto) { setMonto(0); setMotivo(""); }
  }, [abierto]);

  const excede = monto > saldoEfectivo;
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Registrar retiro" maxW="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Efectivo en caja: <strong className="text-slate-800">{money(saldoEfectivo)}</strong>
        </p>
        <Campo label="Monto a retirar">
          <input
            type="number" min={0} inputMode="numeric" autoFocus
            value={monto || ""}
            onChange={(e) => setMonto(Math.max(0, Number(e.target.value) || 0))}
            placeholder="0"
            className="w-full border-2 rounded-xl px-4 py-2.5 text-lg"
          />
        </Campo>
        <Campo label="Motivo (opcional)">
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: depósito banco, vuelto, etc."
            className="w-full border rounded-lg px-3 py-2"
          />
        </Campo>
        {excede && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            El retiro ({money(monto)}) excede el efectivo en caja. Igual puedes registrarlo si
            corresponde a un faltante real.
          </p>
        )}
        <p className="text-xs text-slate-500">
          Retira: <strong>{vendedor || "Sin vendedor"}</strong>
        </p>
        <button
          onClick={() => onConfirmar(monto, motivo)}
          disabled={busy || monto <= 0}
          className="btn-accion w-full bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Minus size={18} />}
          Registrar retiro
        </button>
      </div>
    </Modal>
  );
}

function ModalCerrarCaja({
  abierto, esperado, vendedor, busy, onCerrar, onConfirmar,
}: {
  abierto: boolean; esperado: number; vendedor: string; busy: boolean;
  onCerrar: () => void;
  onConfirmar: (contado: number, notas: string) => Promise<void>;
}) {
  const [contado, setContado] = useState(0);
  const [notas, setNotas] = useState("");

  useEffect(() => {
    if (abierto) { setContado(esperado); setNotas(""); }
  }, [abierto, esperado]);

  const diferencia = contado - esperado;
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Cerrar caja" maxW="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Esperado en caja: <strong className="text-slate-800">{money(esperado)}</strong>
        </p>
        <Campo label="Efectivo contado físicamente">
          <input
            type="number" min={0} inputMode="numeric" autoFocus
            value={contado || ""}
            onChange={(e) => setContado(Math.max(0, Number(e.target.value) || 0))}
            placeholder="0"
            className="w-full border-2 rounded-xl px-4 py-2.5 text-lg"
          />
        </Campo>
        <div className={`rounded-lg px-3 py-2 text-sm font-semibold flex items-center justify-between ${
          diferencia === 0 ? "bg-emerald-50 text-emerald-700"
          : diferencia > 0 ? "bg-cyan-50 text-cyan-700"
          : "bg-red-50 text-red-700"
        }`}>
          <span>Diferencia</span>
          <span>
            {diferencia === 0 ? "Cuadrada"
              : diferencia > 0 ? `Sobran ${money(diferencia)}`
              : `Faltan ${money(-diferencia)}`}
          </span>
        </div>
        <Campo label="Notas (opcional)">
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Comentarios del cierre…"
            rows={2}
            className="w-full border rounded-lg px-3 py-2"
          />
        </Campo>
        <p className="text-xs text-slate-500">
          Cierra: <strong>{vendedor || "Sin vendedor"}</strong>
        </p>
        <button
          onClick={() => onConfirmar(contado, notas)}
          disabled={busy}
          className="btn-accion w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          Cerrar caja
        </button>
      </div>
    </Modal>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ===== Formato =====

function fmtFechaHora(t: number): string {
  const d = new Date(t);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes} ${fmtHora(t)}`;
}

function fmtHora(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
