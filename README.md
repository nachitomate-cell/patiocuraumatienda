# Patio Curauma — POS web (Next.js + Firebase)

Punto de venta e inventario que replica el Excel `PATIO_CDS_DEFINITIVO_OK.xlsm`.
Web PWA desplegable en Vercel, con datos en Firebase Firestore y **caché offline**
local en el PC (sigue vendiendo aunque se caiga internet).

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4
- Firebase Firestore (con `persistentLocalCache`) + Firebase Auth
- Exportación de respaldos a `.xlsx` (SheetJS)
- PWA instalable (service worker)

## Puesta en marcha

### 1. Instalar dependencias
```bash
npm install
```

### 2. Crear proyecto Firebase
1. Ve a https://console.firebase.google.com → crear proyecto.
2. Agrega una app **Web** y copia las credenciales del SDK.
3. Activa **Authentication → Sign-in method → Correo/contraseña** y crea un usuario.
4. Crea **Cloud Firestore** (modo producción).
5. En **Firestore → Reglas**, pega el contenido de `firestore.rules`.

### 3. Variables de entorno
Copia `.env.local.example` como `.env.local` y completa las claves `NEXT_PUBLIC_FIREBASE_*`.

### 4. Ejecutar
```bash
npm run dev
```
Abre http://localhost:3000 → te redirige a `/venta`. Inicia sesión con el usuario creado.

### 5. Cargar el catálogo
Ve a **Admin → Importar catálogo**. Sube los 3.374 productos extraídos del Excel
(`src/data/productos.seed.json`) a la colección `productos`.

## Modelo de datos (Firestore)
- `productos/{codigo}` → `{ codigo, descripcion, lote, stockActual, costo, precio }`
- `ventas/{nro}` → `{ nro, fecha, cliente, items[], total, creadoEn, vendedor }`
- `contadores/ventas` → `{ ultimo }` (correlativo NV-######)

El stock se mantiene en el campo `stockActual` y se descuenta de forma atómica
(`increment`) al confirmar cada venta — no se recalcula con SUMIFS como en el Excel.

## Despliegue en Vercel
1. Sube el repo a GitHub e impórtalo en Vercel.
2. Carga las variables `NEXT_PUBLIC_FIREBASE_*` en Vercel (Settings → Environment Variables).
3. Deploy. Listo.

## Pantallas
- `/venta` — panel de venta (carrito, total, confirmar, imprimir ticket).
- `/stock` — consulta de inventario por código.
- `/admin` — importar catálogo y exportar respaldos `.xlsx`.
