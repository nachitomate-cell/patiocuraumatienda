"use client";

import { useEffect, useState } from "react";
import { Store, UserPlus, Copy, Check, MessageCircle, Link2 } from "lucide-react";
import { listarEmprendedores, crearEmprendedor } from "@/lib/repo";
import type { Emprendedor } from "@/lib/types";

export function EmprendedoresScreen() {
  const [lista, setLista] = useState<Emprendedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nombre, setNombre] = useState("");
  const [contacto, setContacto] = useState("");
  const [telefono, setTelefono] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    try {
      setLista(await listarEmprendedores());
    } finally {
      setCargando(false);
    }
  }

  async function crear() {
    const n = nombre.trim();
    if (!n) return;
    setBusy(true);
    try {
      await crearEmprendedor(n, contacto, telefono);
      setNombre("");
      setContacto("");
      setTelefono("");
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  function linkDe(e: Emprendedor) {
    return `${origin}/alta/${e.token}`;
  }

  async function copiar(e: Emprendedor) {
    await navigator.clipboard.writeText(linkDe(e));
    setCopiado(e.id);
    setTimeout(() => setCopiado(""), 1500);
  }

  function whatsapp(e: Emprendedor) {
    const d = (e.telefono || "").replace(/\D/g, "");
    const num = d.startsWith("56") ? d : d.length === 9 ? "56" + d : d;
    const txt = encodeURIComponent(
      `Hola ${e.nombre}, este es tu link para cargar tus productos en Patio Curauma: ${linkDe(e)}`
    );
    window.open(`https://wa.me/${num}?text=${txt}`, "_blank");
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-1">
          <Store className="text-cyan-600" size={22} /> Emprendedores
        </h1>
        <p className="text-sm text-slate-500 mb-3">
          Crea un emprendedor y comparte su link único. Ellos cargan sus productos y entran
          directo al stock de la tienda.
        </p>
        <div className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del emprendedor / marca"
            className="border rounded-lg px-3 py-2"
          />
          <input
            value={contacto}
            onChange={(e) => setContacto(e.target.value)}
            placeholder="Contacto (opcional)"
            className="border rounded-lg px-3 py-2"
          />
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Teléfono (opcional)"
            className="border rounded-lg px-3 py-2"
          />
          <button
            onClick={crear}
            disabled={busy}
            className="bg-emerald-600 text-white font-semibold rounded-lg px-4 py-2 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <UserPlus size={18} /> Crear
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h2 className="font-semibold text-slate-800 mb-3">Emprendedores ({lista.length})</h2>
        {cargando && <div className="text-slate-400 py-4 text-center">Cargando…</div>}
        {!cargando && lista.length === 0 && (
          <div className="text-slate-400 py-4 text-center">Aún no hay emprendedores</div>
        )}
        <ul className="space-y-3">
          {lista.map((e) => (
            <li key={e.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold text-slate-800">{e.nombre}</div>
                  <div className="text-xs text-slate-500">
                    Prefijo <span className="font-mono">{e.prefijo}</span> · {e.productosCount}{" "}
                    producto(s){e.contacto ? ` · ${e.contacto}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copiar(e)}
                    className="flex items-center gap-1.5 bg-cyan-600 text-white rounded-lg px-3 py-2 text-sm font-semibold"
                  >
                    {copiado === e.id ? <Check size={16} /> : <Copy size={16} />}
                    {copiado === e.id ? "¡Copiado!" : "Copiar link"}
                  </button>
                  {e.telefono && (
                    <button
                      onClick={() => whatsapp(e)}
                      className="flex items-center gap-1.5 bg-emerald-600 text-white rounded-lg px-3 py-2 text-sm font-semibold"
                    >
                      <MessageCircle size={16} /> Enviar
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 break-all">
                <Link2 size={14} className="shrink-0" />
                {linkDe(e)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
