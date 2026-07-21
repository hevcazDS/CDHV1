# Documentación del sistema — ERP + CRM + Bot de WhatsApp (white-label)

> **Estado documental:** este conjunto de documentos describe el **código real**
> a fecha de 84 migraciones (`migrations/0001`–`0084`). Donde `CLAUDE.md` de la
> raíz contradice al código (está detenido ~65 migraciones atrás, en "Bloque 2B"),
> manda el código; las discrepancias se anotan al final de cada documento.

## Índice maestro

| Documento | Contenido |
|---|---|
| [ARQUITECTURA.md](ARQUITECTURA.md) | Los dos procesos sobre SQLite, sistema de módulos, tronco de rutas, RBAC, migraciones, extensibilidad por giro, motor de flujo, hook LLM. |
| [MODULOS.md](MODULOS.md) | Catálogo exhaustivo de módulos toggleables: clave, qué hacen, default on/off, dependencias, giros, rol administrador. |
| [CONTABILIDAD.md](CONTABILIDAD.md) | Motor contable de partida doble, IVA base-flujo MX, CFDI 4.0 / PAC, DIOT, contabilidad electrónica, nómina, cortes de caja, costeo. |
| [BASE_DE_DATOS.md](BASE_DE_DATOS.md) | Inventario de tablas por dominio (operación, contabilidad, CRM, RRHH, flujo). |
| [API.md](API.md) | Inventario de los ~336 endpoints por módulo de ruta: método, path, área/rol, qué hace. |
| [BOT.md](BOT.md) | Pipeline de mensajes, sesiones/flujos, enum `S` de estados, flujos por giro, motor de flujo visual. |
| [FRONTEND.md](FRONTEND.md) | SPA React/Vite/Mantine: páginas, componentes, navegación por rol, estilo, lazy-loading. |
| [OPERACION.md](OPERACION.md) | Guía por rol (cajero/operador/almacén/compras/RH/contabilidad/gerente/prime): día a día y pantallas. |
| [DESPLIEGUE.md](DESPLIEGUE.md) | Instalación/clonado de una instancia, `.env`, migraciones, respaldos, PM2/Docker, correo tienda vs respaldos. |

## Resumen ejecutivo

### Qué es

Una **base de software de negocio "todo en uno" white-label**: un bot de
WhatsApp que atiende clientes (busca productos, arma carrito, cobra, agenda
citas, abre mesas) **más** un panel de administración web que es un **ERP+CRM
completo** — contabilidad de partida doble, CFDI 4.0 timbrado con PAC real
(Facturapi/Facturama), nómina LFT, DIOT, contabilidad electrónica SAT, almacén
con kardex, compras/proveedores, POS de mostrador, cortes de caja, fiados,
CRM con pipeline, RRHH, un motor de flujo visual (React Flow) y correo.

Nació para **Julio Cepeda Jugueterías** (juguetes, México) y se generalizó a
una **base agnóstica de giro**: cualquier vertical (retail, restaurante,
abarrotes, carnicería, ferretería, servicios, barbería, tatuajes, estética,
uñas, gimnasio, mantenimiento, freelancer, custom) se configura con un
**wizard de onboarding + presets de giro**. El proveedor/integrador es
**Hevcaz Solutions** (marca del widget de soporte, distinta del negocio cliente).

### Para quién

- **Dueño / Prime**: configura el negocio, integraciones (PAC, pasarela), usuarios, motor de flujo.
- **Gerente ("Administrador")**: catálogo, módulos, tono del bot, ofertas, control del bot, reportes.
- **Especialistas** (cajero, operador, almacén, compras, RH, contabilidad, auditor): cada uno entra solo a su área.

Ver [OPERACION.md](OPERACION.md).

### Cómo se despliega — instancia por cliente

**No es multi-tenant compartido.** Cada cliente = **su propia carpeta clonada +
su propia SQLite + su propio número de WhatsApp**. No hay `tenant_id`: "el
negocio" son las filas de la tabla `configuracion` de esa instancia. Corre
igual en un Linux rentado o en un contenedor por cliente. La decisión viene de
seguir sobre `whatsapp-web.js` (cada tenant necesita su propio Chromium/número).

### Stack

| Componente | Tecnología |
|---|---|
| Bot de WhatsApp | Node.js + whatsapp-web.js + Puppeteer |
| Base de datos | SQLite (better-sqlite3, WAL) |
| Visión por computadora | Google Cloud Vision (búsqueda por foto) |
| API del dashboard | `http` nativo de Node, **sin framework** |
| UI del dashboard | React + Vite + Mantine (`dashboard-ui/`), build estático servido por el mismo proceso |
| Escritorio | Electron (`desktop/`) — envuelve la URL del dashboard |
| CFDI / timbrado | PAC real vía HTTP (Facturapi key-only / Facturama) |
| Envíos | Estafeta (simulado; API real "Fase 2") |
| Procesos | pm2 (`ecosystem.config.js`); despliegue objetivo: Docker sobre Ubuntu |

Son **dos procesos** (`bot/index.js` y `dashboard/server.js`) sobre **una
SQLite**. La UI es el único lugar con framework; el backend sigue siendo `http`
nativo. Ver [ARQUITECTURA.md](ARQUITECTURA.md).
