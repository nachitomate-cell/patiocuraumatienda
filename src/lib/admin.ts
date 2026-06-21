// Administración global (panel moderador). A diferencia de repo.ts, estas
// colecciones NO cuelgan de un negocio: son globales.
//   negocios/{slug}   -> un negocio (slug = subdominio). Guarda su branding.
//   usuarios/{uid}    -> a qué negocio pertenece cada usuario y su rol.

import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getDb, firebaseConfig } from "./firebase";

export type RolUsuario = "moderador" | "admin" | "vendedor";

export interface Usuario {
  uid: string;
  email: string;
  rol: RolUsuario;
  // Los moderadores no pertenecen a un negocio (acceso global).
  negocioId: string | null;
  creadoEn?: number;
}

export interface Negocio {
  slug: string; // id del documento = subdominio
  nombre: string;
  nombreCorto?: string;
  eslogan?: string;
  rubro?: string;
  ubicacion?: string;
  web?: string;
  instagram?: string;
  emailPlaceholder?: string;
  logo?: string; // URL o ruta (ej. /logos/kronos.png)
  fondoLogin?: string; // imagen de fondo del login (URL o ruta); vacío = sin fondo
  qrClub?: string; // URL del QR del club; vacío = sin club en la boleta
  creadoEn?: number;
}

const USUARIOS = "usuarios";
const NEGOCIOS = "negocios";

export async function getUsuario(uid: string): Promise<Usuario | null> {
  const snap = await getDoc(doc(getDb(), USUARIOS, uid));
  if (!snap.exists()) return null;
  return { uid, ...(snap.data() as Omit<Usuario, "uid">) };
}

export async function esModerador(uid: string): Promise<boolean> {
  const u = await getUsuario(uid);
  return u?.rol === "moderador";
}

// ===== Negocios =====

export async function getNegocio(slug: string): Promise<Negocio | null> {
  const snap = await getDoc(doc(getDb(), NEGOCIOS, slug));
  if (!snap.exists()) return null;
  return { slug: snap.id, ...(snap.data() as Omit<Negocio, "slug">) };
}

export async function listarNegocios(): Promise<Negocio[]> {
  const snap = await getDocs(collection(getDb(), NEGOCIOS));
  return snap.docs
    .map((d) => ({ slug: d.id, ...(d.data() as Omit<Negocio, "slug">) }))
    .sort((a, b) => (a.nombre || a.slug).localeCompare(b.nombre || b.slug));
}

// Normaliza el slug/subdominio: minúsculas, sin tildes, solo letras/números y
// guion (ej. "Té Verde SpA" -> "te-verde-spa").
export function normalizarSlug(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // quita tildes/diacríticos
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export async function crearNegocio(
  slug: string,
  datos: Omit<Negocio, "slug" | "creadoEn">
): Promise<string> {
  const id = normalizarSlug(slug);
  if (!id) throw new Error("El subdominio no puede quedar vacío.");
  if (!datos.nombre?.trim()) throw new Error("El nombre no puede quedar vacío.");
  const ref = doc(getDb(), NEGOCIOS, id);
  const existe = await getDoc(ref);
  if (existe.exists()) {
    throw new Error(`Ya existe un negocio con el subdominio "${id}".`);
  }
  await setDoc(ref, { ...datos, nombre: datos.nombre.trim(), slug: id, creadoEn: Date.now() });
  return id;
}

// ===== Usuarios =====

export async function listarUsuarios(): Promise<Usuario[]> {
  const snap = await getDocs(collection(getDb(), USUARIOS));
  return snap.docs
    .map((d) => ({ uid: d.id, ...(d.data() as Omit<Usuario, "uid">) }))
    .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
}

// Crea un usuario de Firebase Auth SIN cerrar la sesión del moderador.
// createUserWithEmailAndPassword inicia sesión con el usuario recién creado;
// al hacerlo en una instancia secundaria de la app, la sesión principal del
// moderador queda intacta. El documento usuarios/{uid} se escribe con la
// sesión principal (la del moderador).
export async function crearUsuario(
  email: string,
  password: string,
  negocioId: string | null,
  rol: RolUsuario
): Promise<string> {
  const correo = email.trim();
  if (!correo) throw new Error("El correo no puede quedar vacío.");
  if ((password || "").length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }
  if (rol !== "moderador" && !negocioId) {
    throw new Error("Elige el negocio al que pertenece el usuario.");
  }
  const sec = initializeApp(firebaseConfig, "alta-usuario-" + Date.now());
  try {
    const cred = await createUserWithEmailAndPassword(getAuth(sec), correo, password);
    await setDoc(doc(getDb(), USUARIOS, cred.user.uid), {
      email: correo,
      rol,
      negocioId: rol === "moderador" ? null : negocioId,
      creadoEn: Date.now(),
    });
    await signOut(getAuth(sec));
    return cred.user.uid;
  } finally {
    await deleteApp(sec);
  }
}
