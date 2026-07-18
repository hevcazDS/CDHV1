# Auditoría del sistema de IMÁGENES / FOTOS

Fecha: 2026-07-18 · Repo en solo lectura · **No se implementó nada** (solo análisis + plan).

Meta del dueño: fotos guardadas **en el propio sistema** (subes jpg/png → se convierte a **WebP** para pesar menos), **ambivalente** (soportar a la vez liga externa **y** archivo local), una sola fuente de verdad reutilizable en: (1) WhatsApp, (2) POS, (3) catálogo, (4) adjuntar en cotizaciones. Aditivo: las ligas actuales de Julio Cepeda deben seguir funcionando.

---

## (a) Estado actual (con evidencia)

**Imágenes de PRODUCTO = solo URL externa, sin upload.**
- `db/schema.sql:287` → `productos.url_imagen TEXT` (una sola columna, texto libre).
- Alta/edición en el panel es un `TextInput` de URL, nada de archivo: `dashboard-ui/src/pages/prime/productoCampos.jsx:198` (`<TextInput label="URL de imagen" .../>`), persistido tal cual en `dashboard/routes/primeCatalogo.js:203` (`datos.url_imagen || null`).
- El bot manda la foto del producto **solo desde URL**: `bot/flows/menuFlow.js:553` y `bot/flows/cartFlow.js:262` → `MessageMedia.fromUrl(prod.url_imagen, { unsafeMime:true })`. **No hay un solo `MessageMedia.fromFilePath` en todo el repo** (grep confirmado) ⇒ un archivo local hoy **no se puede mandar al cliente**.

**Imágenes que el CLIENTE manda al bot = sí se guardan localmente y YA se convierten a WebP.**
- `bot/index.js:978-1006`: `msg.downloadMedia()` → escribe el original en `bot/imagenes_clientes/<tel>_<ts>.<ext>` y **acto seguido intenta `services/imagenWebp.convertirAWebp()`**.
- `services/imagenWebp.js`: usa el binario del sistema **`cwebp`** (`execFileSync('cwebp', ['-q','78',...])`, calidad 78). **Cero dependencia npm.** Si convierte, borra el original y devuelve el `.webp`; si no hay `cwebp` (Windows dev), conserva el original y sigue. El `webp` (apt) está en el Dockerfile.
- Se sirven autenticadas por `GET /api/imagenes_clientes/:archivo` en `dashboard/routes/etiquetas.js:82-91` (valida nombre contra regex, anti path-traversal, `Content-Type` por extensión — ya incluye webp). Las consumen `Etiquetas.jsx:72` y `Devoluciones.jsx:76`.
- `scripts/backup.js` respalda por correo la carpeta; `stockWatcher.js` la purga a 60 días (solo lo ya respaldado).

**Upload de binarios en el dashboard (server `http` nativo, sin framework):**
- No hay endpoint multipart/form-data. El **único patrón existente para subir un archivo grande es base64 dentro de un JSON**: `POST /api/prime/restaurar-bd` (`dashboard/routes/seguridadOperativa.js:162-174`) lee `readBody` → `JSON.parse` → `d.archivo_base64` → `Buffer.from(_b64,'base64')`. Ese endpoint está **exento del cap de body** (`dashboard/server.js:692`) y del rechazo JSON-only. Este es el patrón a reutilizar para subir fotos.

**Librerías de imagen disponibles:**
- `sharp`: **NO** está en `package.json`.
- Sí está `cwebp` (binario del sistema, ya usado). Sí está `puppeteer-core` + Chrome (para el bot), pero no se usa para imágenes.

**POS y Catálogo (visual):**
- POS: `dashboard/routes/pos.js` y `dashboard-ui/src/pages/Mostrador.jsx` **no leen imagen alguna** (grep sin resultados). El POS es texto/precio, sin miniatura.
- Catálogo backend sí acarrea `url_imagen`; el panel solo muestra/edita la URL.

**Cotizaciones:**
- `services/cotizacionBot.js`: solo texto + `items_json`. **No adjunta imágenes ni genera PDF** (grep de `pdf|imagen|MessageMedia|adjunt` sin resultados). Es un mensaje de estado de WhatsApp, no un documento.

---

## (b) Brecha vs la meta

| Necesita | ¿Existe? |
|---|---|
| Subir jpg/png de **producto** desde el panel | ❌ (solo campo URL) |
| Convertir la subida a **WebP** | ⚠️ Existe el conversor (`imagenWebp.js`) pero **solo** cableado a fotos-de-cliente, no a productos |
| Guardar foto de producto **local** (además de la liga) | ❌ (columna única `url_imagen`, no distingue local vs externa) |
| Mandar una foto **local** al cliente por WhatsApp | ❌ (solo `fromUrl`, nunca `fromFilePath`) |
| Servir estáticamente las fotos de producto | ⚠️ Hay servidor de imágenes de cliente reusable, pero apunta solo a `imagenes_clientes/` |
| Miniatura en **POS** | ❌ |
| **Adjuntar** imagen en cotización | ❌ |
| Múltiples fotos por producto | ❌ (1 columna) |

Lo bueno: **la mitad ya está resuelta** — conversión WebP, carpeta local, servido autenticado y el patrón base64-upload existen. Falta cablearlos al producto.

---

## (c) Diseño propuesto (una sola fuente de verdad, ambivalente)

**Principio: `url_imagen` se convierte en el resolvedor único.** No añadir tabla ni segunda columna todavía (YAGNI de "múltiples fotos"). Se distingue local vs externa por el **valor**:
- Empieza con `http` → liga externa (comportamiento actual de JC, intacto).
- Cualquier otra cosa → nombre de archivo local servido por el dashboard.

Esto es aditivo y byte-idéntico para Julio Cepeda (sus valores siguen siendo `http://...`).

**Almacenamiento:** nueva carpeta `bot/imagenes_productos/` (misma forma que `imagenes_clientes/`: montada como volumen en `docker-compose.yml`, respaldada, gitignored). WebP, calidad 78, con `services/imagenWebp.js` tal cual.

**Servido:** clonar el handler de `etiquetas.js:82` a `GET /api/imagenes_productos/:archivo` (mismo anti-traversal y MIME). Público-de-sesión como el resto de `/api/*`.

**Flujo upload → convertir → guardar (reusa restaurar-bd):**
1. Panel: `<input type="file">` → lee como base64 → `POST /api/prime/producto-imagen` `{ id_producto, archivo_base64, mimetype }` (gerente+, exento de body-cap como restaurar-bd).
2. Backend: `Buffer.from(base64)` → escribe `<id>_<ts>.<ext>` en `imagenes_productos/` → `convertirAWebp()` → guarda el basename resultante en `productos.url_imagen`.
3. El `TextInput` de URL se queda (para pegar ligas externas): **ambos caminos escriben la misma columna**.

**Cómo lee cada uso (una sola función `resolverImagen(url_imagen)`):**
- Helper compartido: `http*` → devuelve `{ tipo:'url', valor }`; si no → `{ tipo:'local', ruta: imagenes_productos/<valor> }`.
- **WhatsApp** (`menuFlow.js`/`cartFlow.js`): si `url` → `MessageMedia.fromUrl` (hoy); si `local` → `MessageMedia.fromFilePath(ruta)`. **Advertencia WhatsApp/WebP:** WhatsApp trata un `.webp` como **sticker**, no como foto normal con caption. Para el envío al cliente hay que mandar **JPEG**. Opciones: (i) guardar WebP para el panel **y** un JPEG derivado para envío, o (ii) reconvertir WebP→JPEG al vuelo con `cwebp`/`dwebp` antes de `fromFilePath`. Recomendado: guardar **ambos** (`<id>.webp` para panel/POS/catálogo, `<id>.jpg` para WhatsApp) — el WebP es la fuente de verdad de peso, el JPEG es el "formato de transporte" de WhatsApp. Las ligas externas ya suelen ser jpg/png, sin problema.
- **POS** (`Mostrador.jsx`) y **Catálogo**: `<img src>` apuntando a `url_imagen` si es http, o `/api/imagenes_productos/<valor>` si es local. Navegadores modernos muestran WebP nativo, sin conversión.
- **Cotización** (`cotizacionBot.js`): al armar el mensaje, si el ítem tiene imagen resoluble, mandar cada foto (o la del primer ítem) por `MessageMedia.fromFilePath`/`fromUrl` **antes** del texto de la cotización — mismo helper de envío. Es el único punto que hoy no manda nada de imagen.

---

## (d) Dependencias

**No agregar `sharp`.** Ya hay solución nativa.

| Opción | Pros | Contras |
|---|---|---|
| **`cwebp`/`dwebp` (actual)** | Cero dep npm; ya en uso y probado; en Dockerfile; degrada limpio sin binario | Requiere el binario en el server (ya está); en Windows dev no convierte (aceptable, conserva original) |
| `sharp` | Multiplataforma sin binario externo; API rica | Dependencia nativa pesada (prebuilds), justo lo que el proyecto evitó; redundante con `cwebp` |
| Puppeteer/Chrome | Ya instalado | Ridículo para convertir imágenes; lento, frágil |

**Veredicto:** seguir con `cwebp` (+ `dwebp` o `cwebp` para el JPEG de WhatsApp). Cero deps nuevas.

---

## (e) Plan por fases

**P0 — foto de producto local con WebP (reusa todo lo existente):**
1. Carpeta `bot/imagenes_productos/` + volumen en `docker-compose.yml` + gitignore + respaldo en `scripts/backup.js` (copiar las 2 líneas de `imagenes_clientes`).
2. Endpoint `POST /api/prime/producto-imagen` (patrón base64 de `restaurar-bd`, exento de body-cap) → escribe + `convertirAWebp()` → guarda basename en `productos.url_imagen`.
3. `GET /api/imagenes_productos/:archivo` (clon de `etiquetas.js:servirImagen`).
4. Helper `resolverImagen(url_imagen)` en `_shared.js` (http vs local).
5. Panel: `<input type="file">` junto al `TextInput` de URL en `productoCampos.jsx`.
6. WhatsApp: en `menuFlow.js:553` y `cartFlow.js:262`, usar el helper → `fromFilePath` para locales. Guardar también `<id>.jpg` para el envío (sticker-fix). JC intacto (sigue por `fromUrl`).

**P1 — el resto de los usos:**
7. POS: miniatura en `Mostrador.jsx` leyendo `url_imagen` resuelto.
8. Catálogo: preview de la imagen (local o URL) en `CatalogoTab.jsx`.
9. Cotización: adjuntar foto(s) de los ítems antes del texto en `cotizacionBot.js`.
10. (Opcional, si se pide) múltiples fotos por producto → tabla `producto_imagenes(id_producto, url_imagen, orden)`; **no antes** de que exista la necesidad real.

---

### Resumen ejecutivo

El sistema ya tiene la **mitad de la infraestructura**: conversión a WebP (`services/imagenWebp.js` con el binario `cwebp`, cero deps npm), carpeta local (`imagenes_clientes/`), servido autenticado (`/api/imagenes_clientes/:archivo`) y un patrón de subida de binarios (base64-en-JSON de `restaurar-bd`). Lo que **falta** es cablear todo eso al **producto**: hoy `productos.url_imagen` es **solo una URL externa**, el panel solo pega ligas, y el bot solo manda con `fromUrl` (nunca `fromFilePath`), por lo que un archivo local no llega al cliente. POS y cotización **no muestran/adjuntan imágenes**.

La solución **ambivalente sin romper Julio Cepeda** es tratar `url_imagen` como fuente única: si empieza con `http` es liga externa (JC intacto), si no es un archivo local WebP en `bot/imagenes_productos/`. Se reutiliza el conversor, el patrón de upload y el servidor de estáticos ya existentes; **no hace falta `sharp`**. Única advertencia técnica: **WhatsApp muestra WebP como sticker**, así que para enviar al cliente se guarda también un JPEG derivado (el WebP sigue siendo la fuente de verdad ligera para panel/POS/catálogo). Plan: P0 cablea foto local de producto + envío WhatsApp; P1 añade POS, catálogo y adjunto en cotización.
