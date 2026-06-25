"use client";

import { useCallback, useEffect, useState } from "react";
import { Store, UserPlus, ShieldCheck, LogOut, Plus, Loader2, Pencil } from "lucide-react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { getAuthInstance, isFirebaseConfigured } from "@/lib/firebase";
import {
  esModerador,
  listarNegocios,
  listarUsuarios,
  crearNegocio,
  actualizarNegocio,
  crearUsuario,
  normalizarSlug,
  type Negocio,
  type BoletaConfig,
  type Usuario,
  type RolUsuario,
} from "@/lib/admin";
import { Modal } from "@/components/Modal";

type Acceso = "verificando" | "necesita-login" | "denegado" | "ok";

// El panel /moderador mantiene su propio login con email/contraseña, separado
// del POS (que ya no tiene login). Aquí se usa Firebase Auth directamente y se
// verifica el rol contra la colección usuarios.
export function ModeradorScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [cargandoAuth, setCargandoAuth] = useState(true);
  const [acceso, setAcceso] = useState<Acceso>("verificando");

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setCargandoAuth(false);
      return;
    }
    return onAuthStateChanged(getAuthInstance(), (u) => {
      // Se ignora el usuario anónimo creado por el AuthProvider del POS: aquí
      // solo cuenta el moderador con email/contraseña.
      setUser(u && !u.isAnonymous ? u : null);
      setCargandoAuth(false);
    });
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (cargandoAuth) return;
      if (!user) {
        if (vivo) setAcceso("necesita-login");
        return;
      }
      const ok = await esModerador(user.uid);
      if (vivo) setAcceso(ok ? "ok" : "denegado");
    })();
    return () => {
      vivo = false;
    };
  }, [user, cargandoAuth]);

  async function login(email: string, pass: string) {
    await signInWithEmailAndPassword(getAuthInstance(), email, pass);
  }

  async function logout() {
    await signOut(getAuthInstance());
  }

  if (!isFirebaseConfigured) {
    return (
      <Aviso titulo="Falta configurar Firebase">
        Completa el archivo <code>.env.local</code> con las claves de tu proyecto.
      </Aviso>
    );
  }

  if (cargandoAuth || acceso === "verificando") {
    return <div className="mt-20 text-center text-slate-500">Cargando…</div>;
  }

  if (acceso === "necesita-login") {
    return <LoginModerador onLogin={login} />;
  }

  if (acceso === "denegado") {
    return (
      <Aviso titulo="Sin acceso">
        Tu usuario no tiene rol de moderador.{" "}
        <button onClick={logout} className="underline font-medium">
          Cerrar sesión
        </button>
      </Aviso>
    );
  }

  return <Panel onLogout={logout} />;
}

// ===== Pantalla principal del panel =====

function Panel({ onLogout }: { onLogout: () => Promise<void> }) {
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    setCargando(true);
    const [n, u] = await Promise.all([listarNegocios(), listarUsuarios()]);
    setNegocios(n);
    setUsuarios(u);
    setCargando(false);
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-4xl px-4 h-14 flex items-center gap-2">
          <ShieldCheck className="text-amber-300" size={22} />
          <span className="font-bold">Panel Moderador</span>
          <button
            onClick={onLogout}
            className="ml-auto flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
          >
            <LogOut size={16} /> Salir
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        {cargando ? (
          <div className="text-center text-slate-500 py-10">Cargando datos…</div>
        ) : (
          <>
            <SeccionNegocios negocios={negocios} onCambio={recargar} />
            <SeccionUsuarios negocios={negocios} usuarios={usuarios} onCambio={recargar} />
          </>
        )}
      </main>
    </div>
  );
}

// ===== Negocios =====

function SeccionNegocios({
  negocios,
  onCambio,
}: {
  negocios: Negocio[];
  onCambio: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [nombreCorto, setNombreCorto] = useState("");
  const [logo, setLogo] = useState("");
  const [fondoLogin, setFondoLogin] = useState("");
  const [rubro, setRubro] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [eslogan, setEslogan] = useState("");
  const [web, setWeb] = useState("");
  const [instagram, setInstagram] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [editando, setEditando] = useState<Negocio | null>(null);

  // El subdominio se autogenera desde el nombre mientras no se edite a mano.
  const [slugTocado, setSlugTocado] = useState(false);
  const slugFinal = slugTocado ? normalizarSlug(slug) : normalizarSlug(nombre);

  async function crear() {
    setBusy(true);
    setMsg(null);
    try {
      const id = await crearNegocio(slugFinal, {
        nombre,
        nombreCorto: nombreCorto.trim(),
        logo: logo.trim(),
        fondoLogin: fondoLogin.trim(),
        rubro: rubro.trim(),
        ubicacion: ubicacion.trim(),
        eslogan: eslogan.trim(),
        web: web.trim(),
        instagram: instagram.trim(),
      });
      setMsg({ tipo: "ok", texto: `Negocio "${id}" creado. Subdominio: ${id}.synaptechspa.cl` });
      setNombre("");
      setSlug("");
      setSlugTocado(false);
      setNombreCorto("");
      setLogo("");
      setFondoLogin("");
      setRubro("");
      setUbicacion("");
      setEslogan("");
      setWeb("");
      setInstagram("");
      await onCambio();
    } catch (e) {
      setMsg({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo crear." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-xl shadow p-5">
      <h2 className="flex items-center gap-2 font-bold text-slate-800 mb-4">
        <Store size={20} className="text-cyan-600" /> Negocios ({negocios.length})
      </h2>

      {negocios.length > 0 && (
        <ul className="divide-y mb-5">
          {negocios.map((n) => (
            <li key={n.slug} className="flex items-center justify-between py-2 text-sm gap-3">
              <span className="font-medium text-slate-800 truncate">{n.nombre || n.slug}</span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-slate-400">{n.slug}.synaptechspa.cl</span>
                <button
                  onClick={() => setEditando(n)}
                  className="text-slate-400 hover:text-cyan-600 p-1 rounded"
                  aria-label={`Editar ${n.nombre || n.slug}`}
                  title="Editar branding"
                >
                  <Pencil size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <EditarNegocioModal
        negocio={editando}
        onCerrar={() => setEditando(null)}
        onGuardado={async () => {
          setEditando(null);
          await onCambio();
        }}
      />

      <div className="grid sm:grid-cols-2 gap-3">
        <Campo label="Nombre del negocio">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Subdominio">
          <div className="flex items-center">
            <input
              value={slugTocado ? slug : slugFinal}
              onChange={(e) => {
                setSlugTocado(true);
                setSlug(e.target.value);
              }}
              className={`${inputCls} rounded-r-none`}
            />
            <span className="border border-l-0 rounded-r-lg px-2 py-2 bg-slate-50 text-slate-400 text-sm">
              .synaptechspa.cl
            </span>
          </div>
        </Campo>
        <Campo label="Nombre corto (PWA, opcional)">
          <input value={nombreCorto} onChange={(e) => setNombreCorto(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Logo: URL o ruta (opcional)">
          <input
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            placeholder="/logos/kronos.png"
            className={inputCls}
          />
        </Campo>
        <Campo label="Fondo del login: URL o ruta (opcional)">
          <input
            value={fondoLogin}
            onChange={(e) => setFondoLogin(e.target.value)}
            placeholder="/logos/kronos.png"
            className={inputCls}
          />
        </Campo>
        <Campo label="Rubro (opcional)">
          <input value={rubro} onChange={(e) => setRubro(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Ubicación (opcional)">
          <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Eslogan (opcional)">
          <input value={eslogan} onChange={(e) => setEslogan(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Web (opcional)">
          <input value={web} onChange={(e) => setWeb(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Instagram (opcional)">
          <input value={instagram} onChange={(e) => setInstagram(e.target.value)} className={inputCls} />
        </Campo>
      </div>

      {msg && <Mensaje msg={msg} />}

      <button
        onClick={crear}
        disabled={busy || !nombre.trim() || !slugFinal}
        className="mt-4 flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
        Crear negocio
      </button>
    </section>
  );
}

// ===== Editar negocio =====

function EditarNegocioModal({
  negocio,
  onCerrar,
  onGuardado,
}: {
  negocio: Negocio | null;
  onCerrar: () => void;
  onGuardado: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [nombreCorto, setNombreCorto] = useState("");
  const [logo, setLogo] = useState("");
  const [fondoLogin, setFondoLogin] = useState("");
  const [rubro, setRubro] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [eslogan, setEslogan] = useState("");
  const [web, setWeb] = useState("");
  const [instagram, setInstagram] = useState("");
  const [boleta, setBoleta] = useState<BoletaConfig>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Carga los valores actuales cada vez que se abre con un negocio distinto.
  useEffect(() => {
    if (!negocio) return;
    setNombre(negocio.nombre || "");
    setNombreCorto(negocio.nombreCorto || "");
    setLogo(negocio.logo || "");
    setFondoLogin(negocio.fondoLogin || "");
    setRubro(negocio.rubro || "");
    setUbicacion(negocio.ubicacion || "");
    setEslogan(negocio.eslogan || "");
    setWeb(negocio.web || "");
    setInstagram(negocio.instagram || "");
    setBoleta(negocio.boleta || {});
    setErr("");
  }, [negocio]);

  function setBoletaCampo<K extends keyof BoletaConfig>(k: K, v: BoletaConfig[K]) {
    setBoleta((b) => ({ ...b, [k]: v }));
  }

  async function guardar() {
    if (!negocio) return;
    setBusy(true);
    setErr("");
    try {
      await actualizarNegocio(negocio.slug, {
        nombre,
        nombreCorto: nombreCorto.trim(),
        logo: logo.trim(),
        fondoLogin: fondoLogin.trim(),
        rubro: rubro.trim(),
        ubicacion: ubicacion.trim(),
        eslogan: eslogan.trim(),
        web: web.trim(),
        instagram: instagram.trim(),
        boleta: {
          ...boleta,
          mensajeSuperior: (boleta.mensajeSuperior || "").trim(),
          mensajeInferior: (boleta.mensajeInferior || "").trim(),
          textoGracias: (boleta.textoGracias || "").trim(),
        },
      });
      await onGuardado();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      abierto={!!negocio}
      onCerrar={onCerrar}
      titulo={negocio ? `Editar ${negocio.nombre || negocio.slug}` : ""}
      maxW="max-w-xl"
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <Campo label="Nombre del negocio">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Subdominio (fijo)">
          <div className="flex items-center">
            <input value={negocio?.slug || ""} disabled className={`${inputCls} rounded-r-none bg-slate-50 text-slate-500`} />
            <span className="border border-l-0 rounded-r-lg px-2 py-2 bg-slate-50 text-slate-400 text-sm">
              .synaptechspa.cl
            </span>
          </div>
        </Campo>
        <Campo label="Nombre corto (PWA)">
          <input value={nombreCorto} onChange={(e) => setNombreCorto(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Logo: URL o ruta">
          <input
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            placeholder="/logos/vidasana.png"
            className={inputCls}
          />
        </Campo>
        <Campo label="Fondo del login: URL o ruta">
          <input
            value={fondoLogin}
            onChange={(e) => setFondoLogin(e.target.value)}
            placeholder="/logos/vidasana.png"
            className={inputCls}
          />
        </Campo>
        <Campo label="Rubro">
          <input value={rubro} onChange={(e) => setRubro(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Ubicación">
          <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Eslogan">
          <input value={eslogan} onChange={(e) => setEslogan(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Web">
          <input value={web} onChange={(e) => setWeb(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Instagram">
          <input value={instagram} onChange={(e) => setInstagram(e.target.value)} className={inputCls} />
        </Campo>
      </div>

      {/* ===== Boleta: textos y qué líneas se imprimen ===== */}
      <div className="mt-5 pt-4 border-t border-slate-100">
        <h4 className="font-semibold text-slate-800 mb-1">Boleta impresa</h4>
        <p className="text-xs text-slate-500 mb-3">
          Controla qué líneas aparecen y agrega textos arriba/abajo del detalle.
          Lo que dejes en blanco no se imprime.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <Campo label="Mensaje superior (bajo el nombre)">
            <textarea
              value={boleta.mensajeSuperior || ""}
              onChange={(e) => setBoletaCampo("mensajeSuperior", e.target.value)}
              placeholder="Ej: RUT 76.123.456-7&#10;Horario: L-V 10-21 hrs"
              rows={2}
              className={inputCls}
            />
          </Campo>
          <Campo label="Mensaje inferior (antes del gracias)">
            <textarea
              value={boleta.mensajeInferior || ""}
              onChange={(e) => setBoletaCampo("mensajeInferior", e.target.value)}
              placeholder="Ej: Cambios hasta 7 días con boleta"
              rows={2}
              className={inputCls}
            />
          </Campo>
          <Campo label='Texto de cierre (default "¡GRACIAS POR SU COMPRA!")'>
            <input
              value={boleta.textoGracias || ""}
              onChange={(e) => setBoletaCampo("textoGracias", e.target.value)}
              placeholder="¡GRACIAS POR SU COMPRA!"
              className={inputCls}
            />
          </Campo>
        </div>

        <div className="mt-3 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Toggle
            label="Eslogan"
            valor={boleta.mostrarEslogan ?? false}
            onChange={(v) => setBoletaCampo("mostrarEslogan", v)}
            hint="(default: oculto)"
          />
          <Toggle
            label="Rubro"
            valor={boleta.mostrarRubro ?? true}
            onChange={(v) => setBoletaCampo("mostrarRubro", v)}
          />
          <Toggle
            label="Ubicación"
            valor={boleta.mostrarUbicacion ?? true}
            onChange={(v) => setBoletaCampo("mostrarUbicacion", v)}
          />
          <Toggle
            label="Web"
            valor={boleta.mostrarWeb ?? true}
            onChange={(v) => setBoletaCampo("mostrarWeb", v)}
          />
          <Toggle
            label="Instagram"
            valor={boleta.mostrarInstagram ?? true}
            onChange={(v) => setBoletaCampo("mostrarInstagram", v)}
          />
          <Toggle
            label="QR Club de Fidelización"
            valor={boleta.mostrarQrClub ?? true}
            onChange={(v) => setBoletaCampo("mostrarQrClub", v)}
          />
          <Toggle
            label="Nombre del vendedor"
            valor={boleta.mostrarVendedor ?? false}
            onChange={(v) => setBoletaCampo("mostrarVendedor", v)}
            hint="(default: oculto)"
          />
          <Toggle
            label="Medio de pago"
            valor={boleta.mostrarMedioPago ?? false}
            onChange={(v) => setBoletaCampo("mostrarMedioPago", v)}
            hint="(default: oculto)"
          />
        </div>
      </div>

      {(logo.trim() || fondoLogin.trim()) && (
        <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
          {logo.trim() && (
            <div className="flex flex-col items-center gap-1">
              <span>Logo</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo.trim()} alt="logo" className="h-14 w-14 object-contain border rounded bg-white" />
            </div>
          )}
          {fondoLogin.trim() && (
            <div className="flex flex-col items-center gap-1">
              <span>Fondo</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fondoLogin.trim()} alt="fondo" className="h-14 w-14 object-cover border rounded" />
            </div>
          )}
        </div>
      )}

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          onClick={onCerrar}
          className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={busy || !nombre.trim()}
          className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          Guardar cambios
        </button>
      </div>
    </Modal>
  );
}

// ===== Usuarios =====

function SeccionUsuarios({
  negocios,
  usuarios,
  onCambio,
}: {
  negocios: Negocio[];
  usuarios: Usuario[];
  onCambio: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [rol, setRol] = useState<RolUsuario>("admin");
  const [negocioId, setNegocioId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const nombreNegocio = (id: string | null) =>
    id ? negocios.find((n) => n.slug === id)?.nombre || id : "—";

  async function crear() {
    setBusy(true);
    setMsg(null);
    try {
      await crearUsuario(email, pass, rol === "moderador" ? null : negocioId, rol);
      setMsg({ tipo: "ok", texto: `Usuario ${email.trim()} creado.` });
      setEmail("");
      setPass("");
      await onCambio();
    } catch (e) {
      setMsg({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo crear." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-xl shadow p-5">
      <h2 className="flex items-center gap-2 font-bold text-slate-800 mb-4">
        <UserPlus size={20} className="text-emerald-600" /> Usuarios ({usuarios.length})
      </h2>

      {usuarios.length > 0 && (
        <ul className="divide-y mb-5">
          {usuarios.map((u) => (
            <li key={u.uid} className="flex items-center justify-between py-2 text-sm gap-3">
              <span className="text-slate-800 truncate">{u.email}</span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="text-slate-500">{nombreNegocio(u.negocioId)}</span>
                <span className="text-[11px] uppercase tracking-wide bg-slate-100 rounded px-2 py-0.5 text-slate-600">
                  {u.rol}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <Campo label="Correo">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </Campo>
        <Campo label="Contraseña (mín. 6)">
          <input
            type="text"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className={inputCls}
          />
        </Campo>
        <Campo label="Rol">
          <select value={rol} onChange={(e) => setRol(e.target.value as RolUsuario)} className={inputCls}>
            <option value="admin">admin (acceso total al negocio)</option>
            <option value="vendedor">vendedor</option>
            <option value="moderador">moderador (acceso global)</option>
          </select>
        </Campo>
        {rol !== "moderador" && (
          <Campo label="Negocio">
            <select
              value={negocioId}
              onChange={(e) => setNegocioId(e.target.value)}
              className={inputCls}
            >
              <option value="">Elige un negocio…</option>
              {negocios.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.nombre || n.slug}
                </option>
              ))}
            </select>
          </Campo>
        )}
      </div>

      {msg && <Mensaje msg={msg} />}

      <button
        onClick={crear}
        disabled={busy || !email.trim() || pass.length < 6 || (rol !== "moderador" && !negocioId)}
        className="mt-4 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
        Crear usuario
      </button>
    </section>
  );
}

// ===== Login del moderador =====

function LoginModerador({ onLogin }: { onLogin: (email: string, pass: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto max-w-sm mt-20 bg-white rounded-xl shadow p-6">
      <div className="flex items-center gap-2 justify-center mb-1">
        <ShieldCheck className="text-cyan-600" size={24} />
        <h1 className="text-xl font-bold text-slate-900">Panel Moderador</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4 text-center">Acceso solo para moderadores.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          setBusy(true);
          try {
            await onLogin(email.trim(), pass);
          } catch {
            setErr("Correo o contraseña incorrectos.");
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <input
          type="email"
          required
          placeholder="correo@synaptechspa.cl"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
        <input
          type="password"
          required
          placeholder="contraseña"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className={inputCls}
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          disabled={busy}
          className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg py-2.5 disabled:opacity-50"
        >
          {busy ? "Ingresando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

// ===== Helpers de UI =====

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

function Mensaje({ msg }: { msg: { tipo: "ok" | "error"; texto: string } }) {
  return (
    <div
      className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
        msg.tipo === "ok"
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-red-50 border-red-200 text-red-700"
      }`}
    >
      {msg.texto}
    </div>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl mt-16 bg-amber-50 border border-amber-300 rounded-lg p-6">
      <h1 className="text-lg font-bold text-amber-900">{titulo}</h1>
      <p className="mt-2 text-sm text-amber-900">{children}</p>
    </div>
  );
}
