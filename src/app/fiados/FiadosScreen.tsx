"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Notebook,
  UserPlus,
  Search,
  HandCoins,
  MessageCircle,
  ChevronRight,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import {
  listarClientes,
  crearCliente,
  registrarAbono,
  movimientosCliente,
} from "@/lib/repo";
import type { Cliente, MovimientoFiado } from "@/lib/types";
import { money } from "@/lib/format";
import { useNegocio } from "@/lib/negocio-context";

export function FiadosScreen() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [term, setTerm] = useState("");
  const [sel, setSel] = useState<Cliente | null>(null);

  // alta de cliente
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");

  async function cargar() {
    setCargando(true);
    try {
      setClientes(await listarClientes());
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const totalAdeudado = useMemo(
    () => clientes.reduce((s, c) => s + Math.max(c.saldo || 0, 0), 0),
    [clientes]
  );
  const conDeuda = useMemo(
    () => clientes.filter((c) => (c.saldo || 0) > 0).length,
    [clientes]
  );

  const filtrados = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return clientes;
    return clientes.filter((c) => c.nombre.toLowerCase().includes(t));
  }, [clientes, term]);

  async function agregar() {
    const n = nombre.trim();
    if (!n) return;
    const id = await crearCliente(n, telefono);
    setNombre("");
    setTelefono("");
    await cargar();
    setSel({ id, nombre: n, telefono, saldo: 0, creadoEn: Date.now() });
  }

  if (sel) {
    return (
      <DetalleCliente
        cliente={sel}
        onVolver={() => {
          setSel(null);
          cargar();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="panel-obsidiana p-5 anim-in flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Total por cobrar (fiado)
          </div>
          <div className="text-4xl font-bold precio-oro mt-1">{money(totalAdeudado)}</div>
        </div>
        <div className="text-right text-slate-400 text-sm">
          {conDeuda} cliente(s)
          <br />
          con deuda
        </div>
      </div>

      {/* Alta de cliente */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-3">
          <Notebook className="text-cyan-600" size={22} /> Cuaderno de fiados
        </h1>
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del cliente"
            className="border rounded-lg px-3 py-2"
          />
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Teléfono (opcional)"
            className="border rounded-lg px-3 py-2"
          />
          <button
            onClick={agregar}
            className="bg-emerald-600 text-white font-semibold rounded-lg px-4 py-2 flex items-center justify-center gap-2"
          >
            <UserPlus size={18} /> Agregar cliente
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar cliente…"
              className="w-full border rounded-lg pl-9 pr-3 py-2"
            />
          </div>
          <button
            onClick={cargar}
            className="flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm"
          >
            <RefreshCw size={16} /> Refrescar
          </button>
        </div>

        <ul className="divide-y">
          {cargando && <li className="py-6 text-center text-slate-400">Cargando…</li>}
          {!cargando && filtrados.length === 0 && (
            <li className="py-6 text-center text-slate-400">Sin clientes aún</li>
          )}
          {filtrados.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSel(c)}
                className="w-full flex items-center justify-between py-3 hover:bg-slate-50 rounded-lg px-2 text-left"
              >
                <span className="font-medium text-slate-800">{c.nombre}</span>
                <span className="flex items-center gap-3">
                  <span
                    className={`font-bold ${
                      (c.saldo || 0) > 0 ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {(c.saldo || 0) > 0 ? money(c.saldo) : "Al día"}
                  </span>
                  <ChevronRight size={18} className="text-slate-400" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DetalleCliente({
  cliente,
  onVolver,
}: {
  cliente: Cliente;
  onVolver: () => void;
}) {
  const NEGOCIO = useNegocio();
  const [saldo, setSaldo] = useState(cliente.saldo || 0);
  const [movs, setMovs] = useState<MovimientoFiado[]>([]);
  const [monto, setMonto] = useState(0);
  const [busy, setBusy] = useState(false);

  async function cargar() {
    setMovs(await movimientosCliente(cliente.id));
  }
  useEffect(() => {
    cargar();
  }, []);

  async function abonar() {
    if (monto <= 0) return;
    setBusy(true);
    try {
      await registrarAbono(cliente.id, monto, "Abono");
      setSaldo((s) => s - monto);
      setMonto(0);
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  function whatsapp() {
    const d = (cliente.telefono || "").replace(/\D/g, "");
    const num = d.startsWith("56") ? d : d.length === 9 ? "56" + d : d;
    const txt = encodeURIComponent(
      `Hola ${cliente.nombre}, le recordamos su saldo pendiente en ${NEGOCIO.nombre}: ${money(
        saldo
      )}. ¡Gracias!`
    );
    window.open(`https://wa.me/${num}?text=${txt}`, "_blank");
  }

  return (
    <div className="space-y-4">
      <button
        onClick={onVolver}
        className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 text-sm font-semibold"
      >
        <ArrowLeft size={18} /> Volver
      </button>

      <div className="panel-obsidiana p-5 anim-in flex items-center justify-between">
        <div>
          <div className="text-slate-500 text-sm">{cliente.nombre}</div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mt-2">Saldo</div>
          <div className="text-4xl font-bold precio-oro mt-1">{money(saldo)}</div>
        </div>
        {cliente.telefono && (
          <button
            onClick={whatsapp}
            className="bg-emerald-600 text-white font-semibold rounded-lg px-4 py-3 flex items-center gap-2"
          >
            <MessageCircle size={18} /> Recordar
          </button>
        )}
      </div>

      {/* Registrar abono */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h2 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
          <HandCoins className="text-emerald-600" size={20} /> Registrar abono (pago)
        </h2>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={monto}
            onChange={(e) => setMonto(Number(e.target.value))}
            placeholder="Monto del abono"
            className="flex-1 border rounded-lg px-3 py-2"
          />
          <button
            onClick={abonar}
            disabled={busy}
            className="bg-cyan-600 text-white font-semibold rounded-lg px-5 disabled:opacity-50"
          >
            {busy ? "…" : "Abonar"}
          </button>
        </div>
      </div>

      {/* Historial */}
      <div className="bg-white rounded-xl shadow overflow-hidden anim-in">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Detalle</th>
              <th className="text-right px-3 py-2">Monto</th>
            </tr>
          </thead>
          <tbody>
            {movs.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                  Sin movimientos
                </td>
              </tr>
            )}
            {movs.map((m, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2">{m.fecha}</td>
                <td className="px-3 py-2">
                  {m.tipo === "cargo" ? (m.ventaNro ? `Compra ${m.ventaNro}` : "Cargo") : "Abono"}
                </td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    m.tipo === "cargo" ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {m.tipo === "cargo" ? "+" : "−"}
                  {money(m.monto)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
