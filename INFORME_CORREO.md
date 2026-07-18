# Informe de viabilidad — Módulo de Correo (bandeja + redacción + envío con adjuntos)

> Fecha: 2026-07-18 · **Evaluación de viabilidad, sin implementar.** Meta del dueño:
> un módulo TOGGLEABLE con bandeja de entrada completa + redacción + envío con
> adjuntos (imágenes, facturas, cotizaciones PDF, reportes), vía Gmail con **clave
> de aplicación**.

## 0. Veredicto en una línea

**Viable. Se parte en dos mitades con distinto costo:**
- **Redactar + enviar + adjuntar (P0): viable YA, casi sin dependencias nuevas** —
  reutiliza el SMTP hand-rolled y la clave de aplicación que ya existen; el único
  faltante para adjuntar *PDFs* es generarlos server-side (Chrome ya está en el
  contenedor).
- **Bandeja de entrada / leer correos (P1): viable pero requiere IMAP**, que hoy NO
  existe en el código. La vía sensata es agregar **1–2 dependencias** (`imapflow` +
  `mailparser`); hand-rollear IMAP sobre `net/tls` (para respetar el "no nodemailer")
  sería enorme y frágil — **no recomendado**.

---

## 1. Qué YA existe (a favor)

| Pieza | Dónde | Sirve para |
|---|---|---|
| Cliente **SMTP hand-rolled** (net/tls, STARTTLS, sin nodemailer) | `services/emailService.js` | Enviar correo (texto + HTML). Ya multipart/alternative. |
| **Envío con ADJUNTOS** (multipart/mixed, base64) | `scripts/backup.js:167-205` (respalda BD/imágenes por correo) y `services/datasetExport.js` | Patrón probado para adjuntar archivos — se extrae a un helper reusable. |
| **Clave de aplicación de Gmail** ya es el modelo | `emailService.js:8-12` (`EMAIL_USER`/`EMAIL_PASS`) y config `bot_email_usuario`/`bot_email_password` | Auth SMTP hoy; **la misma clave sirve para IMAP** (no requiere OAuth). |
| **Cifrado de secretos** | `pac.cifrarSecreto()` (usado para API keys de PAC/gateway, `primeConfig.js:384`) | Cifrar la clave de aplicación en reposo (hoy la de correo se guarda plana). |
| **Plantillas de documentos** (cotización/pagaré/contrato) como **HTML** con `{{placeholders}}` | `dashboard/routes/documentos.js` | El contenido a convertir a PDF ya existe como HTML. |
| **Chrome/puppeteer-core** en el contenedor (para el bot) | `bot/index.js:667`, Dockerfile | **Puede generar PDFs** server-side (`page.pdf()`) desde ese HTML — sin dependencia nueva de PDF. |
| **Imágenes en disco** (productos/clientes, WebP + jpg) | `bot/imagenes_productos/`, `imagenes_clientes/` | Adjuntar imágenes = leer el archivo (ya resueltos con `imagenProducto`). |
| **Subida de binarios** (base64-en-JSON, exento del cap) | patrón `restaurar-bd` / `producto-imagen` | Adjuntar archivos que el usuario suba a mano en la redacción. |
| Patrón de **módulo toggleable** | `modulosDefaults.js` + `Modulos.jsx` | `correo_activo` encaja 1:1. |

## 2. Qué NO existe (los huecos reales)

1. **IMAP (leer la bandeja)** — cero. `emailService` solo ENVÍA. No hay `imap`,
   `imapflow` ni `mailparser` en `package.json` (solo `puppeteer-core`). Leer un
   buzón real (FETCH, BODYSTRUCTURE, parseo MIME, UIDs, push por IDLE) es mucho más
   complejo que el SMTP hand-rolled.
2. **Generación de PDF server-side** — cero. Hoy facturas/cotizaciones/reportes se
   **imprimen desde el navegador** (`window.print()` en `lib/reporteImprimible.js`,
   `Documentos.jsx`, `Fiados.jsx`, `Mostrador.jsx`). No hay un archivo PDF que
   adjuntar; hay que producirlo (Chrome puede).
3. **`_smtpSend` no acepta adjuntos todavía** — solo `{to, subject, html}`
   (`emailService.js:67`). El código de adjuntos vive suelto en `backup.js`; hay que
   unificarlo en `emailService.enviarConAdjuntos()`.
4. **UI de correo** — no existe (ni bandeja, ni redactor, ni bandeja de enviados).
5. **Almacenamiento de correos** — no hay tabla `correos`; leer un buzón implica
   cachear en SQLite (los correos son PII, mismo cuidado que los datos de cliente).

## 3. Viabilidad por capacidad

| Capacidad | Viable | Costo | Cómo |
|---|---|---|---|
| Redactar (texto/HTML) + enviar | ✅ | Bajo | `emailService` ya envía HTML. |
| Adjuntar **imágenes** | ✅ | Bajo | Leer archivo de `imagenes_*` → multipart (patrón backup). |
| Adjuntar **reportes** | ✅ | Medio | Generar el reporte (ya existe el HTML) → PDF con Chrome → adjuntar. |
| Adjuntar **cotización/factura PDF** | ✅ | Medio | Render del HTML de `documentos`/ticket → `page.pdf()` → adjuntar. |
| Subir un archivo a mano y adjuntarlo | ✅ | Bajo | base64-en-JSON (patrón `producto-imagen`). |
| Ver **bandeja de entrada** (recibir/leer) | ⚠️ | **Alto** | Requiere IMAP (`imapflow`) + parseo (`mailparser`) + tabla `correos` + poll/IDLE. |
| Responder / reenviar desde la bandeja | ⚠️ | Medio | Depende de la bandeja (P1). |

## 4. Dependencias

- **Para P0 (enviar + adjuntar): ninguna nueva.** SMTP hand-rolled + `puppeteer-core`
  (ya instalado) para el PDF. Cero `npm install`.
- **Para P1 (bandeja de entrada): 2 dependencias recomendadas**:
  - `imapflow` — cliente IMAP moderno, promesas, mantenido. Alternativa a hand-roll
    (que sería ~1000+ líneas frágiles).
  - `mailparser` — parsea el MIME crudo (cuerpo, adjuntos, encoding) a objeto.
  > El proyecto evita `nodemailer` a propósito, PERO leer IMAP a mano no es
  > comparable a SMTP: es un protocolo mucho más grande. Aquí la dependencia se
  > justifica (a diferencia de SMTP, donde hand-roll fue razonable).
  > **Ojo Gmail**: la clave de aplicación funciona con IMAP/SMTP, **no** con la
  > Gmail API (esa exige OAuth). Así que IMAP es la vía correcta para "clave de app".

## 5. Arquitectura propuesta (encaja con el stack)

- **Módulo**: flag `correo_activo` (default OFF) en `modulosDefaults.js` + toggle en
  `Modulos.jsx`. Rutas gateadas (¿`area:'operacion'`? o rol `gerente`/`prime` — la
  bandeja del negocio es sensible; sugerido **gerente+**).
- **Envío (P0)**: `emailService.enviarConAdjuntos({to, subject, html, adjuntos[]})`
  (extrae el multipart de `backup.js`). Endpoint `POST /api/correo/enviar`
  (base64-en-JSON para adjuntos subidos, o referencias a archivos del sistema
  —factura/cotización/reporte/imagen— que el backend genera/lee y adjunta).
- **PDF (P0)**: `services/pdfService.js` con `puppeteer-core` → toma el HTML que hoy
  se imprime en el navegador y hace `page.pdf()`. Reusa `_resolveChromePath()`.
- **Bandeja (P1)**: `services/correoInbox.js` con `imapflow` corriendo en el proceso
  del bot (o un worker), sincroniza por **poll cada N min o IDLE**, guarda en tabla
  `correos(uid, de, para, asunto, fecha, cuerpo, adjuntos_json, leido, ...)` en
  SQLite (dedup por UID). El dashboard **lee de SQLite** (no habla IMAP directo) —
  mismo patrón que todo lo demás (poll → store → panel). UI: página `Correo` con
  bandeja / enviados / redactar (Drawer), no-leídos en el menú (como Mensajes).

## 6. Seguridad y operación (a considerar antes de construir)

- **La clave de aplicación da acceso TOTAL al buzón** (leer + enviar). Es un secreto
  fuerte → **cifrarla en reposo** con `pac.cifrarSecreto()` (hoy `bot_email_password`
  se guarda plana; para inbox eso no alcanza). Nunca devolverla en un GET.
- **Almacenar correos = PII** (posible dato de terceros): la tabla `correos` merece
  el mismo trato que `clientes` (backup, no exponer sin sesión, purga configurable).
- **Toggleable y por rol**: la bandeja del negocio no la debe ver un cajero;
  sugerido gerente+/prime.
- **Límites**: sync IMAP acotado (últimos N días / N correos) para no llenar SQLite;
  tamaño de adjunto (Gmail tope 25 MB); rate del envío (Gmail ~500/día).
- **Multi-instancia**: cada negocio su buzón (su `bot_email_*`), como el resto —
  encaja con instancia-por-tenant, sin cambios.

## 7. Plan por fases

**Fase A — Redacción + envío con adjuntos (P0, sin dependencias nuevas)**
1. `emailService.enviarConAdjuntos()` (unifica el multipart de `backup.js`).
2. `services/pdfService.js` (Chrome → PDF del HTML de ticket/cotización/reporte).
3. Flag `correo_activo` + `POST /api/correo/enviar` (gerente+) + UI "Redactar"
   (para, asunto, cuerpo, adjuntar: imagen de producto / factura / cotización /
   reporte / archivo subido).
4. Cifrar `bot_email_password`. Tests de contrato (arma el MIME, adjunta, no envía
   de verdad).

**Fase B — Bandeja de entrada (P1, requiere `imapflow` + `mailparser`)**
5. `services/correoInbox.js` (IMAP sync → tabla `correos`), migración de la tabla.
6. Enganche de sync (poll en el bot/worker, o IDLE).
7. Página `Correo` (bandeja/enviados/redactar) + no-leídos en el menú + responder/reenviar.

## 8. Esfuerzo y riesgo

| Fase | Esfuerzo | Riesgo |
|---|---|---|
| A (enviar + adjuntar + PDF) | Medio | Bajo — reusa SMTP + Chrome; el PDF por Chrome es lo más "nuevo" pero Chrome ya corre. |
| B (bandeja IMAP) | Alto | Medio — 2 deps nuevas, ciclo de conexión IMAP, parseo MIME, almacenamiento PII, sync robusto. |

## 9. Recomendación

1. **Aprobar Fase A ya** (envío + adjuntos + PDF): alto valor, bajo riesgo, cero deps
   nuevas — cierra "mandar cotizaciones/facturas/reportes por correo con adjunto".
2. **Fase B (bandeja) con `imapflow`+`mailparser`**: aceptar esas 2 dependencias
   (leer IMAP a mano no vale la pena) y tratar el buzón como PII (cifrar credencial,
   gate gerente+, purga). Es la única parte que agrega dependencias y almacenamiento
   sensible — vale hacerla en su propio bloque, con calma, y **después del deploy**.

> **Nada de esto rompe Julio Cepeda ni el modelo actual**: es aditivo, toggleable
> (default OFF), por instancia. La clave de aplicación y el SMTP ya están; lo único
> genuinamente nuevo es el PDF server-side (Chrome, sin dep) y el IMAP (con dep).
