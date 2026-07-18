# Despliegue en Oracle Cloud + Cloudflare Tunnel — paso a paso

Guía completa para dejar el sistema **operativo al 100%** en un servidor **Oracle
Cloud (Ubuntu)**, dentro de su **contenedor Docker**, publicado en su propio
subdominio **`bd.hevcaz.com`** a través de un **túnel de Cloudflare** (sin abrir
puertos a internet).

> **Arquitectura del despliegue:**
> ```
> Navegador ──HTTPS──> Cloudflare ──túnel cifrado──> cloudflared (en el server)
>                                                        │ http://localhost:3001
>                                                        ▼
>                                              contenedor Docker "bothsv"
>                                              (bot WhatsApp + dashboard, pm2)
> ```
> El contenedor **solo** escucha en `127.0.0.1:3001`; nada se expone directo a
> internet. Cloudflare termina el TLS y el túnel entrega el tráfico localmente.

---

## 0. Requisitos previos (una sola vez)

- [ ] Cuenta de **Oracle Cloud** (el *Always Free* alcanza: 1 VM ARM Ampere o 1
      AMD micro). Recomendado: **VM.Standard.A1.Flex, 2 OCPU / 12 GB RAM, Ubuntu 22.04**.
- [ ] Dominio **hevcaz.com** administrado en **Cloudflare** (nameservers de Cloudflare
      activos). Si aún no: agrega el dominio en Cloudflare y cambia los NS en tu registrador.
- [ ] La **base de datos real** (`jugueteria.db`) y el `.env` con los valores reales,
      a la mano (se copian al server).
- [ ] Un número de **WhatsApp** dedicado para el bot (se vincula por QR al final).

---

## 1. Crear la instancia en Oracle Cloud

1. Consola de Oracle Cloud → **Compute → Instances → Create Instance**.
2. **Image & shape:** Ubuntu 22.04, shape `VM.Standard.A1.Flex` (2 OCPU, 12 GB).
3. **Networking:** deja la VCN/subnet por defecto. **NO necesitas abrir puertos de
   entrada** — el túnel de Cloudflare sale del server hacia afuera. (Opcional: deja
   solo el 22/SSH que Oracle abre por defecto.)
4. **SSH keys:** sube tu llave pública (o genera una y guarda la privada).
5. Crea la instancia y anota su **IP pública** (solo para entrar por SSH).

> Seguridad extra (opcional pero recomendado): como Cloudflare Tunnel no requiere
> puertos entrantes, puedes **cerrar TODO** el tráfico entrante salvo SSH en la
> *Security List* de Oracle. El panel nunca queda expuesto por IP.

---

## 2. Entrar por SSH e instalar Docker

```bash
ssh ubuntu@LA_IP_PUBLICA

# Paquetes base + Docker (repo oficial)
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Usar docker sin sudo (cierra y reabre la sesión SSH después)
sudo usermod -aG docker $USER
newgrp docker

docker --version && docker compose version   # verifica
```

---

## 3. Traer el código al server

```bash
cd ~
git clone https://github.com/hevcazDS/CDHV1.git bothsv
cd bothsv
```

(o si el repo es privado, usa un token / SSH deploy key, o `scp` la carpeta desde tu equipo.)

---

## 4. Configurar el `.env` (⚠️ el paso más importante para seguridad)

```bash
cp .env.example .env
nano .env
```

Llena **como mínimo** estos valores (los demás según tu operación):

```ini
# ── Dashboard / seguridad (CRÍTICO para deploy remoto) ──
DASHBOARD_PORT=3001
DASHBOARD_USER=admin
DASHBOARD_PASS=<CONTRASEÑA FUERTE Y ÚNICA>       # NUNCA dejar "cambiar_esto"
DASHBOARD_COOKIE_SECURE=true                     # ya viene forzado en compose, pero déjalo
TRUST_PROXY=1                                    # el túnel de Cloudflare es el proxy → IP real del cliente
DASHBOARD_HOST=0.0.0.0                            # (compose ya lo pone; escucha dentro del contenedor)

# Usuario prime (dueño) — con contraseña fuerte propia
USER_PRIME=<usuario_prime>
USER_PRIME_PASSWORD=<CONTRASEÑA FUERTE DISTINTA>

# ── Bot ──
CHROME_PATH=/usr/bin/chromium                    # (compose lo pone; déjalo)
DB_PATH=/data/jugueteria.db                      # (compose lo pone; déjalo)
ASESOR_WHATSAPP=52xxxxxxxxxx                      # número que recibe escaladas

# ── Soporte del proveedor (widget Hevcaz) ──
SOPORTE_HEVCAZ_WHATSAPP=52xxxxxxxxxx
SOPORTE_HEVCAZ_EMAIL=soporte@hevcaz.com

# ── Email de notificaciones/backup (opcional pero recomendado) ──
EMAIL_HOST=smtp.tu-proveedor.com
EMAIL_PORT=587
EMAIL_USER=...
EMAIL_PASS=...
EMAIL_FROM=...

TZ=America/Monterrey
NODE_ENV=production
```

> **Checklist de seguridad del `.env`:** contraseñas fuertes y **distintas** para
> `DASHBOARD_PASS` y `USER_PRIME_PASSWORD`; `TRUST_PROXY=1` (porque hay proxy delante);
> `DASHBOARD_COOKIE_SECURE=true`. El `.env` **nunca** se sube a git (ya está ignorado).

---

## 5. Colocar la base de datos real

El contenedor lee la BD desde el volumen `./data/jugueteria.db`.

```bash
mkdir -p data
# Sube tu jugueteria.db real a ~/bothsv/data/jugueteria.db (scp desde tu equipo):
#   scp "ruta/local/jugueteria.db" ubuntu@LA_IP:~/bothsv/data/jugueteria.db
```

- **Instancia nueva (sin BD):** omite este paso; el sistema arranca con la BD que
  crea `schema.sql` y verás el **wizard de onboarding** en el primer acceso.
- **Multi-tienda:** copia también `instancias/*.db`; para migrarlas todas ejecuta,
  tras el primer `up`, `docker compose exec app node scripts/migrate.js --all`.

---

## 6. Construir y levantar el contenedor

```bash
docker compose build          # compila la imagen (bot + panel + Chromium + cwebp)
docker compose up -d          # arranca en segundo plano

# Las migraciones corren SOLAS al arrancar (CMD del Dockerfile) → la BD queda al día.
docker compose ps             # debe verse "healthy" tras ~30-60s
docker compose logs -f app    # ver el arranque (Ctrl-C para salir)
```

Verifica salud local:

```bash
curl -s http://127.0.0.1:3001/health    # debe responder 200/OK
```

---

## 7. Publicar en `bd.hevcaz.com` con Cloudflare Tunnel

### 7.1 Instalar cloudflared

```bash
# ARM64 (Ampere A1). Para AMD/x86 usa el paquete amd64.
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

### 7.2 Autenticar y crear el túnel

```bash
cloudflared tunnel login          # abre una URL → autoriza el dominio hevcaz.com en el navegador
cloudflared tunnel create bothsv  # crea el túnel; anota el UUID y la ruta del credentials .json
```

### 7.3 Configurar el enrutamiento

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

Contenido (reemplaza `UUID` y la ruta del `.json` que imprimió el paso anterior):

```yaml
tunnel: UUID-DEL-TUNEL
credentials-file: /home/ubuntu/.cloudflared/UUID-DEL-TUNEL.json

ingress:
  - hostname: bd.hevcaz.com
    service: http://localhost:3001
  - service: http_status:404
```

### 7.4 Crear el DNS y correr como servicio

```bash
# Crea el registro CNAME bd.hevcaz.com → el túnel (en Cloudflare, automático):
cloudflared tunnel route dns bothsv bd.hevcaz.com

# Instalar como servicio systemd (arranca solo al reiniciar el server):
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared     # debe estar "active (running)"
```

### 7.5 Ajustes en el panel de Cloudflare

- **SSL/TLS → Overview:** modo **Full** (el túnel ya cifra; no uses "Flexible").
- **DNS:** confirma que `bd.hevcaz.com` es un CNAME **Proxied (nube naranja)** al túnel.
- (Opcional, más seguridad) **Zero Trust → Access:** protege `bd.hevcaz.com` con una
  Access Policy (OTP por email) para que solo tu equipo llegue siquiera al login.

Abre **https://bd.hevcaz.com** → debe cargar la pantalla de login del panel. ✅

---

## 8. Vincular WhatsApp y dejar el bot operativo

1. Entra a **https://bd.hevcaz.com**, inicia sesión como **prime**.
2. Ve a la sección del **estado del bot / QR** y **escanea el QR** con el WhatsApp
   del negocio (WhatsApp → Dispositivos vinculados → Vincular dispositivo).
3. Espera a que el estado pase a **"conectado"**. La sesión se guarda en el volumen
   `wwebjs_auth` (sobrevive reinicios; no hay que re-escanear cada vez).
4. Si es **instancia nueva**, completa el **wizard de onboarding** (giro, nombre,
   IVA, tono, métodos de pago) — crea el primer usuario prime.

---

## 9. Verificación "operativo al 100%" (checklist)

- [ ] `docker compose ps` → contenedor **healthy**.
- [ ] `curl -s http://127.0.0.1:3001/health` → OK.
- [ ] `sudo systemctl status cloudflared` → active (running).
- [ ] **https://bd.hevcaz.com** carga el login con **candado (HTTPS)** válido.
- [ ] Login con las credenciales prime funciona; un usuario/contraseña incorrecto da 401.
- [ ] Estado del bot = **conectado**; mandar "hola" al número del bot responde el menú.
- [ ] Un pedido/venta de prueba se registra; el corte de caja lo refleja.
- [ ] La cookie de sesión sale con `Secure; HttpOnly; SameSite=Lax` (DevTools → Application → Cookies).

---

## 10. Operación diaria y mantenimiento

**Ver logs:**
```bash
docker compose logs -f app          # bot + dashboard
sudo journalctl -u cloudflared -f   # túnel
```

**Reiniciar / detener:**
```bash
docker compose restart app
docker compose down                 # detener todo (los datos persisten en ./data y volúmenes)
docker compose up -d
```

**Actualizar a una versión nueva del código:**
```bash
cd ~/bothsv
git pull
docker compose build
docker compose up -d                # las migraciones corren solas al arrancar
```

**Respaldos:** el sistema ya envía por correo el respaldo de la BD y de las imágenes
(11:00 / 11:30) si configuraste `EMAIL_*`. Respaldo manual del archivo:
```bash
cp ~/bothsv/data/jugueteria.db ~/backup-jugueteria-$(date +%F).db
```

---

## 11. Solución de problemas

| Síntoma | Causa / arreglo |
|---|---|
| `bd.hevcaz.com` da 502/1033 | El contenedor no está arriba o `config.yml` apunta mal. `docker compose ps` + `curl localhost:3001/health`; revisa el `service:` del ingress. |
| El panel carga pero no inicia sesión | `DASHBOARD_PASS`/prime mal, o el candado por 20 intentos/min por IP (espera 1 min). |
| El bot no conecta / QR no aparece | Revisa `docker compose logs app`; si la sesión se corrompió, borra el volumen `wwebjs_auth` y re-escanea. |
| Las fechas/cortes salen corridos | Falta `TZ=America/Monterrey` (ya está en compose; confírmalo). |
| Cambié el `.env` y no toma efecto | `docker compose up -d` (recrea el contenedor con el env nuevo). |
| Túnel caído tras reiniciar el server | `sudo systemctl enable --now cloudflared`. |
| Sesiones cerradas tras cada deploy | Normal solo si se regeneró `dashboard/.instancia_secret`; ese archivo vive en el código montado, no se borra en un `git pull`. |

---

### Resumen de una línea
`docker compose up -d` levanta el contenedor (solo en 127.0.0.1:3001, con migraciones
automáticas); `cloudflared` lo publica cifrado en **bd.hevcaz.com** sin abrir puertos;
el `.env` con `DASHBOARD_COOKIE_SECURE=true` + `TRUST_PROXY=1` + contraseñas fuertes
cierra la seguridad; se escanea el QR de WhatsApp una vez y queda operativo al 100%.
