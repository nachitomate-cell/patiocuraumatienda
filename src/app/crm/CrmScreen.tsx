"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Wallet,
  ShoppingCart,
  Receipt,
  Package,
  Banknote,
  CreditCard,
  Notebook,
  CalendarRange,
  RefreshCw,
} from "lucide-react";
import { ventasEnRango } from "@/lib/repo";
import type { Venta } from "@/lib/types";
import { money } from "@/lib/format";
import { Modal } from "@/components/Modal";
import { SelectorFecha } from "@/components/SelectorFecha";
import { useAtajos } from "@/lib/useAtajos";

type Preset = "dia" | "semana" | "mes" | "anio" | "custom";

const MESES_CORTO = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function sod(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function eod(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}
function isoADate(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmtCorto(iso: string): string {
  const f = isoADate(iso);
  if (!f) return "—";
  return `${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(2, "0")}`;
}

function rangoDe(preset: Preset, desdeIso: string, hastaIso: string) {
  const now = new Date();
  if (preset === "dia") return { desde: sod(now), hasta: eod(now), etiqueta: "Hoy" };
  if (preset === "semana") {
    const lunes = new Date(now);
    lunes.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const dom = new Date(lunes);
    dom.setDate(lunes.getDate() + 6);
    return { desde: sod(lunes), hasta: eod(dom), etiqueta: "Esta semana" };
  }
  if (preset === "mes") {
    const ini = new Date(now.getFullYear(), now.getMonth(), 1);
    const fin = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { desde: sod(ini), hasta: eod(fin), etiqueta: "Este mes" };
  }
  if (preset === "anio") {
    return {
      desde: sod(new Date(now.getFullYear(), 0, 1)),
      hasta: eod(new Date(now.getFullYear(), 11, 31)),
      etiqueta: String(now.getFullYear()),
    };
  }
  const di = isoADate(desdeIso) ?? now;
  const ha = isoADate(hastaIso) ?? now;
  return { desde: sod(di), hasta: eod(ha), etiqueta: `${fmtCorto(desdeIso)} – ${fmtCorto(hastaIso)}` };
}

interface Barra {
  label: string;
  total: number;
}

function construirSerie(ventas: Venta[], desde: number, hasta: number): Barra[] {
  const DAY = 86400000;
  const span = hasta - desde;
  const gran: "hora" | "dia" | "mes" = span <= DAY * 1.6 ? "hora" : span <= DAY * 70 ? "dia" : "mes";
  const buckets = new Map<string, number>();
  const orden: { key: string; label: string }[] = [];

  if (gran === "hora") {
    for (let h = 0; h < 24; h++) {
      const key = "h" + h;
      orden.push({ key, label: `${h}h` });
      buckets.set(key, 0);
    }
    for (const v of ventas) {
      const key = "h" + new Date(v.creadoEn).getHours();
      buckets.set(key, (buckets.get(key) ?? 0) + v.total);
    }
  } else if (gran === "dia") {
    const ini = new Date(desde);
    ini.setHours(0, 0, 0, 0);
    for (let t = ini.getTime(); t <= hasta; t += DAY) {
      const d = new Date(t);
      const key = "d" + sod(d);
      orden.push({ key, label: `${d.getDate()}/${d.getMonth() + 1}` });
      buckets.set(key, 0);
    }
    for (const v of ventas) {
      const key = "d" + sod(new Date(v.creadoEn));
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + v.total);
    }
  } else {
    const ini = new Date(desde);
    const cur = new Date(ini.getFullYear(), ini.getMonth(), 1);
    const fin = new Date(hasta);
    while (cur.getTime() <= fin.getTime()) {
      const key = `m${cur.getFullYear()}-${cur.getMonth()}`;
      orden.push({ key, label: MESES_CORTO[cur.getMonth()] });
      buckets.set(key, 0);
      cur.setMonth(cur.getMonth() + 1);
    }
    for (const v of ventas) {
      const d = new Date(v.creadoEn);
      const key = `m${d.getFullYear()}-${d.getMonth()}`;
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + v.total);
    }
  }
  return orden.map((o) => ({ label: o.label, total: buckets.get(o.key) ?? 0 }));
}

export function CrmScreen() {
  const [preset, setPreset] = useState<Preset>("dia");
  const [desdeIso, setDesdeIso] = useState("");
  const [hastaIso, setHastaIso] = useState("");
  const [modalRango, setModalRango] = useState(false);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const { desde, hasta, etiqueta } = useMemo(
    () => rangoDe(preset, desdeIso, hastaIso),
    [preset, desdeIso, hastaIso]
  );

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      setVentas(await ventasEnRango(desde, hasta));
    } catch {
      setError("No se pudieron cargar las métricas. Revise la conexión.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  const m = useMemo(() => {
    let total = 0,
      unidades = 0;
    const medios = { efectivo: 0, transferencia: 0, fiado: 0 } as Record<string, number>;
    const prod = new Map<string, { desc: string; monto: number; cant: number }>();
    for (const v of ventas) {
      total += v.total;
      if (v.medioPago && medios[v.medioPago] !== undefined) medios[v.medioPago] += v.total;
      for (const l of v.items) {
        unidades += l.cantidad;
        const sub = l.cantidad * l.precio * (1 - (l.descuento || 0) / 100);
        const key = l.codigo || l.descripcion;
        const e = prod.get(key) ?? { desc: l.descripcion, monto: 0, cant: 0 };
        e.monto += sub;
        e.cant += l.cantidad;
        prod.set(key, e);
      }
    }
    const top = [...prod.values()].sort((a, b) => b.monto - a.monto).slice(0, 8);
    return {
      total,
      nVentas: ventas.length,
      ticket: ventas.length ? total / ventas.length : 0,
      unidades,
      medios,
      top,
    };
  }, [ventas]);

  const serie = useMemo(() => construirSerie(ventas, desde, hasta), [ventas, desde, hasta]);
  const maxBarra = Math.max(1, ...serie.map((b) => b.total));
  const maxTop = Math.max(1, ...m.top.map((t) => t.monto));

  const PRESETS: { id: Preset; label: string }[] = [
    { id: "dia", label: "Día" },
    { id: "semana", label: "Semana" },
    { id: "mes", label: "Mes" },
    { id: "anio", label: "Año" },
  ];

  function aplicarRango() {
    if (!desdeIso || !hastaIso) return;
    setPreset("custom");
    setModalRango(false);
  }

  useAtajos({
    "alt+d": () => setPreset("dia"),
    "alt+s": () => setPreset("semana"),
    "alt+m": () => setPreset("mes"),
    "alt+a": () => setPreset("anio"),
    "alt+p": () => setModalRango(true),
  });

  return (
    <div className="space-y-4">
      {/* Encabezado + selector de periodo */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="text-cyan-600" size={22} /> CRM — Métricas
          </h1>
          <button
            onClick={cargar}
            className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm"
            title="Actualizar"
          >
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
                preset === p.id
                  ? "bg-cyan-600 text-white border-cyan-600"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setModalRango(true)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border ${
              preset === "custom"
                ? "bg-cyan-600 text-white border-cyan-600"
                : "bg-white text-cyan-700 border-cyan-300 hover:bg-cyan-50"
            }`}
          >
            <CalendarRange size={16} /> Personalizado
          </button>
          <span className="ml-auto self-center text-sm text-slate-500">
            Periodo: <span className="font-semibold text-slate-700">{etiqueta}</span>
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-white rounded-xl shadow p-4 text-center text-red-500">{error}</div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icon={<Wallet size={20} />}
          label="Total vendido"
          valor={money(m.total)}
          color="emerald"
          cargando={cargando}
        />
        <Kpi
          icon={<ShoppingCart size={20} />}
          label="N° de ventas"
          valor={m.nVentas.toLocaleString("es-CL")}
          color="cyan"
          cargando={cargando}
        />
        <Kpi
          icon={<Receipt size={20} />}
          label="Ticket promedio"
          valor={money(m.ticket)}
          color="violet"
          cargando={cargando}
        />
        <Kpi
          icon={<Package size={20} />}
          label="Unidades vendidas"
          valor={m.unidades.toLocaleString("es-CL")}
          color="amber"
          cargando={cargando}
        />
      </div>

      {/* Gráfico de ventas en el tiempo */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <BarChart3 size={18} className="text-cyan-600" /> Ventas en el tiempo
        </h2>
        {cargando ? (
          <div className="h-44 flex items-center justify-center text-slate-400">Cargando…</div>
        ) : serie.every((b) => b.total === 0) ? (
          <div className="h-44 flex items-center justify-center text-slate-400">
            Sin ventas en este periodo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1.5 h-44 min-w-full" style={{ minWidth: serie.length * 28 }}>
              {serie.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group min-w-[20px]">
                  <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 whitespace-nowrap">
                    {money(b.total)}
                  </span>
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-cyan-500 to-cyan-300 hover:from-cyan-600 hover:to-cyan-400 transition-colors"
                    style={{ height: `${(b.total / maxBarra) * 100}%`, minHeight: b.total > 0 ? 4 : 0 }}
                    title={`${b.label}: ${money(b.total)}`}
                  />
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Medios de pago */}
        <div className="bg-white rounded-xl shadow p-4 anim-in">
          <h2 className="font-semibold text-slate-800 mb-3">Medios de pago</h2>
          <div className="space-y-3">
            <MedioPago
              icon={<Banknote size={18} />}
              label="Efectivo"
              monto={m.medios.efectivo}
              total={m.total}
              color="bg-emerald-500"
            />
            <MedioPago
              icon={<CreditCard size={18} />}
              label="Transferencia"
              monto={m.medios.transferencia}
              total={m.total}
              color="bg-cyan-500"
            />
            <MedioPago
              icon={<Notebook size={18} />}
              label="Fiado"
              monto={m.medios.fiado}
              total={m.total}
              color="bg-amber-500"
            />
          </div>
        </div>

        {/* Top productos */}
        <div className="bg-white rounded-xl shadow p-4 anim-in">
          <h2 className="font-semibold text-slate-800 mb-3">Productos más vendidos</h2>
          {m.top.length === 0 ? (
            <div className="text-slate-400 py-6 text-center">Sin datos en este periodo.</div>
          ) : (
            <ul className="space-y-2.5">
              {m.top.map((t, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between text-sm mb-0.5 gap-2">
                    <span className="text-slate-700 truncate">
                      <span className="text-slate-400 font-mono mr-1">{i + 1}.</span>
                      {t.desc}
                    </span>
                    <span className="text-slate-500 shrink-0">
                      {t.cant} u · <span className="font-semibold text-slate-700">{money(t.monto)}</span>
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 to-cyan-600 rounded-full"
                      style={{ width: `${(t.monto / maxTop) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Modal de rango personalizado (nativo) */}
      <Modal
        abierto={modalRango}
        onCerrar={() => setModalRango(false)}
        titulo="Periodo personalizado"
        maxW="max-w-md"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-slate-500">Desde</span>
              <SelectorFecha value={desdeIso} onChange={setDesdeIso} className="mt-1" />
            </label>
            <label className="text-sm">
              <span className="text-slate-500">Hasta</span>
              <SelectorFecha value={hastaIso} onChange={setHastaIso} className="mt-1" />
            </label>
          </div>
          {desdeIso && hastaIso && isoADate(desdeIso)! > isoADate(hastaIso)! && (
            <p className="text-sm text-amber-600">La fecha “Desde” es posterior a “Hasta”.</p>
          )}
          <button
            onClick={aplicarRango}
            disabled={!desdeIso || !hastaIso}
            className="btn-accion w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50"
          >
            Aplicar periodo
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Kpi({
  icon,
  label,
  valor,
  color,
  cargando,
}: {
  icon: React.ReactNode;
  label: string;
  valor: string;
  color: "emerald" | "cyan" | "violet" | "amber";
  cargando: boolean;
}) {
  const colores: Record<string, string> = {
    emerald: "text-white bg-gradient-to-br from-emerald-400 to-emerald-600",
    cyan: "text-white bg-gradient-to-br from-cyan-400 to-cyan-600",
    violet: "text-white bg-gradient-to-br from-violet-400 to-violet-600",
    amber: "text-white bg-gradient-to-br from-amber-400 to-amber-600",
  };
  return (
    <div className="bg-white rounded-xl shadow p-4 anim-in">
      <div
        className={`inline-flex items-center justify-center w-11 h-11 rounded-xl mb-3 shadow-md ${colores[color]}`}
      >
        {icon}
      </div>
      <div className="text-2xl font-bold text-slate-900 leading-tight">
        {cargando ? "…" : valor}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function MedioPago({
  icon,
  label,
  monto,
  total,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  monto: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (monto / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="flex items-center gap-1.5 text-slate-700 font-medium">
          {icon} {label}
        </span>
        <span className="text-slate-500">
          <span className="font-semibold text-slate-800">{money(monto)}</span> · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
