# Auditoría: alias de usuario multi-negocio ("Luis/contador")

**Fecha:** 2026-07-18 · **Alcance:** solo lectura de código. No se tocó BD, git ni pm2.
**Pregunta:** ¿puede/debe el sistema soportar un ALIAS de usuario que, al iniciar
sesión, cargue el negocio (instancia) correcto, evitando choques de usuarios
repetidos entre negocios?

---

## Resumen ejecutivo

El modelo es **instancia-por-tenant deliberado**: cada negocio = su propio `.db`,
su propia tabla `usuarios`, su propio proceso, su propio `.instancia_secret`. La
instancia activa es **un puntero GLOBAL por proceso** (`dashboard/.instancia_activa`),
no un dato de la sesión. Consecuencia dura: **el login no puede "elegir negocio"** —
un login siempre entra a la instancia que el puntero apunta en ese momento.

El **alias central "Luis/contador" NO es viable** sin romper el modelo: exige un
directorio central `alias → (instancia, usuario)` y que el login enrute a otra
instancia, pero solo hay **una** instancia viva por proceso. Un alias que enrutara
a otra tienda implicaría reiniciar el proceso (~4 s, tumba a todos los demás
usuarios de la tienda actual) — inaceptable como flujo de login.

**Camino correcto: subdominio-por-negocio (b), un contenedor por negocio.** Encaja
1:1 con instancia-por-tenant y con Cloudflare tunnel. Luis simplemente tiene una
cuenta en cada tienda (`negocioA.dominio` / `negocioB.dominio`) y va a la URL de la
que quiere. El **hub de flota (c) ya existe** (`flota.js` + `InstanciaSwitcher.jsx`)
pero hoy es solo-lectura (pulso del negocio) / prime-mono-proceso; es el gancho
natural para un "veo mis negocios y salto", no un router de identidad.

Recomendación: **no construir alias central.** Usar subdominio-por-negocio +
(opcional) evolucionar el hub de flota a un directorio de accesos por-usuario. El
username namespaced (`luis@negocioX`) solo sirve como **etiqueta visual**, no
resuelve el ruteo.

---

## 1. ¿El mismo username puede existir en 2 instancias? ¿Hay cruce de identidad?

**Sí, el mismo username puede existir en 2 instancias — y es lo esperado.** La
unicidad de username es **por base de datos, no global**:

- `db/schema.sql:69` — `username TEXT NOT NULL UNIQUE`. Ese `UNIQUE` es un índice
  **dentro de un `.db`**. Cada instancia es un `.db` distinto (`instancias/*.db`),
  así que "gerente" en la tienda A y "gerente" en la tienda B son filas de tablas
  diferentes, sin relación. **No hay ningún directorio central de usuarios.**

- `dashboard/server.js:96` — el login hace `SELECT * FROM usuarios WHERE username=?`
  contra `db`, que es **la instancia activa del proceso** (`bot/db_connection.js`
  resolvió `DB_PATH` desde el puntero al arrancar). No hay forma de que el login
  vea usuarios de otra instancia.

**El `.instancia_secret` por instancia SÍ impide sesión cruzada entre negocios:**

- `dashboard/server.js:310-323` — el secreto vive en un archivo local
  `dashboard/.instancia_secret`, **no viaja en la BD ni en backups**.
- `dashboard/server.js:324-326` — cada token de sesión se firma con
  `HMAC-SHA256(token, _INSTANCIA_SECRET)`.
- `dashboard/server.js:342-350` — `obtenerSesion` **verifica la firma antes** de
  buscar la sesión. Una cookie emitida por la tienda A no valida contra el secreto
  de la tienda B (firma distinta) → `return null`.

Conclusión: identidad y sesión están **aisladas por instancia por diseño**. No hay
cruce. El precio es que tampoco hay forma nativa de "reconocer a Luis en las dos".

---

## 2. Contador que atiende varios negocios: ¿un login puede "elegir negocio"?

**No.** La instancia activa es un **puntero global por proceso**, no un parámetro
del login:

- `bot/db_connection.js:11-32` — al arrancar, TODOS los procesos leen
  `dashboard/.instancia_activa` y abren ESA base. Se decide **una vez, en el boot**.
- `dashboard/routes/instancias.js:79-108` (`abrir`) — cambiar de tienda = reescribir
  el puntero + `process.exit(0)` para que pm2 reinicie (~4 s). Es **prime-only** y
  está rate-limited a 1/minuto (`_ultimoCambio`, línea 85). Es "la operación más
  invasiva del panel" (comentario línea 8).
- `dashboard-ui/src/components/InstanciaSwitcher.jsx:24,34` — el switcher es
  **prime-only** y **reinicia el dashboard** ("entrarás con los usuarios de ESA
  tienda"). No es "elegir negocio en el login": es reiniciar el proceso entero.

**Conflictos si Luis intentara usar esto como multi-negocio hoy:**

| Conflicto | Detalle |
|---|---|
| No puede elegir en el login | El login entra a la instancia que el puntero apunta ahora. Luis no controla eso; es prime-only y global. |
| Mismo username, contraseñas distintas | "luis" en tienda A y "luis" en tienda B son filas independientes con hash/salt propios (`server.js:245-249`). Puede tener claves distintas y no saber cuál aplica. |
| No sabe a cuál entró | El único indicador es el `InstanciaSwitcher` (prime) o el nombre del negocio en la UI. Un usuario normal no ve qué tienda está activa. |
| Cambiar tumba a los demás | Si Luis "cambiara de tienda", reinicia el proceso: desconecta a todos los operadores de la tienda que estaba activa. Inviable como flujo cotidiano. |

---

## 3. ¿Es viable el alias "Luis/contador"? ¿Qué rompe?

### (a) Directorio central `alias → (instancia, usuario)` que enrute el login — **CHOCA, no viable**
Requiere que un login pueda terminar en una instancia distinta a la que el proceso
tiene abierta. Pero solo hay **una instancia viva por proceso**
(`bot/db_connection.js:11-32`). Para servir la tienda del alias habría que:
reescribir el puntero + reiniciar (`instancias.js:79-108`) en cada login → rompe a
todos los usuarios de la tienda anterior, y solo un proceso puede estar en una
tienda a la vez. **Contradice frontalmente instancia-por-proceso.** Además exigiría
una BD central de identidad que hoy **no existe** (y cuya ausencia es deliberada:
"deliberadamente no `tenant_id`", CLAUDE.md).

### (b) Subdominio por negocio — **RESPUESTA CORRECTA**
Cada negocio = su URL (`negocioA.dominio`, `negocioB.dominio`) = su contenedor = su
`.db` = su proceso. Encaja **exactamente** con instancia-por-tenant y con Cloudflare
tunnel (un tunnel/ruta por contenedor). Luis tiene una cuenta en cada tienda y va a
la URL de la que quiere trabajar. Sin puntero global, sin reinicio, sin BD central,
sin romper el aislamiento de `.instancia_secret`. Es el modelo que el código ya
asume (cada instancia se auto-contiene). **Recomendado.**

### (c) Hub de flota — **YA EXISTE, es el gancho, no un router de identidad**
- `dashboard/routes/flota.js` — `GET /api/flota/status` con token máquina-a-máquina
  (no sesión). Solo-lectura: pulso del negocio (ventas hoy, bot online, backup,
  errores). Es un **hub PULL** para el panel del proveedor Hevcaz.
- Hoy **no** enruta logins ni conoce usuarios. Es el lugar natural para evolucionar
  a "Luis ve sus negocios y salta" (cada tarjeta → URL de subdominio del negocio),
  combinándose con (b). No sustituye al login por instancia.

### (d) Username namespaced (`luis@negocioX`) — **solo etiqueta**
No cambia el ruteo (el login sigue pegando contra la instancia activa). Sirve como
rótulo humano para que Luis sepa "esta cuenta es la del negocio X". Cosmético.

**Veredicto:** el alias central (a) no es viable sin destruir el modelo. La
respuesta correcta es **(b) subdominio-por-negocio**, opcionalmente con **(c)** como
lanzadera visual. (d) es adorno.

---

## 4. Conflictos de "repetir usuarios": mitigado vs no

| # | Conflicto | Estado | Evidencia |
|---|---|---|---|
| 1 | Username duplicado entre instancias | **No es un bug — es el diseño.** El `UNIQUE` es por-`.db`; instancias distintas conviven sin choque. | `db/schema.sql:69` |
| 2 | Colisión al clonar instancia con usuarios sembrados por env | **Mitigado.** El seeding es `crearUsuarioSiNoExiste` (idempotente, `SELECT id ... return` si existe) y el bloque va en try/catch a nivel módulo para no tumbar el arranque si hay una fila legada duplicada. | `server.js:239-261` |
| 3 | Sesión cruzada entre negocios (cookie de A vale en B) | **Mitigado.** Firma HMAC por `.instancia_secret` local; se verifica antes de resolver la sesión. Cookie de A no valida en B. | `server.js:310-350` |
| 4 | Confusión de negocio (no saber en cuál estás) | **Parcial.** Prime lo ve por `InstanciaSwitcher`; usuario normal solo lo infiere del nombre del negocio en la UI. Sin subdominio (una URL por tienda) es ambiguo. | `InstanciaSwitcher.jsx:24-27` |
| 5 | Un login "elige" negocio | **No existe / no soportado.** Puntero global por proceso; cambiar = reinicio prime-only. | `db_connection.js:11-32`, `instancias.js:79-108` |
| 6 | Contraseñas distintas para "el mismo" Luis en varias tiendas | **No mitigado (inherente al modelo).** Cada tienda tiene su propia fila/hash; no hay identidad compartida. Con subdominio deja de ser confuso (cada URL = una cuenta). | `server.js:245-249` |

---

## Plan mínimo (sin romper instancia-por-tenant)

1. **Adoptar subdominio-por-negocio** como el mecanismo de "elegir negocio":
   un contenedor + un `.db` + una URL por tienda (Cloudflare tunnel una ruta por
   contenedor). Cero cambios al modelo de identidad; es lo que el código ya asume.
   → **Aquí termina lo necesario. Todo lo demás es opcional.**

2. *(opcional)* **Lanzadera en el hub de flota:** que el panel del proveedor liste,
   por cada negocio de un contacto, un botón que abra la URL de subdominio del
   negocio. Reusa `flota.js` (agregar por-negocio la URL pública) + una vista que
   agrupe "los negocios de Luis". No toca login ni sesiones. Añadir cuando haya 3+
   negocios que un mismo humano opere de verdad.

3. *(cosmético)* Mostrar el **nombre del negocio activo** en el header para
   **todos** los roles (hoy el `InstanciaSwitcher` es prime-only), para matar la
   ambigüedad #4 aun antes de subdominios.

**No hacer:** BD central de identidad, alias→instancia, ni login que reescriba el
puntero. Contradicen la decisión deliberada de instancia-por-tenant sin `tenant_id`.
