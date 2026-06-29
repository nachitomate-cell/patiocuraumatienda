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

export async function GET(req: NextRequest) {
  const expectedToken = process.env.INVENTARIO_API_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "API no configurada: falta INVENTARIO_API_TOKEN." },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
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
      costo?: number;
      lote?: string;
      barcode?: string;
      emprendedorNombre?: string;
    };

    const productos = snap.docs
      .map((d) => {
        const data = d.data() as Doc;
        return {
          codigo: data.codigo ?? d.id,
          descripcion: data.descripcion ?? "",
          stock: data.stockActual ?? 0,
          precio: data.precio ?? 0,
          costo: data.costo ?? 0,
          lote: data.lote ?? "",
          barcode: data.barcode ?? "",
          emprendedor: data.emprendedorNombre ?? "",
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
          // Sin cache: cada request consulta Firestore fresco para que el
          // consumidor siempre vea el stock real.
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Error consultando inventario." },
      { status: 500 }
    );
  }
}
