import { NextRequest, NextResponse } from "next/server";
import { collection, getDocs } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { getDb, getAuthInstance } from "@/lib/firebase";

// Endpoint público (con token) para que otros sistemas consuman el catálogo
// con stock actual. Sólo lectura. La fuente es la misma colección que usa
// el POS, así que está siempre al día.
//
// Uso:
//   GET /api/inventario?slug=patiocurauma
//   Header: Authorization: Bearer <INVENTARIO_API_TOKEN>
//
// Variables de entorno requeridas en Vercel:
//   INVENTARIO_API_TOKEN  → token compartido con el consumidor
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS abierto: el endpoint ya está autenticado por token, no hay riesgo de
// que un sitio público lo abuse desde el navegador del usuario final.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  // trim(): al pegar el token en el dashboard de Vercel puede colarse un
  // espacio o salto de línea invisible que rompería la comparación exacta.
  const expectedToken = (process.env.INVENTARIO_API_TOKEN || "").trim();
  if (!expectedToken) {
    return NextResponse.json(
      { error: "API no configurada: falta INVENTARIO_API_TOKEN." },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const auth = (req.headers.get("authorization") || "").trim();
  if (auth !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { ...CORS_HEADERS, "WWW-Authenticate": "Bearer" } }
    );
  }

  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") || "patiocurauma").trim();
  const soloConStock = url.searchParams.get("conStock") === "true";

  try {
    await signInAnonymously(getAuthInstance());
    const snap = await getDocs(
      collection(getDb(), "negocios", slug, "productos")
    );

    type Doc = {
      codigo?: string;
      descripcion?: string;
      stockActual?: number;
      precio?: number;
      lote?: string;
      barcode?: string;
    };

    // No se exponen costo ni emprendedor: son datos internos del negocio y el
    // consumidor externo (ej. Jumpseller) sólo necesita catálogo, stock y precio.
    const productos = snap.docs
      .map((d) => {
        const data = d.data() as Doc;
        return {
          codigo: data.codigo ?? d.id,
          descripcion: data.descripcion ?? "",
          stock: data.stockActual ?? 0,
          precio: data.precio ?? 0,
          lote: data.lote ?? "",
          barcode: data.barcode ?? "",
        };
      })
      .filter((p) => (soloConStock ? p.stock > 0 : true));

    return NextResponse.json(
      {
        slug,
        total: productos.length,
        generadoEn: new Date().toISOString(),
        productos,
      },
      {
        headers: {
          ...CORS_HEADERS,
          // Sin cache: cada request consulta Firestore fresco para que el
          // consumidor siempre vea el stock real.
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Error consultando inventario." },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
