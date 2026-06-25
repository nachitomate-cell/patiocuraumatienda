"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type Branding } from "./negocio";
import { subdominioDeNegocio } from "./tenant";
import { getNegocio } from "./admin";
import { useAuth } from "./auth";

// Marca del negocio activo, cargada desde el documento negocios/{slug} en
// Firestore. En un solo deploy multi-tenant la marca NO puede venir de las
// variables de entorno (serían iguales para todos): vive en Firestore por
// negocio. Mientras carga se usa un default neutro derivado del subdominio, de
// modo que nunca se muestra (ni "parpadea") la marca de otro negocio.

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
    logo: "/logo.png",
    fondoLogin: "",
    qrClub: "",
    slug,
  };
}

const Ctx = createContext<Branding>(neutro(""));

export function NegocioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [branding, setBranding] = useState<Branding>(() =>
    neutro((typeof window !== "undefined" && subdominioDeNegocio()) || "")
  );

  useEffect(() => {
    const slug = subdominioDeNegocio();
    // Espera a tener sesión (anónima o real): Firestore exige auth para leer.
    if (!slug || !user) return;
    getNegocio(slug)
      .then((n) => {
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
          logo: n.logo || "/logo.png",
          fondoLogin: n.fondoLogin || "",
          qrClub: n.qrClub || "",
          slug: n.slug || slug,
          boleta: n.boleta,
        });
      })
      .catch(() => {
        /* sin doc o sin permiso: queda el default neutro */
      });
  }, [user]);

  return <Ctx.Provider value={branding}>{children}</Ctx.Provider>;
}

export function useNegocio(): Branding {
  return useContext(Ctx);
}
