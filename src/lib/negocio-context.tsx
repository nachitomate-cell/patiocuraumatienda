"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { type Branding } from "./negocio";
import { subdominioDeNegocio } from "./tenant";
import { getNegocio } from "./admin";
import { getBoletaConfig } from "./repo";
import { useAuth } from "./auth";

// Marca del negocio activo, cargada desde el documento negocios/{slug} en
// Firestore. En un solo deploy multi-tenant la marca NO puede venir de las
// variables de entorno (serían iguales para todos): vive en Firestore por
// negocio. Mientras carga se usa un default neutro derivado del subdominio, de
// modo que nunca se muestra (ni "parpadea") la marca de otro negocio.

// Logo por defecto cuando el doc del negocio no tiene uno fijado. Convención:
// public/logos/{slug}.png. Si el archivo no existe para ese slug, el moderador
// puede setear la URL explícita en negocios/{slug}.logo.
function logoPorDefecto(slug: string): string {
  return slug ? `/logos/${slug}.png` : "/logo.png";
}

function neutro(slug: string): Branding {
  return {
    nombre: slug,
    nombreCorto: slug,
    eslogan: "",
    rubro: "",
    ubicacion: "",
    web: "",
    instagram: "",
    emailPlaceholder: "correo@ejemplo.cl",
    logo: logoPorDefecto(slug),
    fondoLogin: "",
    qrClub: "",
    slug,
  };
}

interface CtxValue {
  branding: Branding;
  recargar: () => Promise<void>;
}

const Ctx = createContext<CtxValue>({
  branding: neutro(""),
  recargar: async () => {},
});

export function NegocioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [branding, setBranding] = useState<Branding>(() =>
    neutro((typeof window !== "undefined" && subdominioDeNegocio()) || "")
  );

  // Carga (o recarga) el branding + la config de boleta del negocio activo.
  // Lo expone como `recargar` para que el editor de la boleta dispare un
  // refresh tras guardar sin tener que recargar la página.
  const cargar = useCallback(async () => {
    const slug = subdominioDeNegocio();
    if (!slug) return;
    try {
      const [n, boletaSub] = await Promise.all([
        getNegocio(slug),
        getBoletaConfig(slug).catch(() => null),
      ]);
      if (!n) return;
      setBranding({
        nombre: n.nombre || slug,
        nombreCorto: n.nombreCorto || n.nombre || slug,
        eslogan: n.eslogan || "",
        rubro: n.rubro || "",
        ubicacion: n.ubicacion || "",
        web: n.web || "",
        instagram: n.instagram || "",
        emailPlaceholder: n.emailPlaceholder || "correo@ejemplo.cl",
        logo: n.logo || logoPorDefecto(slug),
        fondoLogin: n.fondoLogin || "",
        qrClub: n.qrClub || "",
        slug: n.slug || slug,
        boleta: boletaSub ?? n.boleta,
      });
    } catch {
      /* sin doc o sin permiso: queda el default neutro */
    }
  }, []);

  useEffect(() => {
    // Espera a tener sesión (anónima o real): Firestore exige auth para leer.
    if (!user) return;
    cargar();
  }, [user, cargar]);

  return (
    <Ctx.Provider value={{ branding, recargar: cargar }}>{children}</Ctx.Provider>
  );
}

export function useNegocio(): Branding {
  return useContext(Ctx).branding;
}

// Devuelve un callback para forzar la recarga del branding (y la boleta) del
// negocio activo desde Firestore. Lo usa el editor de la boleta tras guardar.
export function useRecargarNegocio(): () => Promise<void> {
  return useContext(Ctx).recargar;
}
