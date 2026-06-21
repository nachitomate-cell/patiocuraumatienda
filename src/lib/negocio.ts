// Identidad del negocio: marca, contacto y textos visibles al cliente.
//
// Todo lo específico de un negocio vive aquí y puede sobrescribirse con
// variables de entorno NEXT_PUBLIC_NEGOCIO_* (ver .env.local.example). Los
// valores por defecto son los de Patio Curauma, de modo que su despliegue
// actual no cambia aunque no se defina ninguna variable.
//
// Para montar el POS de OTRO negocio: crea un proyecto aparte en Vercel con su
// propio Firebase y define estas variables con sus datos. No hace falta tocar
// código: la marca sale completa desde la configuración.

function v(valor: string | undefined, def: string): string {
  const t = (valor ?? "").trim();
  return t || def;
}

// Forma de la marca de un negocio (la usa el contexto que la carga desde
// Firestore; ver negocio-context.tsx).
export type Branding = {
  nombre: string;
  nombreCorto: string;
  eslogan: string;
  rubro: string;
  ubicacion: string;
  web: string;
  instagram: string;
  emailPlaceholder: string;
  logo: string;
  fondoLogin: string; // imagen de fondo de la pantalla de login (opcional)
  qrClub: string;
  slug: string;
};

export const NEGOCIO = {
  // Nombre completo: cabecera, boleta, login, mensajes de WhatsApp.
  nombre: v(process.env.NEXT_PUBLIC_NEGOCIO_NOMBRE, "Patio Curauma"),
  // Nombre corto para la PWA (ícono en la pantalla de inicio del teléfono).
  nombreCorto: v(process.env.NEXT_PUBLIC_NEGOCIO_NOMBRE_CORTO, "Patio POS"),
  // Lema bajo el nombre en la cabecera.
  eslogan: v(process.env.NEXT_PUBLIC_NEGOCIO_ESLOGAN, "Premium POS"),
  // Bajada / rubro que aparece en la boleta. Vacío = no se muestra.
  rubro: v(process.env.NEXT_PUBLIC_NEGOCIO_RUBRO, "Productos Naturales y Artesanales"),
  // Ciudad o dirección corta. Vacío = no se muestra.
  ubicacion: v(process.env.NEXT_PUBLIC_NEGOCIO_UBICACION, "Curauma, Valparaíso"),
  // Sitio web (sin https://), se imprime en la boleta. Vacío = no se muestra.
  web: v(process.env.NEXT_PUBLIC_NEGOCIO_WEB, "www.patiocuraumaonline.com"),
  // Instagram con @. Vacío = no se muestra.
  instagram: v(process.env.NEXT_PUBLIC_NEGOCIO_INSTAGRAM, "@patiocurauma"),
  // Placeholder del campo correo en el login.
  emailPlaceholder: v(process.env.NEXT_PUBLIC_NEGOCIO_EMAIL, "correo@patiocurauma.cl"),
  // Ruta del logo dentro de /public (reemplaza el archivo para cambiarlo).
  logo: v(process.env.NEXT_PUBLIC_NEGOCIO_LOGO, "/logo.png"),
  // Imagen del QR del club de fidelización en la boleta. Vacío = no se muestra
  // la sección del club.
  qrClub: v(process.env.NEXT_PUBLIC_NEGOCIO_QR_CLUB, "/qr-club.png"),
  // Prefijo de los archivos exportados: ventas_<slug>_fecha.xlsx, etc.
  slug: v(process.env.NEXT_PUBLIC_NEGOCIO_SLUG, "patio"),
};
