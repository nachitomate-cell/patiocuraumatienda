// Negocio activo (tenant) para todas las operaciones de datos.
//
// El subdominio elige el negocio (patio.synaptechspa.cl -> "patio"); el login
// luego confirma que el usuario pertenece a ese negocio (lo refuerzan las
// reglas de Firestore). Aquí solo guardamos el id del negocio activo y avisamos
// a quien dependa de él (p. ej. el cache del catálogo en repo.ts) cuando cambia.

let _negocioId: string | null = null;
const listeners = new Set<() => void>();

export function setNegocioActivo(id: string | null): void {
  if (_negocioId === id) return;
  _negocioId = id;
  listeners.forEach((f) => f());
}

// Id del negocio activo. Si aún no se fijó explícitamente, lo deriva del
// subdominio (init perezoso): así una lectura temprana —p. ej. en la página
// pública /alta, que no pasa por el AuthProvider— no depende del orden de los
// efectos de React.
export function getNegocioId(): string {
  if (!_negocioId && typeof window !== "undefined") {
    _negocioId = subdominioDeNegocio();
  }
  if (!_negocioId) {
    throw new Error("No hay un negocio activo. ¿Se resolvió el subdominio?");
  }
  return _negocioId;
}

export function negocioActivo(): string | null {
  return _negocioId;
}

// Suscribe un callback que se ejecuta cuando cambia el negocio activo (p. ej.
// para invalidar caches). Devuelve la función para desuscribir.
export function onCambioNegocio(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Deriva el slug del negocio desde el subdominio del host.
//   patio.synaptechspa.cl      -> "patio"
//   synaptechspa.cl / www.*    -> null (dominio raíz, sin negocio)
//   localhost / IP (dev)       -> ?negocio= en la URL, o NEXT_PUBLIC_NEGOCIO_DEV,
//                                 o "patio" como último recurso para desarrollo.
export function subdominioDeNegocio(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  const esLocal =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (esLocal) {
    const q = new URLSearchParams(window.location.search).get("negocio");
    return q || process.env.NEXT_PUBLIC_NEGOCIO_DEV || "patiocurauma";
  }
  const partes = host.split(".");
  if (partes.length <= 2) return null; // dominio raíz, sin subdominio
  const sub = partes[0];
  return sub === "www" ? null : sub;
}
