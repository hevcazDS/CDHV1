# Reanudar desarrollo — notas del despliegue en Oracle (jiua.hevcaz.com)

**Estado actual (2026-07-21): el contenedor `bothsv` está APAGADO a propósito**
mientras se mejora el sistema en desarrollo. Todo lo demás quedó intacto y listo:
base de datos, sesión de WhatsApp, túnel de Cloudflare configurado, red docker.

## Cómo reanudar cuando haya cambios nuevos en GitHub

```bash
cd /home/ubuntu/dashboard/CDHV1
git pull                      # trae el código nuevo (hevcazDS/CDHV1, rama main)
docker compose build          # reconstruye la imagen con el código actualizado
docker compose up -d          # levanta el contenedor (las migraciones corren solas)

# Verificar:
docker compose ps                              # debe verse "healthy" en ~30-60s
curl -s http://127.0.0.1:3001/health           # debe responder {"ok":true,...}
curl -s https://jiua.hevcaz.com/health         # confirma que el túnel sigue sirviendo
```

**Lo que SOBREVIVE un `git pull` + rebuild sin tocarse** (vive en volúmenes/archivos
fuera del código, nunca se pierde):
- `data/jugueteria.db` — la base de datos real (904 productos, 5,016 clientes,
  5,772 pedidos al momento de este despliegue).
- Volumen `cdhv1_wwebjs_auth` — **se limpió el 2026-07-21** (la sesión había quedado
  corrupta por los ciclos de LOGOUT durante las pruebas). Está vacío a propósito:
  el próximo `docker compose up -d` va a pedir escanear el QR de nuevo, eso es
  esperado, no un error.
- `.env` — es una copia del `.env` de la máquina de desarrollo. **Ojo**: trae
  `BETA_RESET_CODE` activo y contraseñas débiles (`DASHBOARD_PASS`/
  `USER_PRIME_PASSWORD`, solo minúsculas) — decisión consciente del dueño de
  dejarlas así por ahora; revisar antes de operar con clientes reales de verdad.
  Sí se le agregó `TRUST_PROXY=1` (necesario por el túnel).
- El túnel de Cloudflare (`cloudflared`, servicio systemd, siempre activo aunque
  el contenedor esté apagado — mientras esté apagado, `https://jiua.hevcaz.com`
  responderá error de conexión, es normal).

## Pendiente para cuando se retome (de la sesión del 2026-07-21)

1. ~~Diagnóstico de las desconexiones de WhatsApp~~ **RESUELTO (2026-07-21)**:
   confirmado que la causa era `whatsapp-web.js` 1.34.7 sin parchar (el error
   `{"name":"r"}` al procesar mensajes, el mismo bug de ChaCha). Ya instalado
   desde `erickmourasilva/whatsapp-web.js#fix/wa-web-1043-serialized-compat-pr`
   (fork de un tercero, autorizado explícitamente por el dueño — NO es el
   paquete oficial de npm). Cuando la librería oficial publique >1.34.7 con el
   fix fusionado: regresar `package.json` a la fuente de npm y regenerar el
   lockfile.
2. **Riesgo de baneo de fondo** (aparte del punto 1): este servidor tiene IP de
   datacenter (Oracle Corporation, no residencial), y CDHV1 hace mensajería
   proactiva de marketing (carritos abandonados, ofertas por vencer, clientes
   dormidos) — un patrón de mayor riesgo ante los sistemas antispam de WhatsApp
   que el uso de ChaCha (asistente personal 1 a 1, bajo volumen). Vale la pena
   platicar a mediano plazo: IP dedicada/residencial, reducir volumen de
   mensajería proactiva, o migrar a la API oficial de WhatsApp Business.
3. **Cola de notificaciones**: al momento del despliegue había 500 pendientes
   (`cola_pendiente`) con `alerta_cola: "COLA ALTA"` — revisar en el panel
   (Cola de envíos / Notificaciones) qué son antes de reactivar el bot, sobre
   todo si viene de datos migrados del entorno de desarrollo.
4. La corrección del bug de UI ya aplicada y desplegada (`App.jsx`): el bot ya
   NO bloquea el panel con una pantalla de QR obligatoria — login va directo al
   dashboard; vincular WhatsApp es opcional, vive sin bloquear en Inicio y en
   el widget del header.
5. ~~Revisión de bugs visuales del front~~ **RESUELTO (2026-07-21)**: se
   inspeccionó el panel con capturas reales (Puppeteer contra el propio
   Chromium del contenedor) y se encontraron y corrigieron dos bugs
   confirmados — (a) el "✓" literal en "Nada pendiente — todo fluye solo" se
   veía como un carácter suelto (tofu box) por falta de glifo en la fuente del
   sistema, ahora es el icono `<Check>` de lucide-react; (b) el buscador
   global se veía cortado a "Bu" en viewport de celular porque el resto del
   topbar no le dejaba espacio real, ahora colapsa a un botón de solo icono
   que se expande como overlay al tocarlo. El icono del bot en el header
   (`BotStatusWidget`) se verificó en alta resolución y es un SVG limpio — la
   sospecha inicial de que se veía "como emoji" era solo por la compresión de
   la captura de pantalla original, no un bug real.

## Subdominio y túnel (por si hace falta tocarlos)

- Subdominio: `jiua.hevcaz.com` (registro CNAME en Cloudflare, proxied).
- Túnel: nombre `jiua`, id `08446b7d-72c9-43f3-be49-0bde130a8245`.
- Config: `/etc/cloudflared/config.yml` → `http://localhost:3001`.
- Servicio: `sudo systemctl status|restart cloudflared`.
- Certificado TLS: wildcard `*.hevcaz.com` de Cloudflare — ya cubre este
  subdominio y cualquier otro que se agregue, no hay que gestionar nada nuevo
  ahí (ese wildcard vive en el otro proyecto de este servidor, ChaCha, pero el
  túnel de Cloudflare para CDHV1 no depende de ese certificado en absoluto —
  Cloudflare termina el TLS del lado de su red, no aquí).

## Para volver a arrancar el contenedor sin cambios de código

```bash
cd /home/ubuntu/dashboard/CDHV1
docker compose up -d
```
