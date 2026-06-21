"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Store,
  UserPlus,
  Copy,
  Check,
  MessageCircle,
  Link2,
  Pencil,
  Trash2,
  X,
  Hash,
} from "lucide-react";
import {
  listarEmprendedores,
  crearEmprendedor,
  actualizarEmprendedor,
  eliminarEmprendedor,
  todosLosProductos,
  normalizarPrefijo,
} from "@/lib/repo";
import type { Emprendedor, Producto } from "@/lib/types";
import { Modal } from "@/components/Modal";
import { useNegocio } from "@/lib/negocio-context";

export function EmprendedoresScreen() {
  const NEGOCIO = useNegocio();
  const [lista, setLista] = useState<Emprendedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);

  // Alta
  const [nombre, setNombre] = useState("");
  const [prefijo, setPrefijo] = useState("");
  const [prefijoTocado, setPrefijoTocado] = useState(false);
  const [contacto, setContacto] = useState("");
  const [telefono, setTelefono] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Edición
  const [editId, setEditId] = useState<string | null>(null);
  const [edNombre, setEdNombre] = useState("");
  const [edPrefijo, setEdPrefijo] = useState("");
  const [edContacto, setEdContacto] = useState("");
  const [edTelefono, setEdTelefono] = useState("");

  const [copiado, setCopiado] = useState("");
  const [origin, setOrigin] = useState("");
  const [confirmando, setConfirmando] = useState<Emprendedor | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    try {
      const [emps, prods] = await Promise.all([
        listarEmprendedores(),
        todosLosProductos(),
      ]);
      setLista(emps);
      setProductos(prods);
    } finally {
      setCargando(false);
    }
  }

  // Cantidad de productos del catálogo cuyo código empieza con cada prefijo.
  const conteoPorPrefijo = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of productos) {
      const cod = p.codigo.toUpperCase();
      for (const e of lista) {
        if (cod.startsWith(e.prefijo.toUpperCase())) {
          m.set(e.prefijo, (m.get(e.prefijo) ?? 0) + 1);
        }
      }
    }
    return m;
  }, [productos, lista]);

  // Al escribir el nombre, sugerir un prefijo (si no lo editaron a mano).
  function cambiarNombre(v: string) {
    setNombre(v);
    if (!prefijoTocado) {
      setPrefijo(normalizarPrefijo(v).slice(0, 4));
    }
  }

  async function crear() {
    const n = nombre.trim();
    if (!n) return setError("Escriba el nombre del emprendedor.");
    setBusy(true);
    setError("");
    try {
      await crearEmprendedor(n, contacto, telefono, prefijo);
      setNombre("");
      setPrefijo("");
      setPrefijoTocado(false);
      setContacto("");
      setTelefono("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el emprendedor.");
    } finally {
      setBusy(false);
    }
  }

  function iniciarEdicion(e: Emprendedor) {
    setEditId(e.id);
    setEdNombre(e.nombre);
    setEdPrefijo(e.prefijo);
    setEdContacto(e.contacto ?? "");
    setEdTelefono(e.telefono ?? "");
    setError("");
  }

  async function guardarEdicion() {
    if (!editId) return;
    if (!edNombre.trim()) return setError("El nombre no puede quedar vacío.");
    setBusy(true);
    setError("");
    try {
      await actualizarEmprendedor(editId, {
        nombre: edNombre,
        prefijo: edPrefijo,
        contacto: edContacto,
        telefono: edTelefono,
      });
      setEditId(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmarEliminar() {
    if (!confirmando) return;
    setBusy(true);
    try {
      await eliminarEmprendedor(confirmando.id);
      setConfirmando(null);
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
      `Hola ${e.nombre}, este es tu link para cargar tus productos en ${NEGOCIO.nombre}: ${linkDe(e)}`
    );
    window.open(`https://wa.me/${num}?text=${txt}`, "_blank");
  }

  return (
    <div className="space-y-4">
      {/* Alta */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-1">
          <Store className="text-cyan-600" size={22} /> Emprendedores
        </h1>
        <p className="text-sm text-slate-500 mb-3">
          Cada emprendedor tiene una <strong>inicial de código</strong> (ej:{" "}
          <span className="font-mono">AMON</span> para “Amonite Joyas”). Sus productos son los
          que empiezan con esa inicial. Comparte su link único para que cargue sus productos.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr_auto] gap-2">
          <input
            value={nombre}
            onChange={(e) => cambiarNombre(e.target.value)}
            placeholder="Nombre / marca (ej: Amonite Joyas)"
            className="border rounded-lg px-3 py-2"
          />
          <input
            value={prefijo}
            onChange={(e) => {
              setPrefijo(e.target.value.toUpperCase());
              setPrefijoTocado(true);
            }}
            placeholder="Inicial"
            title="Inicial de código (ej: AMON)"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="border rounded-lg px-3 py-2 font-mono uppercase w-full sm:w-28"
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
        {error && (
          <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* Lista */}
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h2 className="font-semibold text-slate-800 mb-3">Emprendedores ({lista.length})</h2>
        {cargando && <div className="text-slate-400 py-4 text-center">Cargando…</div>}
        {!cargando && lista.length === 0 && (
          <div className="text-slate-400 py-4 text-center">Aún no hay emprendedores</div>
        )}
        <ul className="space-y-3">
          {lista.map((e) =>
            editId === e.id ? (
              /* ----- Modo edición ----- */
              <li key={e.id} className="border-2 border-cyan-300 rounded-lg p-3 anim-pop">
                <div className="grid sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr] gap-2">
                  <input
                    value={edNombre}
                    onChange={(ev) => setEdNombre(ev.target.value)}
                    placeholder="Nombre / marca"
                    className="border rounded-lg px-3 py-2"
                  />
                  <input
                    value={edPrefijo}
                    onChange={(ev) => setEdPrefijo(ev.target.value.toUpperCase())}
                    placeholder="Inicial"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    className="border rounded-lg px-3 py-2 font-mono uppercase w-full sm:w-28"
                  />
                  <input
                    value={edContacto}
                    onChange={(ev) => setEdContacto(ev.target.value)}
                    placeholder="Contacto"
                    className="border rounded-lg px-3 py-2"
                  />
                  <input
                    value={edTelefono}
                    onChange={(ev) => setEdTelefono(ev.target.value)}
                    placeholder="Teléfono"
                    className="border rounded-lg px-3 py-2"
                  />
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={guardarEdicion}
                    disabled={busy}
                    className="flex items-center gap-1.5 bg-emerald-600 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    <Check size={16} /> Guardar
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="flex items-center gap-1.5 border border-slate-300 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100"
                  >
                    <X size={16} /> Cancelar
                  </button>
                </div>
              </li>
            ) : (
              /* ----- Vista normal ----- */
              <li key={e.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800">{e.nombre}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                      <span className="inline-flex items-center gap-0.5 bg-slate-100 text-slate-700 rounded px-1.5 py-0.5 font-mono">
                        <Hash size={11} />
                        {e.prefijo}
                      </span>
                      · {conteoPorPrefijo.get(e.prefijo) ?? 0} producto(s) en stock
                      {e.contacto ? ` · ${e.contacto}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
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
                    <button
                      onClick={() => iniciarEdicion(e)}
                      className="flex items-center gap-1.5 border border-slate-300 text-slate-700 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-100"
                    >
                      <Pencil size={16} /> Editar
                    </button>
                    <button
                      onClick={() => setConfirmando(e)}
                      disabled={busy}
                      className="flex items-center gap-1.5 border border-red-300 text-red-600 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                      aria-label="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 break-all">
                  <Link2 size={14} className="shrink-0" />
                  {linkDe(e)}
                </div>
              </li>
            )
          )}
        </ul>
      </div>

      {/* Confirmación de borrado (modal nativo) */}
      <Modal
        abierto={!!confirmando}
        onCerrar={() => setConfirmando(null)}
        titulo="Eliminar emprendedor"
        maxW="max-w-md"
      >
        <p className="text-slate-700">
          ¿Eliminar a <strong>{confirmando?.nombre}</strong>?
        </p>
        <p className="text-sm text-slate-500 mt-1">
          Sus productos (<span className="font-mono">{confirmando?.prefijo}…</span>) seguirán en el
          stock; solo se borra la ficha del emprendedor.
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={confirmarEliminar}
            disabled={busy}
            className="btn-accion flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50"
          >
            Sí, eliminar
          </button>
          <button
            onClick={() => setConfirmando(null)}
            className="flex-1 border border-slate-300 text-slate-700 font-semibold rounded-lg py-2.5 hover:bg-slate-100"
          >
            Cancelar
          </button>
        </div>
      </Modal>
    </div>
  );
}
