"use client";

import { useCallback, useMemo, useState } from "react";
import {
  FlaskConical,
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleSlash,
} from "lucide-react";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { getDb, isFirebaseConfigured } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useNegocio } from "@/lib/negocio-context";
import { negocioActivo } from "@/lib/tenant";
import { getNegocio, normalizarSlug } from "@/lib/admin";
import { useVendedor } from "@/lib/vendedor";
import {
  buscarParaVenta,
  buscarProductos,
  getEmprendedorPorToken,
  getMetaDiaria,
  listarClientes,
  listarEmprendedores,
  movimientosCliente,
  normalizarCodigo,
  normalizarPrefijo,
  planearNormalizacion,
  productosDeEmprendedor,
  todosLosProductos,
  ultimasEntradas,
  ultimasVentas,
  ventasEnRango,
} from "@/lib/repo";
import { money } from "@/lib/format";
import { subtotalLinea, type Producto } from "@/lib/types";

// ===== Tipos =====

type Estado = "idle" | "corriendo" | "ok" | "error" | "saltado";

interface Resultado {
  estado: Estado;
  mensaje?: string;
  detalle?: string;
  ms?: number;
}

interface Prueba {
  id: string;
  nombre: string;
  descripcion: string;
  ejecutar: () => Promise<Resultado>;
}

interface Grupo {
  id: string;
  titulo: string;
  descripcion: string;
  pruebas: Prueba[];
  escritura?: boolean;
}

// ===== Helpers para escribir tests =====

function ok(mensaje: string, detalle?: string): Resultado {
  return { estado: "ok", mensaje, detalle };
}
function fallo(mensaje: string, detalle?: string): Resultado {
  return { estado: "error", mensaje, detalle };
}
function saltar(mensaje: string): Resultado {
  return { estado: "saltado", mensaje };
}

function casos<T>(
  pruebas: Array<[entrada: T, esperado: string, fn: (x: T) => string, etiqueta: string]>
): Resultado {
  const fallos: string[] = [];
  for (const [entrada, esperado, fn, etiqueta] of pruebas) {
    const obtenido = fn(entrada);
    if (obtenido !== esperado) {
      fallos.push(`${etiqueta}: "${String(entrada)}" → "${obtenido}" (esperaba "${esperado}")`);
    }
  }
  return fallos.length === 0
    ? ok(`${pruebas.length} casos pasaron`)
    : fallo(`${fallos.length} de ${pruebas.length} fallaron`, fallos.join("\n"));
}

// ===== Pantalla =====

export function PruebasScreen() {
  const { user, configured } = useAuth();
  const NEGOCIO = useNegocio();
  const slugActivo = negocioActivo();
  const vendedor = useVendedor();

  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [corriendoTodo, setCorriendoTodo] = useState(false);
  const [abierto, setAbierto] = useState<Record<string, boolean>>({});
  const [incluirEscritura, setIncluirEscritura] = useState(false);

  // Envuelve cada test con medición de tiempo y atrapa excepciones para no
  // tumbar la pantalla si una llamada a Firestore lanza.
  const correr = useCallback(async (id: string, fn: () => Promise<Resultado>) => {
    setResultados((r) => ({ ...r, [id]: { estado: "corriendo" } }));
    const t0 = performance.now();
    let res: Resultado;
    try {
      res = await fn();
    } catch (e) {
      res = fallo("Excepción", (e as Error)?.message || String(e));
    }
    res.ms = Math.round(performance.now() - t0);
    setResultados((r) => ({ ...r, [id]: res }));
    return res;
  }, []);

  // Las pruebas dependen del usuario anónimo/negocio activo y se reconstruyen
  // si cambian.
  const grupos = useMemo<Grupo[]>(
    () => construirGrupos(user, vendedor, NEGOCIO.nombre, slugActivo, configured),
    [user, vendedor, NEGOCIO.nombre, slugActivo, configured]
  );

  const todasLasPruebas = useMemo(
    () => grupos.flatMap((g) => (g.escritura && !incluirEscritura ? [] : g.pruebas)),
    [grupos, incluirEscritura]
  );

  const resumen = useMemo(() => {
    let okN = 0, errN = 0, skipN = 0, corN = 0, idleN = 0;
    for (const p of todasLasPruebas) {
      const r = resultados[p.id]?.estado ?? "idle";
      if (r === "ok") okN++;
      else if (r === "error") errN++;
      else if (r === "saltado") skipN++;
      else if (r === "corriendo") corN++;
      else idleN++;
    }
    return { okN, errN, skipN, corN, idleN, total: todasLasPruebas.length };
  }, [resultados, todasLasPruebas]);

  async function correrGrupo(g: Grupo) {
    for (const p of g.pruebas) {
      // Secuencial: facilita leer la pantalla mientras corre.
      // eslint-disable-next-line no-await-in-loop
      await correr(p.id, p.ejecutar);
    }
  }

  async function correrTodo() {
    setCorriendoTodo(true);
    try {
      for (const g of grupos) {
        if (g.escritura && !incluirEscritura) continue;
        // eslint-disable-next-line no-await-in-loop
        await correrGrupo(g);
      }
    } finally {
      setCorriendoTodo(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-white rounded-xl shadow p-4 anim-in">
        <h1 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
          <FlaskConical className="text-cyan-600" size={22} /> Módulo de pruebas
        </h1>
        <p className="text-sm text-slate-500">
          Diagnóstico del POS: verifica que la conexión a Firebase, las funciones de
          datos, los formatos y las capacidades del navegador funcionen contra el
          negocio activo (<b>{slugActivo ?? "—"}</b>).
        </p>
      </div>

      {/* Barra de resumen + acciones */}
      <div className="bg-white rounded-xl shadow p-4 anim-in space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={correrTodo}
            disabled={corriendoTodo}
            className="btn-accion bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg px-4 py-2.5 flex items-center gap-2 disabled:opacity-50"
          >
            {corriendoTodo ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Play size={18} />
            )}
            {corriendoTodo ? "Corriendo…" : "Correr todas las pruebas"}
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer ml-1">
            <input
              type="checkbox"
              checked={incluirEscritura}
              onChange={(e) => setIncluirEscritura(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
            />
            Incluir pruebas de escritura
          </label>
        </div>

        <div className="flex flex-wrap gap-3 text-sm">
          <Chip color="emerald" icono={<CheckCircle2 size={14} />} label={`${resumen.okN} OK`} />
          <Chip color="red" icono={<XCircle size={14} />} label={`${resumen.errN} fallaron`} />
          <Chip color="amber" icono={<CircleSlash size={14} />} label={`${resumen.skipN} saltadas`} />
          <Chip color="slate" icono={<CircleDashed size={14} />} label={`${resumen.idleN} pendientes`} />
          <span className="text-slate-500">de {resumen.total}</span>
        </div>
      </div>

      {/* Grupos */}
      {grupos.map((g) => {
        const oculto = g.escritura && !incluirEscritura;
        if (oculto) return null;
        return (
          <div key={g.id} className="bg-white rounded-xl shadow anim-in">
            <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  {g.titulo}
                  {g.escritura && (
                    <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                      <AlertTriangle size={12} /> Escritura
                    </span>
                  )}
                </h2>
                <p className="text-sm text-slate-500">{g.descripcion}</p>
              </div>
              <button
                onClick={() => correrGrupo(g)}
                disabled={corriendoTodo}
                className="btn-accion text-sm bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                <Play size={14} /> Grupo
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {g.pruebas.map((p) => {
                const r = resultados[p.id] ?? { estado: "idle" as Estado };
                const expandido = abierto[p.id] ?? false;
                const tieneDetalle = Boolean(r.detalle);
                return (
                  <li key={p.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <EstadoIcono estado={r.estado} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800">{p.nombre}</span>
                          <div className="flex items-center gap-2">
                            {typeof r.ms === "number" && r.estado !== "corriendo" && (
                              <span className="text-xs text-slate-400">{r.ms} ms</span>
                            )}
                            <button
                              onClick={() => correr(p.id, p.ejecutar)}
                              disabled={r.estado === "corriendo" || corriendoTodo}
                              className="text-xs font-semibold text-cyan-700 hover:text-cyan-800 disabled:opacity-50 flex items-center gap-1"
                            >
                              {r.estado === "corriendo" ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Play size={12} />
                              )}
                              Probar
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-slate-500">{p.descripcion}</p>
                        {r.mensaje && (
                          <p
                            className={`mt-1 text-sm ${
                              r.estado === "ok"
                                ? "text-emerald-700"
                                : r.estado === "error"
                                ? "text-red-700"
                                : r.estado === "saltado"
                                ? "text-amber-700"
                                : "text-slate-600"
                            }`}
                          >
                            {r.mensaje}
                          </p>
                        )}
                        {tieneDetalle && (
                          <button
                            onClick={() =>
                              setAbierto((a) => ({ ...a, [p.id]: !expandido }))
                            }
                            className="mt-1 text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
                          >
                            {expandido ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {expandido ? "Ocultar detalle" : "Ver detalle"}
                          </button>
                        )}
                        {expandido && tieneDetalle && (
                          <pre className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-700 whitespace-pre-wrap break-words max-h-60 overflow-auto">
                            {r.detalle}
                          </pre>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function EstadoIcono({ estado }: { estado: Estado }) {
  switch (estado) {
    case "ok":
      return <CheckCircle2 size={20} className="text-emerald-600 mt-0.5 shrink-0" />;
    case "error":
      return <XCircle size={20} className="text-red-600 mt-0.5 shrink-0" />;
    case "saltado":
      return <CircleSlash size={20} className="text-amber-600 mt-0.5 shrink-0" />;
    case "corriendo":
      return <Loader2 size={20} className="text-cyan-600 mt-0.5 shrink-0 animate-spin" />;
    default:
      return <CircleDashed size={20} className="text-slate-300 mt-0.5 shrink-0" />;
  }
}

function Chip({
  color,
  icono,
  label,
}: {
  color: "emerald" | "red" | "amber" | "slate";
  icono: React.ReactNode;
  label: string;
}) {
  const clases: Record<typeof color, string> = {
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg font-semibold ${clases[color]}`}>
      {icono}
      {label}
    </span>
  );
}

// ===== Definición de pruebas =====

function construirGrupos(
  user: ReturnType<typeof useAuth>["user"],
  vendedor: string,
  nombreNegocio: string,
  slugActivo: string | null,
  configured: boolean
): Grupo[] {
  // Estado compartido entre pruebas dentro del mismo "Correr todo": p. ej. el
  // primer producto/cliente/emprendedor encontrado se reutiliza en las pruebas
  // siguientes para no repetir lecturas.
  let primerProducto: Producto | null = null;
  let primerClienteId: string | null = null;
  let primerEmprendedor: { id: string; prefijo: string } | null = null;

  return [
    // ===== 1. Conexión y tenant =====
    {
      id: "conexion",
      titulo: "Conexión y tenant",
      descripcion: "Configuración de Firebase, sesión anónima y negocio del subdominio.",
      pruebas: [
        {
          id: "fb-configurado",
          nombre: "Firebase configurado",
          descripcion: "Las claves de Firebase están presentes en .env.local.",
          ejecutar: async () =>
            configured && isFirebaseConfigured
              ? ok("API key y project ID detectados")
              : fallo("Falta NEXT_PUBLIC_FIREBASE_* en .env.local"),
        },
        {
          id: "auth-anonima",
          nombre: "Sesión anónima activa",
          descripcion:
            "Sin login: el POS usa una sesión anónima de Firebase para tener token de Firestore.",
          ejecutar: async () => {
            if (!user) return fallo("No hay sesión (ni siquiera anónima)");
            if (!user.isAnonymous) {
              return ok(
                `Sesión NO anónima: ${user.email ?? user.uid}`,
                "Sigue siendo válida; el POS funciona igual."
              );
            }
            return ok(`Sesión anónima activa (uid ${user.uid.slice(0, 8)}…)`);
          },
        },
        {
          id: "vendedor-set",
          nombre: "Vendedor configurado",
          descripcion: "Se guardó un nombre de vendedor en este dispositivo.",
          ejecutar: async () =>
            vendedor
              ? ok(`Vendedor: ${vendedor}`)
              : saltar("Sin vendedor (tócalo en la cabecera para asignar uno)"),
        },
        {
          id: "negocio-activo",
          nombre: "Negocio del subdominio",
          descripcion: "subdominioDeNegocio() resolvió un slug a partir del host.",
          ejecutar: async () => {
            if (!slugActivo) return fallo("subdominioDeNegocio() devolvió null");
            return ok(`Slug activo: ${slugActivo}`);
          },
        },
        {
          id: "ping-firestore",
          nombre: "Lectura desde Firestore",
          descripcion: "Lee el documento del negocio activo para verificar conexión.",
          ejecutar: async () => {
            if (!slugActivo) return saltar("No hay negocio activo");
            const neg = await getNegocio(slugActivo);
            if (!neg) return fallo(`No existe documento negocios/${slugActivo}`);
            return ok(
              `Documento leído: "${neg.nombre}"`,
              `slug=${neg.slug} nombre=${neg.nombre} esperaba="${nombreNegocio}"`
            );
          },
        },
      ],
    },

    // ===== 2. Catálogo =====
    {
      id: "catalogo",
      titulo: "Catálogo (productos)",
      descripcion: "Lectura del catálogo, búsqueda por código, barcode y prefijo.",
      pruebas: [
        {
          id: "cat-cargar",
          nombre: "Cargar catálogo completo",
          descripcion: "todosLosProductos() devuelve la lista del negocio.",
          ejecutar: async () => {
            const ps = await todosLosProductos(true);
            primerProducto = ps[0] ?? null;
            return ps.length === 0
              ? saltar("Catálogo vacío — sin productos para probar")
              : ok(`${ps.length} productos cargados`);
          },
        },
        {
          id: "cat-buscar-codigo",
          nombre: "Buscar por código interno",
          descripcion: "buscarParaVenta(codigo) encuentra un producto existente.",
          ejecutar: async () => {
            const ps = await todosLosProductos();
            primerProducto = primerProducto ?? ps[0] ?? null;
            if (!primerProducto) return saltar("Sin productos para probar");
            const cod = primerProducto.codigo;
            const p = await buscarParaVenta(cod);
            return p && p.codigo === cod
              ? ok(`Encontrado: ${p.codigo} — ${p.descripcion}`)
              : fallo(`No se encontró ${cod}`);
          },
        },
        {
          id: "cat-buscar-inexistente",
          nombre: "Código inexistente devuelve null",
          descripcion: "buscarParaVenta(codigoFalso) no debe devolver match.",
          ejecutar: async () => {
            const p = await buscarParaVenta("__NO_EXISTE_PRUEBAS__");
            return p === null ? ok("Devolvió null como se esperaba") : fallo("Devolvió un match inesperado");
          },
        },
        {
          id: "cat-buscar-barcode",
          nombre: "Buscar por código de barras",
          descripcion: "Encuentra un producto a partir de su EAN/UPC.",
          ejecutar: async () => {
            const ps = await todosLosProductos();
            const conBarcode = ps.find((p) => p.barcode);
            if (!conBarcode) return saltar("No hay productos con barcode cargado");
            const p = await buscarParaVenta(conBarcode.barcode as string);
            return p && p.codigo === conBarcode.codigo
              ? ok(`Encontrado por barcode: ${p.codigo}`)
              : fallo(`No se encontró por barcode ${conBarcode.barcode}`);
          },
        },
        {
          id: "cat-buscar-prefijo",
          nombre: "Buscar por prefijo de código",
          descripcion: "buscarProductos(prefijo) devuelve coincidencias por id.",
          ejecutar: async () => {
            const ps = await todosLosProductos();
            primerProducto = primerProducto ?? ps[0] ?? null;
            if (!primerProducto) return saltar("Sin productos para probar");
            const prefijo = primerProducto.codigo.slice(0, 2);
            const r = await buscarProductos(prefijo, 5);
            return r.length > 0
              ? ok(`Prefijo "${prefijo}" devolvió ${r.length} resultados`)
              : fallo(`Prefijo "${prefijo}" no devolvió nada`);
          },
        },
      ],
    },

    // ===== 3. Fiados / clientes =====
    {
      id: "fiados",
      titulo: "Fiados (clientes)",
      descripcion: "Lectura del cuaderno de fiados y sus movimientos.",
      pruebas: [
        {
          id: "cli-listar",
          nombre: "Listar clientes",
          descripcion: "listarClientes() devuelve la lista.",
          ejecutar: async () => {
            const cs = await listarClientes(true);
            primerClienteId = cs[0]?.id ?? null;
            return cs.length === 0
              ? saltar("No hay clientes registrados")
              : ok(`${cs.length} clientes`);
          },
        },
        {
          id: "cli-movimientos",
          nombre: "Movimientos de un cliente",
          descripcion: "movimientosCliente(id) lee el detalle del primer cliente.",
          ejecutar: async () => {
            if (!primerClienteId) {
              const cs = await listarClientes();
              primerClienteId = cs[0]?.id ?? null;
            }
            if (!primerClienteId) return saltar("Sin clientes para probar");
            const ms = await movimientosCliente(primerClienteId, 10);
            return ok(`${ms.length} movimientos leídos del cliente ${primerClienteId}`);
          },
        },
      ],
    },

    // ===== 4. Emprendedores =====
    {
      id: "emprendedores",
      titulo: "Emprendedores",
      descripcion: "Lectura del listado, búsqueda por token y productos.",
      pruebas: [
        {
          id: "emp-listar",
          nombre: "Listar emprendedores",
          descripcion: "listarEmprendedores() devuelve la lista.",
          ejecutar: async () => {
            const es = await listarEmprendedores();
            const primero = es[0];
            primerEmprendedor = primero ? { id: primero.id, prefijo: primero.prefijo } : null;
            return es.length === 0
              ? saltar("No hay emprendedores")
              : ok(`${es.length} emprendedores`);
          },
        },
        {
          id: "emp-por-token",
          nombre: "Buscar por token",
          descripcion: "getEmprendedorPorToken(token) resuelve el id del primer emprendedor.",
          ejecutar: async () => {
            if (!primerEmprendedor) {
              const es = await listarEmprendedores();
              primerEmprendedor = es[0] ? { id: es[0].id, prefijo: es[0].prefijo } : null;
            }
            if (!primerEmprendedor) return saltar("Sin emprendedores para probar");
            const e = await getEmprendedorPorToken(primerEmprendedor.id);
            return e
              ? ok(`Encontrado: ${e.nombre} (${e.prefijo})`)
              : fallo("No se encontró por token");
          },
        },
        {
          id: "emp-productos",
          nombre: "Productos de un emprendedor",
          descripcion: "productosDeEmprendedor(id) devuelve sus productos en consignación.",
          ejecutar: async () => {
            if (!primerEmprendedor) {
              const es = await listarEmprendedores();
              primerEmprendedor = es[0] ? { id: es[0].id, prefijo: es[0].prefijo } : null;
            }
            if (!primerEmprendedor) return saltar("Sin emprendedores para probar");
            const ps = await productosDeEmprendedor(primerEmprendedor.id);
            return ok(`${ps.length} productos del emprendedor ${primerEmprendedor.prefijo}`);
          },
        },
      ],
    },

    // ===== 5. Ventas =====
    {
      id: "ventas",
      titulo: "Ventas (lectura)",
      descripcion: "Últimas ventas, rango por fecha y meta de venta diaria.",
      pruebas: [
        {
          id: "ven-ultimas",
          nombre: "Últimas ventas",
          descripcion: "ultimasVentas(20) devuelve los documentos más recientes.",
          ejecutar: async () => {
            const vs = await ultimasVentas(20);
            return vs.length === 0
              ? saltar("Aún no hay ventas registradas")
              : ok(`${vs.length} ventas leídas`);
          },
        },
        {
          id: "ven-rango",
          nombre: "Ventas últimos 7 días",
          descripcion: "ventasEnRango(desde, hasta) con índice creadoEn.",
          ejecutar: async () => {
            const hasta = Date.now();
            const desde = hasta - 7 * 24 * 60 * 60 * 1000;
            const vs = await ventasEnRango(desde, hasta);
            const total = vs.reduce((s, v) => s + (v.total || 0), 0);
            return ok(`${vs.length} ventas, total ${money(total)}`);
          },
        },
        {
          id: "ven-meta",
          nombre: "Meta diaria configurada",
          descripcion: "getMetaDiaria() lee config/metas del negocio.",
          ejecutar: async () => {
            const m = await getMetaDiaria();
            return m > 0
              ? ok(`Meta diaria: ${money(m)}`)
              : saltar("Meta diaria no configurada (vale 0)");
          },
        },
      ],
    },

    // ===== 6. Entradas =====
    {
      id: "entradas",
      titulo: "Entradas (lectura)",
      descripcion: "Historial de ingresos de stock.",
      pruebas: [
        {
          id: "ent-ultimas",
          nombre: "Últimas entradas",
          descripcion: "ultimasEntradas(30) devuelve los documentos más recientes.",
          ejecutar: async () => {
            const es = await ultimasEntradas(30);
            return es.length === 0
              ? saltar("Sin entradas registradas")
              : ok(`${es.length} entradas leídas`);
          },
        },
      ],
    },

    // ===== 7. Funciones puras =====
    {
      id: "puras",
      titulo: "Funciones puras (sin Firebase)",
      descripcion: "Formato, subtotales y normalización de códigos/slugs/prefijos.",
      pruebas: [
        {
          id: "puras-money",
          nombre: "money() formatea CLP",
          descripcion: "Sin decimales, con $ y agrupado a la chilena.",
          ejecutar: async () => {
            const a = money(1234567);
            const b = money(0);
            const c = money(99.6); // redondea hacia arriba
            const okFmt = a.includes("1.234.567") && b.includes("0") && c.includes("100");
            return okFmt
              ? ok(`Ejemplos: ${a}, ${b}, ${c}`)
              : fallo("Formato inesperado", `${a} / ${b} / ${c}`);
          },
        },
        {
          id: "puras-subtotal",
          nombre: "subtotalLinea() aplica descuento",
          descripcion: "cantidad × precio × (1 - descuento%).",
          ejecutar: async () => {
            const s1 = subtotalLinea({
              codigo: "X", descripcion: "x", cantidad: 2, precio: 1000, descuento: 0,
            });
            const s2 = subtotalLinea({
              codigo: "X", descripcion: "x", cantidad: 3, precio: 1000, descuento: 10,
            });
            const s3 = subtotalLinea({
              codigo: "X", descripcion: "x", cantidad: 1, precio: 500, descuento: 100,
            });
            const okV = s1 === 2000 && s2 === 2700 && s3 === 0;
            return okV
              ? ok("Tres casos pasaron")
              : fallo("Resultados inesperados", `s1=${s1} s2=${s2} s3=${s3}`);
          },
        },
        {
          id: "puras-normalizar-codigo",
          nombre: "normalizarCodigo() unifica formatos",
          descripcion: "PREFIJO-NNNN cuando aplica; conserva los descriptivos.",
          ejecutar: async () =>
            casos<string>([
              ["ALFO0050", "ALFO-0050", normalizarCodigo, "sin guion"],
              ["amo -0001", "AMO-0001", normalizarCodigo, "minúsculas + espacio"],
              ["JO  0081", "JO-0081", normalizarCodigo, "doble espacio"],
              ["Herb-0001", "HERB-0001", normalizarCodigo, "mixto"],
              ["DIST BAMBU", "DIST BAMBU", normalizarCodigo, "descriptivo se conserva"],
              ["VH0091CO", "VH0091CO", normalizarCodigo, "con sufijo se conserva"],
            ]),
        },
        {
          id: "puras-normalizar-prefijo",
          nombre: "normalizarPrefijo() limpia y limita",
          descripcion: "Solo letras/números en mayúscula, máx 6 caracteres.",
          ejecutar: async () =>
            casos<string>([
              ["amon", "AMON", normalizarPrefijo, "minúsculas"],
              ["Mar-Lu", "MARLU", normalizarPrefijo, "quita guion"],
              ["abcdefgh", "ABCDEF", normalizarPrefijo, "trunca a 6"],
              ["", "", normalizarPrefijo, "vacío"],
            ]),
        },
        {
          id: "puras-normalizar-slug",
          nombre: "normalizarSlug() arma subdominios",
          descripcion: "minúsculas sin tildes, guion como separador.",
          ejecutar: async () =>
            casos<string>([
              ["Té Verde SpA", "te-verde-spa", normalizarSlug, "tildes + espacios"],
              ["Patio Curauma", "patio-curauma", normalizarSlug, "dos palabras"],
              ["   ", "", normalizarSlug, "solo espacios"],
              ["A/B*C", "a-b-c", normalizarSlug, "caracteres raros"],
            ]),
        },
        {
          id: "puras-plan-normalizacion",
          nombre: "planearNormalizacion() detecta conflictos",
          descripcion: "Sobre catálogo sintético: cambios, conflictos y sin-cambio.",
          ejecutar: async () => {
            const productos: Producto[] = [
              { codigo: "ALFO-0050", descripcion: "a", stockActual: 0, costo: 0, precio: 0 },
              { codigo: "JO0081", descripcion: "b", stockActual: 0, costo: 0, precio: 0 },
              { codigo: "JO0082", descripcion: "c", stockActual: 0, costo: 0, precio: 0 },
              { codigo: "DIST BAMBU", descripcion: "d", stockActual: 0, costo: 0, precio: 0 },
              { codigo: "amo-0001", descripcion: "e", stockActual: 0, costo: 0, precio: 0 },
              { codigo: "AMO-0001", descripcion: "f", stockActual: 0, costo: 0, precio: 0 },
            ];
            const plan = planearNormalizacion(productos);
            const okPlan =
              plan.cambios.some((c) => c.de === "JO0081" && c.a === "JO-0081") &&
              plan.cambios.some((c) => c.de === "JO0082" && c.a === "JO-0082") &&
              plan.conflictos.some((c) => c.de === "amo-0001") &&
              plan.sinCambio >= 2;
            return okPlan
              ? ok(
                  `${plan.cambios.length} cambios, ${plan.conflictos.length} conflictos, ${plan.sinCambio} ya OK`,
                  JSON.stringify(plan, null, 2)
                )
              : fallo("Plan inesperado", JSON.stringify(plan, null, 2));
          },
        },
      ],
    },

    // ===== 8. Navegador / PWA =====
    {
      id: "navegador",
      titulo: "Navegador y PWA",
      descripcion: "Capacidades del dispositivo: cámara, almacenamiento, red, impresión.",
      pruebas: [
        {
          id: "nav-online",
          nombre: "Conexión a internet",
          descripcion: "navigator.onLine indica que hay red.",
          ejecutar: async () =>
            typeof navigator !== "undefined" && navigator.onLine
              ? ok("Online")
              : fallo("Sin conexión a internet"),
        },
        {
          id: "nav-camara",
          nombre: "Cámara disponible (escáner)",
          descripcion: "navigator.mediaDevices.getUserMedia está disponible.",
          ejecutar: async () => {
            const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
            if (!md || typeof md.getUserMedia !== "function") {
              return fallo("API mediaDevices no disponible (necesita HTTPS y permiso)");
            }
            return ok("API disponible (no se pide acceso aquí)");
          },
        },
        {
          id: "nav-indexeddb",
          nombre: "IndexedDB disponible",
          descripcion: "Necesaria para el cache offline de Firestore.",
          ejecutar: async () =>
            typeof indexedDB !== "undefined"
              ? ok("IndexedDB disponible")
              : fallo("IndexedDB no disponible"),
        },
        {
          id: "nav-localstorage",
          nombre: "localStorage funciona",
          descripcion: "Set/get/remove de prueba.",
          ejecutar: async () => {
            try {
              const k = "__pruebas_pos__";
              localStorage.setItem(k, "ok");
              const v = localStorage.getItem(k);
              localStorage.removeItem(k);
              return v === "ok" ? ok("Round-trip exitoso") : fallo(`Devolvió "${v}"`);
            } catch (e) {
              return fallo("localStorage falló", (e as Error).message);
            }
          },
        },
        {
          id: "nav-sw",
          nombre: "Service Worker registrado",
          descripcion: "Indica que la PWA está instalada para uso offline.",
          ejecutar: async () => {
            if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
              return fallo("Navegador sin Service Workers");
            }
            const regs = await navigator.serviceWorker.getRegistrations();
            return regs.length > 0
              ? ok(`${regs.length} Service Worker(s) registrado(s)`)
              : saltar("Aún no se registra (recarga después del primer load)");
          },
        },
        {
          id: "nav-print",
          nombre: "Impresión de boleta",
          descripcion: "window.print está disponible para imprimir tickets.",
          ejecutar: async () =>
            typeof window !== "undefined" && typeof window.print === "function"
              ? ok("window.print disponible")
              : fallo("window.print no disponible"),
        },
      ],
    },

    // ===== 9. Escritura (gated) =====
    {
      id: "escritura",
      titulo: "Escritura en Firestore (round-trip)",
      descripcion:
        "Crea un documento de prueba en negocios/{slug}/_pruebas, lo lee y lo borra. No toca ventas, stock ni clientes reales.",
      escritura: true,
      pruebas: [
        {
          id: "esc-roundtrip",
          nombre: "Crear → leer → borrar documento de prueba",
          descripcion:
            "Verifica permisos de escritura en el negocio activo sin contaminar los datos.",
          ejecutar: async () => {
            if (!slugActivo) return fallo("Sin negocio activo");
            const id = "_ping_" + Date.now();
            const ref = doc(getDb(), "negocios", slugActivo, "_pruebas", id);
            const valor = { creadoEn: Date.now(), por: vendedor || user?.uid || "?" };
            try {
              await setDoc(ref, valor);
              const snap = await getDoc(ref);
              if (!snap.exists()) return fallo("El doc no se leyó tras escribirlo");
              const data = snap.data() as { creadoEn: number };
              if (data.creadoEn !== valor.creadoEn) {
                return fallo("creadoEn no coincide", JSON.stringify(data));
              }
              await deleteDoc(ref);
              const snap2 = await getDoc(ref);
              if (snap2.exists()) return fallo("El doc no se borró");
              return ok(`Round-trip OK en negocios/${slugActivo}/_pruebas/${id}`);
            } catch (e) {
              // Intenta limpiar de todos modos.
              try { await deleteDoc(ref); } catch { /* noop */ }
              return fallo("Falló la escritura", (e as Error).message);
            }
          },
        },
      ],
    },
  ];
}
