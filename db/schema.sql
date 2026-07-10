-- db/schema.sql — esquema canónico de la base de datos (SQLite / better-sqlite3)
--
-- Por qué existe este archivo: el proyecto nunca tuvo un schema.sql consolidado.
-- Cada tabla se creó a mano contra producción a lo largo del tiempo; solo
-- unas pocas (sesiones_bot, palabras_filtro, configuracion, usuarios,
-- bot_status_log, sesiones_dashboard, vision_cache, contadores_caso,
-- ventas_previas) tienen `CREATE TABLE IF NOT EXISTS` en el código — el resto
-- vive únicamente como rastros en migraciones_pendientes/*.sql y en el uso
-- real de columnas vía db.prepare(...). Este archivo reconstruye TODAS las
-- tablas que el código espera, para que un instalador pueda generar una base
-- de datos nueva desde cero sin depender de una copia de producción.
--
-- Uso: sqlite3 ruta/al/nuevo.db < db/schema.sql
-- (o ábrelo con better-sqlite3 y ejecuta db.exec(fs.readFileSync(...)) — ver
-- scripts/instalarBaseDeDatos.js)
--
-- Reglas de este archivo:
--   - Todo CREATE TABLE usa IF NOT EXISTS — correr este script dos veces
--     sobre la misma BD nunca debe fallar ni duplicar nada.
--   - El orden de las tablas respeta dependencias de FOREIGN KEY (la tabla
--     referenciada se crea antes que la que la referencia), porque
--     bot/db_connection.js corre `PRAGMA foreign_keys = ON`.
--   - Las columnas que en el código fueron agregadas después vía
--     migraciones_pendientes/*.sql (ALTER TABLE ... ADD COLUMN) ya vienen
--     incluidas aquí directamente en el CREATE TABLE — un install nuevo no
--     necesita correr esas migraciones, solo las BDs viejas que ya existían
--     antes de que se agregara la columna.
--   - Las tablas que el código crea él mismo en tiempo de ejecución
--     (sesiones_bot, palabras_filtro, configuracion, usuarios,
--     bot_status_log, sesiones_dashboard, vision_cache, contadores_caso,
--     ventas_previas) se repiten aquí con la MISMA definición exacta que en
--     el código, para que el instalador deje la BD completa de una sola vez
--     sin tener que levantar el bot/dashboard primero.

PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────────────────
-- Configuración / catálogo del propio sistema (sin dependencias)
-- ──────────────────────────────────────────────────────────────────────────

-- "Personalidad" del negocio (nombre, tono, flags de módulo) — la lee
-- bot/flows/_config.js (cache 60s) y dashboard/server.js. Una fila por
-- `clave` (nombre_negocio, tono_bot, puntos_activo, vision_activo,
-- costo_envio_default, etc.). El instalador llena nombre_negocio/tono_bot
-- una vez al hacer el setup inicial de cada cliente.
CREATE TABLE IF NOT EXISTS configuracion (
    clave         TEXT PRIMARY KEY,
    valor         TEXT NOT NULL DEFAULT '1',
    descripcion   TEXT,
    actualizado_en TEXT DEFAULT (datetime('now','localtime'))
);

-- Lleva el registro de qué archivos de migrations/*.sql ya se aplicaron a
-- esta base (ver scripts/migrate.js, Fase JIUA 8). Una instalación nueva
-- creada desde este schema.sql ya tiene todo integrado, así que nunca
-- necesita correr migrate.js para ponerse al día — pero la tabla se declara
-- aquí también para que su existencia no dependa de haberlo corrido nunca.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version       TEXT PRIMARY KEY,
    aplicado_en   TEXT DEFAULT (datetime('now','localtime'))
);

-- Usuarios del dashboard. rol='prime' es el único que puede tocar
-- inventario/sucursales/altas de producto (ver sección POS más abajo) y los
-- demás endpoints /api/prime/*. Sembrada al boot desde DASHBOARD_USER/
-- DASHBOARD_PASS y USER_PRIME/USER_PRIME_PASSWORD (ver dashboard/server.js).
CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    nombre        TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    rol           TEXT NOT NULL CHECK(rol IN ('cajero','operador','almacen','compras','rh','contabilidad','auditor','usuario','gerente','admin','prime')),  -- migrations/0017 y 0023
    creado_en     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sesiones_dashboard (
    token    TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    rol      TEXT NOT NULL,
    expira   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_status_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    estatus       TEXT NOT NULL,
    motivo        TEXT,
    registrado_en TEXT DEFAULT (datetime('now','localtime'))
);

-- Sesión conversacional de cada usuario de WhatsApp (estado del flujo del
-- bot). Ver bot/sessionManager.js — cache en memoria con TTL 30min respaldado
-- por esta tabla.
-- `version` (migrations/0010_sesiones_bot_version.sql) -- getSession() la usa
-- para detectar escrituras cross-proceso (dashboard escribiendo directo a
-- esta tabla, ver bot/sessionManager.js) sin esperar el TTL de 30 min del
-- cache en memoria.
CREATE TABLE IF NOT EXISTS sesiones_bot (
    id_usuario  TEXT PRIMARY KEY,
    paso_actual TEXT NOT NULL DEFAULT 'MENU',
    data_json   TEXT NOT NULL DEFAULT '{}',
    version     INTEGER NOT NULL DEFAULT 0
);

-- Lista negra de contenido + frases de queja editables desde el dashboard
-- (capa sobre las listas BASE de bot/filtroPalabras.js, que nunca se tocan).
CREATE TABLE IF NOT EXISTS palabras_filtro (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria  TEXT NOT NULL CHECK(categoria IN ('bw_word','bw_long','risk','queja_l1','queja_l2')),
    palabra    TEXT NOT NULL,
    puntos     INTEGER,
    origen     TEXT NOT NULL DEFAULT 'dashboard' CHECK(origen IN ('codigo_fuente','dashboard')),
    activo     INTEGER NOT NULL DEFAULT 1,
    creado_por TEXT,
    creado_en  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_palabras_filtro_unica ON palabras_filtro(categoria, palabra);

-- Cache de resultados de Google Cloud Vision por hash de imagen (TTL 7 días,
-- ver bot/imageAnalyzer.js).
CREATE TABLE IF NOT EXISTS vision_cache (
    hash        TEXT PRIMARY KEY,
    labels_json TEXT NOT NULL,
    query_text  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    hits        INTEGER NOT NULL DEFAULT 1
);

-- Una fila por foto de cliente realmente guardada (vision_cache es caché por
-- contenido, no por ocurrencia) — enlaza el archivo en bot/imagenes_clientes/
-- con el hash de Vision que le tocó, para revisión humana de la etiqueta
-- desde el dashboard (ver migrations/0003_vision_revisiones.sql).
CREATE TABLE IF NOT EXISTS vision_revisiones (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    archivo_imagen      TEXT NOT NULL,
    hash_vision         TEXT NOT NULL,
    telefono            TEXT,
    estado              TEXT NOT NULL DEFAULT 'pendiente',
    etiqueta_corregida  TEXT,
    registrado_en       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    revisado_en         TEXT
);
CREATE INDEX IF NOT EXISTS idx_vision_revisiones_estado ON vision_revisiones(estado);

-- Secuenciador diario de números de caso (CASO-YYYYMMDD-NNN) para escaladas.
CREATE TABLE IF NOT EXISTS contadores_caso (
    fecha    TEXT PRIMARY KEY,
    ultimo_n INTEGER NOT NULL DEFAULT 0
);

-- Secuenciadores de folio por tipo de documento (PED-, ESP-, etc.) — usado
-- por bot/flows/_shared.js, services/estafetaService.js, services/stockService.js.
CREATE TABLE IF NOT EXISTS series_folios (
    tipo        TEXT PRIMARY KEY,
    prefijo     TEXT,
    ultimo_folio INTEGER NOT NULL DEFAULT 0,
    longitud    INTEGER NOT NULL DEFAULT 6
);

-- Catálogo de categorías de producto (lookup, referenciado por nombre desde
-- productos.cat y por id desde productos.id_categoria/promociones.id_categoria).
-- Estuvo sin ningún código que la leyera/escribiera hasta que
-- dashboard/routes/primeCatalogo.js la conectó (selector "crear categoría
-- nueva" en Alta de producto).
CREATE TABLE IF NOT EXISTS categorias (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT NOT NULL UNIQUE,
    descripcion TEXT,
    activa      INTEGER NOT NULL DEFAULT 1,
    creada_en   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Zonas de cobertura de envío -- bot/flows/_shared.js's buscarCobertura()
-- hace match por prefijo de código postal (cp.startsWith(primeros 2
-- dígitos del CP del cliente)) para decidir si hay pickup en sucursal o
-- solo envío a domicilio. Esta tabla estaba mucho más angosta aquí que en
-- la base real (mismo patrón de drift que productos/categorias, ver
-- advertencia general al inicio de este archivo) -- en producción `cp` es
-- el PK real (no `id`, que existe pero siempre queda NULL) y además trae
-- `capital`/`ciudad` (URL de Maps) y `tiene_pickup`. Columnas mirroreadas
-- 1:1 desde PRAGMA table_info() de la base real (2026-06-22).
CREATE TABLE IF NOT EXISTS cobertura (
    cp           TEXT PRIMARY KEY,
    estado       TEXT NOT NULL,
    capital      TEXT NOT NULL,
    ciudad       TEXT,
    activa       INTEGER NOT NULL DEFAULT 1,
    tiene_pickup INTEGER NOT NULL DEFAULT 0,
    id           INTEGER
);

-- Puntos de recolección / sucursales para pickup (bot/flows/orderFlow.js).
-- No confundir con la tabla `sucursales` de la sección POS más abajo: esta
-- es la lista pública de "dónde puedes recoger tu pedido"; `sucursales` es
-- el catálogo interno de inventario. Se mantienen separadas para no romper
-- el flujo de pickup existente al introducir el módulo de inventario.
CREATE TABLE IF NOT EXISTS puntos_entrega (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    estado   TEXT,
    ciudad   TEXT,
    telefono TEXT,
    horario  TEXT,
    activo   INTEGER NOT NULL DEFAULT 1
);

-- ──────────────────────────────────────────────────────────────────────────
-- Clientes y catálogo de productos
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clientes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre            TEXT,
    telefono          TEXT,
    email             TEXT,
    canal_origen      TEXT,
    activo            INTEGER NOT NULL DEFAULT 1,
    creado_en         TEXT DEFAULT (datetime('now','localtime')),
    ultima_actividad  TEXT,
    tags              TEXT,
    -- columnas de perfil/ML agregadas por migraciones_pendientes/0019:
    edad_pref         TEXT,
    genero_pref       TEXT,
    tipo_pref         TEXT,
    presupuesto_pref  TEXT,
    lead_score        INTEGER DEFAULT 0,
    -- programa de referidos: código propio del cliente (5 caracteres
    -- alfanuméricos sin prefijo, ver bot/handlers/referidosService.js),
    -- quién lo refirió (si aplica), y si ya usó su 10% de bienvenida como
    -- referido (un solo uso, ver migrations/0012_referidos_descuento_usado.sql).
    codigo_referido   TEXT,
    referido_por_id   INTEGER REFERENCES clientes(id),
    descuento_referido_usado INTEGER NOT NULL DEFAULT 0,
    -- opt-out de marketing (comando BAJA, migración 0020): 1 = no enviarle
    -- promociones; los mensajes transaccionales no se ven afectados.
    marketing_opt_out INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefono ON clientes(telefono);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_codigo_referido ON clientes(codigo_referido);

-- Esta tabla había quedado mucho más angosta aquí que en la base de
-- producción real (drift -- ver advertencia general al inicio de este
-- archivo): faltaban sku/upc/brand/material/color/dimensiones/edad_max/
-- tipo_juguete/target_audience/id_categoria/stock_exhibicion y las otras 3
-- columnas de stock por sucursal legacy, todas usadas ahora por
-- dashboard/routes/primeCatalogo.js (alta de producto) y/o leídas por
-- bot/flows/_shared.js. Columnas y defaults mirroreados 1:1 desde
-- PRAGMA table_info() de la base real (2026-06-22), con un único cambio
-- intencional: `cat` aquí sí lleva DEFAULT '' (en producción es NOT NULL
-- sin default, lo que ya causó un error real al dar de alta sin categoría;
-- ver migrations/ -- este es el patrón correcto a seguir de aquí en
-- adelante, no el que ya existe en producción).
CREATE TABLE IF NOT EXISTS productos (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                    TEXT NOT NULL DEFAULT 'fisico',  -- migrations/0023: fisico|consumible|servicio
    sku                     TEXT,
    upc                     TEXT,
    brand                   TEXT,
    handle                  TEXT,
    name                    TEXT NOT NULL,
    cat                     TEXT NOT NULL DEFAULT '',
    price                   REAL NOT NULL DEFAULT 0,
    costo                   REAL,                       -- migrations/0016 (costo de adquisición, para margen)
    url_imagen              TEXT,
    description             TEXT,
    seo_description         TEXT,
    tags                    TEXT,
    material                TEXT,
    color                   TEXT,
    edad_recomendada        TEXT,
    target_audience         TEXT,
    stock_base              INTEGER,
    stock_cedis             INTEGER DEFAULT 0,
    stock_tienda            INTEGER DEFAULT 0,
    stock_exhibicion        INTEGER DEFAULT 0,
    stock_san_luis_potosi   INTEGER DEFAULT 0,
    -- stock_queretaro/monterrey/cdmx_centro existen en la base real pero
    -- ningún código (bot ni dashboard) los lee todavía -- se mirrorean para
    -- no perder la columna en una instalación nueva, no porque ya alimenten
    -- algo. Si en el futuro se conectan a busqueda/recomendación, avisar en
    -- este comentario que dejó de aplicar.
    stock_queretaro         INTEGER DEFAULT 0,
    stock_monterrey         INTEGER DEFAULT 0,
    stock_cdmx_centro       INTEGER DEFAULT 0,
    activo                  INTEGER NOT NULL DEFAULT 1,
    peso_kg                 REAL DEFAULT 0,
    alto_cm                 REAL DEFAULT 0,
    ancho_cm                REAL DEFAULT 0,
    largo_cm                REAL DEFAULT 0,
    id_categoria            INTEGER REFERENCES categorias(id),
    genero                  TEXT,
    ventas_simuladas        INTEGER DEFAULT 0,
    edad_min                INTEGER DEFAULT 0,
    edad_max                INTEGER DEFAULT 99,
    tipo_juguete            TEXT DEFAULT 'diversion',
    -- Quién/cuándo se dio de alta (migrations/0006_auditoria_productos_inventario.sql).
    creado_por              TEXT,
    creado_en               TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS productos_similares (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto  INTEGER NOT NULL REFERENCES productos(id),
    id_sustituto INTEGER NOT NULL REFERENCES productos(id),
    activa       INTEGER NOT NULL DEFAULT 1
);

-- Stock por producto y sucursal "legacy" (texto libre en `sucursal`, p.ej.
-- 'san_luis_potosi', 'cedis') — distinta de la tabla `sucursales` normalizada
-- del módulo de inventario; se deja intacta para no romper services/stockService.js.
CREATE TABLE IF NOT EXISTS inventarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto   INTEGER NOT NULL REFERENCES productos(id),
    sucursal      TEXT NOT NULL,
    stock         INTEGER NOT NULL DEFAULT 0,
    -- Leído por services/stockWatcher.js:checkStockMinimo() (alerta "Stock
    -- mínimo"); en 0 esa alerta nunca dispara (mismo comportamiento que
    -- tenía hoy mientras la columna no existía, pero sin tronar la consulta
    -- SQL). Sin UI en el dashboard todavía para editarlo — Fase JIUA 2.
    stock_minimo  INTEGER NOT NULL DEFAULT 0
);

-- Ledger de auditoría de catálogo/inventario (inspirado en StockItemTracking
-- de InvenTree) — historial de cada alta de producto y ajuste de stock,
-- consumido por dashboard/routes/primeCatalogo.js. Sin FK a productos/
-- inventarios a propósito: un registro de auditoría no debe poder
-- desaparecer ni romperse si el producto se borra después (mismo patrón ya
-- usado por cola_emails/logs_error, que tampoco dependen de que la fila
-- referenciada siga existiendo). Ver migrations/0006_auditoria_productos_inventario.sql.
CREATE TABLE IF NOT EXISTS inventario_movimientos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto       INTEGER NOT NULL,
    sucursal          TEXT NOT NULL,
    tipo              TEXT NOT NULL,  -- ledger descriptivo: venta/entrada/salida/traslado_*/ajuste_conteo/reversa/devolucion/alta/ajuste_* (CHECK removido en 0024)
    cantidad_anterior INTEGER,
    cantidad_nueva    INTEGER,
    motivo            TEXT,
    creado_por        TEXT,
    creado_en         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_producto ON inventario_movimientos(id_producto, sucursal);

-- ──────────────────────────────────────────────────────────────────────────
-- Pedidos y todo lo que cuelga de un pedido
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pedidos (
    id_pedido       INTEGER PRIMARY KEY AUTOINCREMENT,
    folio           TEXT,
    cliente         TEXT,
    id_cliente      INTEGER REFERENCES clientes(id),
    id_producto     INTEGER REFERENCES productos(id),
    cantidad        INTEGER,
    ciudad_envio    TEXT,
    cp              TEXT,                         -- migraciones_pendientes/0018
    estatus         TEXT NOT NULL DEFAULT 'generado',
    subtotal        REAL,
    descuento       REAL DEFAULT 0,
    total           REAL,
    canal_creacion  TEXT NOT NULL DEFAULT 'bot',   -- migraciones_pendientes/0010
    email_notificado INTEGER DEFAULT 0,
    tono_bot        TEXT,                          -- migrations/0001_agregar_tono_bot.sql
    razon_social    TEXT,                          -- migrations/0011_pedidos_facturacion.sql
    rfc             TEXT,                          -- migrations/0011_pedidos_facturacion.sql
    puntos_acreditados INTEGER NOT NULL DEFAULT 0,  -- migrations/0013_pedidos_puntos_acreditados.sql
    metodo_pago     TEXT,                          -- migrations/0014_negocio_giro_metodo_pago.sql
    metodo_entrega  TEXT,                          -- migrations/0015 ('pickup'|'paqueteria'|'repartidor')
    cobrado_por     TEXT,                          -- migrations/0023: quién cobró (corte por usuario)
    repartidor_nombre   TEXT,                      -- migrations/0015 (dato del pedido, NO un usuario)
    repartidor_telefono TEXT,                      -- migrations/0015
    a_credito       INTEGER DEFAULT 0,             -- migrations/0036 (venta a crédito/fiado)
    creado_en       TEXT DEFAULT (datetime('now','localtime')),
    actualizado_en  TEXT
);

-- Repartidores frecuentes para reusar al asignar (no son cuentas de acceso).
CREATE TABLE IF NOT EXISTS repartidores (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre    TEXT NOT NULL,
    telefono  TEXT,
    activo    INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now','localtime'))
);

-- migrations/0002_indices_estabilidad.sql
CREATE INDEX IF NOT EXISTS idx_pedidos_estatus ON pedidos(estatus);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha   ON pedidos(date(creado_en));

-- Auto-rellena tono_bot desde la configuración activa al momento del INSERT,
-- sin tener que tocar cada sitio del código que crea un pedido (ver
-- migrations/0001_agregar_tono_bot.sql).
CREATE TRIGGER IF NOT EXISTS trg_pedidos_tono_bot
AFTER INSERT ON pedidos
WHEN NEW.tono_bot IS NULL
BEGIN
    UPDATE pedidos SET tono_bot = (SELECT valor FROM configuracion WHERE clave = 'tono_bot')
    WHERE id_pedido = NEW.id_pedido;
END;

CREATE TABLE IF NOT EXISTS pedido_detalle (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    id_pedido       INTEGER NOT NULL REFERENCES pedidos(id_pedido),
    id_producto     INTEGER NOT NULL REFERENCES productos(id),
    cantidad        INTEGER NOT NULL,
    precio_unitario REAL NOT NULL,
    subtotal_linea  REAL,
    id_variante     INTEGER,
    variante        TEXT,
    sucursal_origen TEXT
);

CREATE TABLE IF NOT EXISTS direcciones_envio (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente  INTEGER REFERENCES clientes(id),
    alias       TEXT,
    calle       TEXT,
    colonia     TEXT,
    ciudad      TEXT,
    estado      TEXT,
    cp          TEXT,
    referencia  TEXT,
    es_default  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reservas_pickup (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_pedido     INTEGER NOT NULL REFERENCES pedidos(id_pedido),
    id_punto      INTEGER REFERENCES puntos_entrega(id),
    estatus       TEXT NOT NULL DEFAULT 'apartado',
    fecha_limite  TEXT,
    codigo_retiro TEXT
);

CREATE TABLE IF NOT EXISTS envios (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    id_pedido               INTEGER NOT NULL REFERENCES pedidos(id_pedido),
    id_paqueteria           INTEGER NOT NULL DEFAULT 1,
    numero_guia             TEXT,
    url_rastreo             TEXT,
    costo_envio             REAL,
    fecha_envio             TEXT,
    fecha_entrega_estimada  TEXT,
    estatus                 TEXT NOT NULL DEFAULT 'guia_generada'
);

CREATE TABLE IF NOT EXISTS estatus_envio_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_envio      INTEGER NOT NULL REFERENCES envios(id),
    estatus       TEXT NOT NULL,
    descripcion   TEXT,
    ubicacion     TEXT,
    registrado_en TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS guias_estafeta (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    id_envio            INTEGER REFERENCES envios(id),
    id_pedido           INTEGER REFERENCES pedidos(id_pedido),
    numero_guia         TEXT,
    folio_interno       TEXT,
    dest_nombre         TEXT,
    dest_calle          TEXT,
    dest_colonia        TEXT,
    dest_ciudad         TEXT,
    dest_estado         TEXT,
    dest_cp             TEXT,
    dest_telefono       TEXT,
    peso_kg             REAL,
    alto_cm             REAL,
    ancho_cm            REAL,
    largo_cm            REAL,
    contenido           TEXT,
    valor_declarado     REAL,
    estatus             TEXT NOT NULL DEFAULT 'generada',
    fecha_envio_est     TEXT,
    fecha_entrega_est   TEXT,
    fecha_entrega_real  TEXT,
    estatus_entrega     TEXT,
    es_simulada         INTEGER NOT NULL DEFAULT 1,
    creada_en           TEXT DEFAULT (datetime('now','localtime'))
);

-- Catálogo de métodos de pago (migrations/0014). Existía en producción pero
-- no estaba en este schema.sql (drift). requiere_link=1 → genera link de pago
-- (paypal/mercadopago); 0 → efectivo/transferencia/oxxo (sin pasarela).
-- `configuracion` (JSON) guarda datos como la CLABE para transferencia.
CREATE TABLE IF NOT EXISTS metodos_pago (
    id            INTEGER PRIMARY KEY,
    nombre        TEXT,
    activo        INTEGER NOT NULL DEFAULT 1,
    requiere_link INTEGER NOT NULL DEFAULT 0,
    configuracion TEXT
);
-- Corte de caja del POS de mostrador (migrations/0018_cortes_caja.sql)
CREATE TABLE IF NOT EXISTS cortes_caja (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha            TEXT NOT NULL,
    usuario          TEXT,
    total_sistema    REAL NOT NULL DEFAULT 0,
    efectivo_sistema REAL NOT NULL DEFAULT 0,
    efectivo_contado REAL,
    diferencia       REAL,
    detalle_json     TEXT,
    creado_en        TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO metodos_pago (id, nombre, activo, requiere_link) VALUES
    (1, 'efectivo',      1, 0),
    (2, 'transferencia', 1, 0),
    (3, 'tarjeta',       1, 0),
    (4, 'paypal',        1, 1),
    (5, 'mercadopago',   1, 1),
    (6, 'oxxo',          1, 0);

CREATE TABLE IF NOT EXISTS links_pago (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    id_pedido        INTEGER NOT NULL REFERENCES pedidos(id_pedido),
    id_metodo        INTEGER,
    url_link         TEXT,
    token_externo    TEXT,
    monto            REAL,
    moneda           TEXT DEFAULT 'MXN',
    estatus          TEXT NOT NULL DEFAULT 'generado',
    fecha_expiracion TEXT,
    referencia_pago  TEXT,                          -- migraciones_pendientes/0012
    pagado_en        TEXT,
    creado_en        TEXT DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────────────────────
-- Lista de espera / preventa / alertas de reabasto
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lista_espera (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente          INTEGER REFERENCES clientes(id),
    id_producto         INTEGER NOT NULL REFERENCES productos(id),
    telefono            TEXT,
    nombre_cliente      TEXT,
    cantidad            INTEGER DEFAULT 1,
    precio_al_registrar REAL,
    estatus             TEXT NOT NULL DEFAULT 'activa',
    canal               TEXT DEFAULT 'whatsapp',
    notas               TEXT,
    folio_lista_espera  TEXT,
    creada_en           TEXT DEFAULT (datetime('now','localtime')),
    notificado_en       TEXT
);

CREATE TABLE IF NOT EXISTS preventas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto         INTEGER REFERENCES productos(id),
    nombre_preventa     TEXT,
    cantidad            INTEGER,
    fecha_llegada_est   TEXT,
    fecha_llegada_real  TEXT,
    stock_comprometido  INTEGER DEFAULT 0,
    activa              INTEGER NOT NULL DEFAULT 1,
    creada_en           TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS preventa_clientes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    id_preventa         INTEGER NOT NULL REFERENCES preventas(id),
    id_cliente          INTEGER REFERENCES clientes(id),
    telefono            TEXT,
    cantidad            INTEGER DEFAULT 1,
    notificado_llegada  INTEGER DEFAULT 0,
    creada_en           TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS alertas_reabasto (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente  INTEGER REFERENCES clientes(id),
    id_producto INTEGER NOT NULL REFERENCES productos(id),
    telefono    TEXT,
    estatus     TEXT NOT NULL DEFAULT 'activa',
    creada_en   TEXT DEFAULT (datetime('now','localtime'))
);

-- chats iniciados por día (migración 0021): un cliente que escribió ese día
CREATE TABLE IF NOT EXISTS chats_iniciados (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono  TEXT NOT NULL,
    fecha     TEXT NOT NULL,
    creado_en TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(telefono, fecha)
);
CREATE INDEX IF NOT EXISTS idx_chats_iniciados_fecha ON chats_iniciados(fecha);

CREATE TABLE IF NOT EXISTS carritos_abandonados (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono     TEXT NOT NULL,
    carrito_json TEXT NOT NULL,
    ultimo_paso  TEXT,
    motivo       TEXT,                              -- migraciones_pendientes/0021
    notificado   INTEGER DEFAULT 0,
    notificado_en TEXT,
    convertido   INTEGER DEFAULT 0,
    creada_en    TEXT DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────────────────────
-- Hilo de conversación (la base de datos de entrenamiento futura)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversaciones (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente   INTEGER REFERENCES clientes(id),
    telefono     TEXT NOT NULL,
    canal        TEXT NOT NULL DEFAULT 'whatsapp',
    estatus      TEXT NOT NULL DEFAULT 'activa',
    id_pedido    INTEGER REFERENCES pedidos(id_pedido),
    ultimo_paso  TEXT,                               -- migraciones_pendientes/0008
    outcome      TEXT,                                -- 'venta'|'escalacion'|'queja'|'abandono' (services/mensajeService.js)
    iniciada_en  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS mensajes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    id_conversacion INTEGER NOT NULL REFERENCES conversaciones(id),
    rol             TEXT NOT NULL CHECK(rol IN ('cliente','bot','asesor')),
    contenido       TEXT NOT NULL,
    paso_actual     TEXT,                          -- migrations/0019 (contexto de flujo)
    intencion       TEXT,                          -- migrations/0019 (clasificada por el LLM)
    enviado_en      TEXT DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────────────────────
-- Colas de notificación / atención humana
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cola_notificaciones (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                TEXT NOT NULL,
    destinatario        TEXT NOT NULL,
    asunto              TEXT,
    cuerpo              TEXT,
    id_pedido           INTEGER REFERENCES pedidos(id_pedido),
    estatus             TEXT NOT NULL DEFAULT 'pendiente',
    intentos            INTEGER NOT NULL DEFAULT 0,
    enviar_despues_de   TEXT,
    campana             TEXT,                          -- migraciones_pendientes/0020
    creada_en           TEXT DEFAULT (datetime('now','localtime')),
    enviado_en          TEXT
);

-- migrations/0002_indices_estabilidad.sql
CREATE INDEX IF NOT EXISTS idx_cola_notif_estatus_tipo ON cola_notificaciones(estatus, tipo);
CREATE INDEX IF NOT EXISTS idx_cola_notif_fecha         ON cola_notificaciones(date(creada_en));

CREATE TABLE IF NOT EXISTS cola_emails (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    id_pedido       INTEGER REFERENCES pedidos(id_pedido),
    destinatarios   TEXT NOT NULL,
    asunto          TEXT,
    cuerpo_html     TEXT,
    tipo            TEXT,
    estatus         TEXT NOT NULL DEFAULT 'pendiente',
    intentos        INTEGER NOT NULL DEFAULT 0,
    creada_en       TEXT DEFAULT (datetime('now','localtime')),
    actualizado_en  TEXT,
    enviado_en      TEXT
);

-- migrations/0002_indices_estabilidad.sql
CREATE INDEX IF NOT EXISTS idx_cola_emails_estatus ON cola_emails(estatus);
CREATE INDEX IF NOT EXISTS idx_cola_emails_fecha    ON cola_emails(date(creada_en));

CREATE TABLE IF NOT EXISTS cola_atencion (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    id_conversacion INTEGER REFERENCES conversaciones(id),
    id_cliente      INTEGER REFERENCES clientes(id),
    motivo_escalada TEXT,
    tipo            TEXT NOT NULL DEFAULT 'otro',       -- migraciones_pendientes/0016
    caso            TEXT,                                -- migraciones_pendientes/0016
    prioridad       INTEGER NOT NULL DEFAULT 1,
    estatus         TEXT NOT NULL DEFAULT 'en_espera',
    creada_en       TEXT DEFAULT (datetime('now','localtime')),
    atendida_en     TEXT,
    resuelta_en     TEXT,
    reescalada_en   TEXT  -- timeout sin respuesta del asesor (services/stockWatcher.js checkQuejasSinRespuesta) ya re-notificó; evita re-notificar más de una vez por caso
);

CREATE TABLE IF NOT EXISTS devoluciones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    id_pedido       INTEGER NOT NULL REFERENCES pedidos(id_pedido),
    id_producto     INTEGER REFERENCES productos(id),   -- migraciones_pendientes/0014
    cantidad        INTEGER,                              -- migraciones_pendientes/0014
    motivo          TEXT,
    canal           TEXT,
    estatus         TEXT NOT NULL DEFAULT 'solicitada',
    notas           TEXT,
    creada_en       TEXT DEFAULT (datetime('now','localtime')),
    actualizado_en  TEXT
);

CREATE TABLE IF NOT EXISTS valoraciones (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_pedido     INTEGER REFERENCES pedidos(id_pedido),
    id_cliente    INTEGER REFERENCES clientes(id),
    calificacion  INTEGER,
    comentario    TEXT,
    canal         TEXT,
    creada_en     TEXT DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────────────────────
-- Analítica / log de eventos (insumo para entrenar un modelo más adelante)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS log_eventos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo_evento   TEXT NOT NULL,
    canal         TEXT,
    valor         TEXT,
    telefono      TEXT,                                  -- migraciones_pendientes/0017
    resultados    INTEGER,                                -- migraciones_pendientes/0017
    compro        INTEGER DEFAULT 0,                       -- migraciones_pendientes/0022
    tono_bot      TEXT,                                     -- migrations/0001_agregar_tono_bot.sql
    registrado_en TEXT DEFAULT (datetime('now','localtime'))
);

-- Auto-rellena tono_bot desde la configuración activa al momento del INSERT
-- (ver migrations/0001_agregar_tono_bot.sql) — mismo patrón que pedidos.
CREATE TRIGGER IF NOT EXISTS trg_log_eventos_tono_bot
AFTER INSERT ON log_eventos
WHEN NEW.tono_bot IS NULL
BEGIN
    UPDATE log_eventos SET tono_bot = (SELECT valor FROM configuracion WHERE clave = 'tono_bot')
    WHERE id = NEW.id;
END;

-- Fallos persistidos a SQL (validaciones Zod rechazadas, inserciones de
-- colas que fallan, etc.) — complementa bot/logs/*.log para que se puedan
-- listar desde el dashboard (ver migrations/0004_logs_error.sql).
CREATE TABLE IF NOT EXISTS logs_error (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    proceso       TEXT NOT NULL,
    motivo        TEXT NOT NULL,
    contexto_json TEXT,
    registrado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_error_fecha ON logs_error(date(registrado_en));

-- Métricas agregadas del bot (panel "Métricas"). Solo verificada por
-- tests/test_db_flujo.js como tabla existente; el código actual no le
-- escribe directamente (las métricas se calculan on-the-fly desde pedidos/
-- log_eventos), se deja como tabla de agregados pre-calculados a futuro.
CREATE TABLE IF NOT EXISTS metricas_bot (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha         TEXT NOT NULL,
    metrica       TEXT NOT NULL,
    valor         REAL,
    registrado_en TEXT DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────────────────────
-- Promociones / cupones / lealtad
-- ──────────────────────────────────────────────────────────────────────────

-- id_categoria/descripcion ya existían en producción sin estar documentadas
-- aquí (mismo patrón de drift que productos/categorias/cobertura, ver
-- advertencia general al inicio de este archivo). brand/edad_min/edad_max/
-- creado_por/motivo_baja/baja_por/baja_en vienen de migrations/
-- 0009_promociones_alcance_auditoria.sql (Fase 2: alcance por marca/edad
-- además de producto único o categoría, y trazabilidad de quién crea/tumba
-- una oferta).
CREATE TABLE IF NOT EXISTS promociones (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo       TEXT UNIQUE,
    descripcion  TEXT,
    tipo         TEXT NOT NULL CHECK(tipo IN ('porcentaje','monto')) DEFAULT 'porcentaje',
    valor        REAL NOT NULL DEFAULT 0,
    id_producto  INTEGER REFERENCES productos(id),
    id_categoria INTEGER REFERENCES categorias(id),
    brand        TEXT,
    edad_min     INTEGER,
    edad_max     INTEGER,
    activa       INTEGER NOT NULL DEFAULT 1,
    fecha_inicio TEXT,
    fecha_fin    TEXT,
    usos_max     INTEGER DEFAULT 0,
    usos_actual  INTEGER NOT NULL DEFAULT 0,
    creado_por   TEXT,
    motivo_baja  TEXT,
    baja_por     TEXT,
    baja_en      TEXT,
    creada_en    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tickets_venta (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_qr           TEXT UNIQUE NOT NULL,
    telefono_cliente    TEXT,
    total                REAL,
    puntos_otorgados     INTEGER,
    puntos_reclamados    INTEGER NOT NULL DEFAULT 0,
    expira_reclamo_en    TEXT,
    reclamado_en         TEXT,
    creado_en            TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS puntos_cliente (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente        INTEGER REFERENCES clientes(id),
    telefono          TEXT NOT NULL,
    puntos_ganados    INTEGER NOT NULL DEFAULT 0,
    puntos_canjeados  INTEGER NOT NULL DEFAULT 0,
    ultimo_movimiento TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_puntos_cliente_telefono ON puntos_cliente(telefono);

CREATE TABLE IF NOT EXISTS movimientos_puntos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente  INTEGER REFERENCES clientes(id),
    telefono    TEXT,
    tipo        TEXT NOT NULL CHECK(tipo IN ('acumulacion','canje')),
    puntos      INTEGER NOT NULL,
    concepto    TEXT,
    id_ticket   INTEGER REFERENCES tickets_venta(id),
    creado_en   TEXT DEFAULT (datetime('now','localtime'))
);

-- Programa de referidos: registra cada vez que un código de referido
-- (clientes.codigo_referido) otorgó puntos — historial/auditoría y, junto
-- con creado_en, la base para el tope anti-fraude semanal por referente
-- (ver bot/handlers/referidosService.js).
CREATE TABLE IF NOT EXISTS referidos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    id_referente      INTEGER NOT NULL REFERENCES clientes(id),
    id_referido       INTEGER NOT NULL REFERENCES clientes(id),
    telefono_referido TEXT,
    puntos_otorgados  INTEGER NOT NULL DEFAULT 100,
    creado_en         TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS regalos_lealtad (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente   INTEGER REFERENCES clientes(id),
    telefono     TEXT,
    codigo_cupon TEXT,
    valor        REAL,
    puntos_usados INTEGER,
    expira_en    TEXT,
    estatus      TEXT NOT NULL DEFAULT 'activo',
    creada_en    TEXT DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────────────────────
-- Punto de venta físico (POS) — carritos armados por asesor desde el panel
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ventas_previas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono     TEXT NOT NULL,
    folio        TEXT,
    carrito_json TEXT NOT NULL,
    estatus      TEXT NOT NULL DEFAULT 'pendiente',
    creada_en    TEXT DEFAULT (datetime('now','localtime')),
    consumida_en TEXT
);

-- ──────────────────────────────────────────────────────────────────────────
-- Inventario multi-sucursal (NUEVO — esquema + permisos diseñados, sin UI
-- todavía; ver dashboard/server.js sección "Inventario (solo prime)" y
-- CLAUDE.md). Solo el rol 'prime' puede escribir en sucursales/productos/
-- movimientos_inventario — reutiliza requireSession(req, res, ['prime']).
-- ──────────────────────────────────────────────────────────────────────────

-- Catálogo normalizado de sucursales/almacenes de ESTE negocio. No reemplaza
-- `inventarios.sucursal` (texto libre, ya usado por services/stockService.js
-- para la red nacional simulada) ni `puntos_entrega` (lista pública de
-- pickup) — es el catálogo interno que alimenta el ledger de movimientos.
CREATE TABLE IF NOT EXISTS sucursales (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL,
    codigo        TEXT UNIQUE,
    direccion     TEXT,
    activa        INTEGER NOT NULL DEFAULT 1,
    creada_en     TEXT DEFAULT (datetime('now','localtime')),
    -- Sin dato fuente para backfillear (ver migrations/0008) -- se captura
    -- a mano desde el botón de editar sucursal en Prime.
    codigo_postal TEXT,
    lat           REAL,                       -- migrations/0023 (geo)
    lng           REAL
);

-- Ledger de movimientos de inventario: cada entrada/salida/ajuste queda
-- registrada con quién la hizo (id_usuario, siempre un usuario 'prime' por
-- el gate del API) — auditable, nunca se borra ni se actualiza una fila ya
-- creada. El stock "actual" sigue viviendo en productos.stock_*/inventarios
-- (no se duplica aquí); este ledger es el historial que los explica.
CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto  INTEGER NOT NULL REFERENCES productos(id),
    id_sucursal  INTEGER NOT NULL REFERENCES sucursales(id),
    tipo         TEXT NOT NULL CHECK(tipo IN ('entrada','salida','ajuste')),
    cantidad     INTEGER NOT NULL,
    motivo       TEXT,
    id_usuario   INTEGER REFERENCES usuarios(id),
    creado_en    TEXT DEFAULT (datetime('now','localtime'))
);
-- 0022: base financiera del ERP (Fase 6) — proveedores/órdenes de compra/
-- cuentas por pagar, plan de cuentas + asientos (libro mayor) y costeo
-- promedio. Los asientos automáticos se activan con el módulo
-- `contabilidad_activo` (apagado por default: Julio Cepeda no cambia).

CREATE TABLE IF NOT EXISTS proveedores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre       TEXT NOT NULL,
    rfc          TEXT,
    telefono     TEXT,
    email        TEXT,
    dias_credito INTEGER NOT NULL DEFAULT 0,
    activo       INTEGER NOT NULL DEFAULT 1,
    creado_en    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ordenes_compra (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    folio        TEXT NOT NULL,
    id_proveedor INTEGER NOT NULL REFERENCES proveedores(id),
    estatus      TEXT NOT NULL DEFAULT 'abierta',   -- abierta|recibida|cancelada
    total        REAL NOT NULL DEFAULT 0,
    notas        TEXT,
    creada_en    TEXT DEFAULT (datetime('now','localtime')),
    recibida_en  TEXT
);

CREATE TABLE IF NOT EXISTS ordenes_compra_detalle (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    id_oc          INTEGER NOT NULL REFERENCES ordenes_compra(id),
    id_producto    INTEGER NOT NULL,
    cantidad       INTEGER NOT NULL,
    costo_unitario REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS cuentas_pagar (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_proveedor INTEGER NOT NULL REFERENCES proveedores(id),
    id_oc        INTEGER REFERENCES ordenes_compra(id),
    monto        REAL NOT NULL,
    vence_en     TEXT,
    estatus      TEXT NOT NULL DEFAULT 'pendiente', -- pendiente|pagada
    pagada_en    TEXT,
    referencia   TEXT,
    creada_en    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS plan_cuentas (
    codigo TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo   TEXT NOT NULL   -- activo|pasivo|capital|ingreso|costo|gasto
);
INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES
    ('101', 'Caja', 'activo'),
    ('102', 'Bancos', 'activo'),
    ('105', 'Clientes (por cobrar)', 'activo'),
    ('115', 'Inventario', 'activo'),
    ('119', 'IVA acreditable', 'activo'),
    ('201', 'Proveedores (por pagar)', 'pasivo'),
    ('208', 'IVA trasladado no cobrado', 'pasivo'),
    ('209', 'IVA trasladado', 'pasivo'),
    ('301', 'Capital', 'capital'),
    ('401', 'Ventas', 'ingreso'),
    ('501', 'Costo de ventas', 'costo'),
    ('601', 'Gastos generales', 'gasto');

CREATE TABLE IF NOT EXISTS asientos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha           TEXT NOT NULL DEFAULT (date('now','localtime')),
    concepto        TEXT NOT NULL,
    referencia_tipo TEXT,   -- venta|costo_venta|compra|pago_cxp|manual
    referencia_id   TEXT,
    creado_en       TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS asientos_detalle (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    id_asiento INTEGER NOT NULL REFERENCES asientos(id),
    cuenta     TEXT NOT NULL REFERENCES plan_cuentas(codigo),
    debe       REAL NOT NULL DEFAULT 0,
    haber      REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_asientos_fecha ON asientos(fecha);
CREATE INDEX IF NOT EXISTS idx_asientos_det_cuenta ON asientos_detalle(cuenta);
CREATE INDEX IF NOT EXISTS idx_asientos_referencia ON asientos(referencia_tipo, referencia_id); -- 0037

CREATE TABLE IF NOT EXISTS historial_costos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto    INTEGER NOT NULL,
    cantidad       INTEGER NOT NULL,
    costo_unitario REAL NOT NULL,
    origen         TEXT,   -- oc:<folio> | entrada_manual
    creado_en      TEXT DEFAULT (datetime('now','localtime'))
);


-- ── migrations/0023: roles operativos del ERP ──────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_cortes_dia_usuario ON cortes_caja(fecha, usuario);

CREATE TABLE IF NOT EXISTS solicitudes_compra (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    descripcion TEXT NOT NULL,
    id_producto INTEGER,
    cantidad    INTEGER,
    motivo      TEXT,
    estatus     TEXT NOT NULL DEFAULT 'pendiente',
    creada_por  TEXT,
    resuelta_por TEXT,
    creada_en   TEXT DEFAULT (datetime('now','localtime')),
    resuelta_en TEXT
);

CREATE TABLE IF NOT EXISTS ubicaciones_inventario (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto   INTEGER NOT NULL,
    sucursal      TEXT NOT NULL,
    zona          TEXT,
    pasillo       TEXT,
    rack          TEXT,
    nivel         TEXT,
    actualizado_en TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(id_producto, sucursal)
);

CREATE TABLE IF NOT EXISTS empleados (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre         TEXT NOT NULL,
    puesto         TEXT,
    salario_diario REAL NOT NULL DEFAULT 0,
    con_impuestos  INTEGER NOT NULL DEFAULT 0,
    rfc            TEXT,
    curp           TEXT,
    nss            TEXT,
    activo         INTEGER NOT NULL DEFAULT 1,
    creado_en      TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS horarios_empleado (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_empleado INTEGER NOT NULL REFERENCES empleados(id),
    fecha       TEXT NOT NULL,
    horas       REAL NOT NULL,
    creado_en   TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(id_empleado, fecha)
);
CREATE TABLE IF NOT EXISTS nominas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_empleado  INTEGER NOT NULL REFERENCES empleados(id),
    desde        TEXT NOT NULL,
    hasta        TEXT NOT NULL,
    horas        REAL NOT NULL DEFAULT 0,
    bruto        REAL NOT NULL DEFAULT 0,
    isr          REAL NOT NULL DEFAULT 0,
    imss         REAL NOT NULL DEFAULT 0,
    neto         REAL NOT NULL DEFAULT 0,
    estatus      TEXT NOT NULL DEFAULT 'calculada',
    pagada_en    TEXT,
    creada_en    TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(id_empleado, desde, hasta)
);

-- 0026: citas (giros de servicio — bot agenda, dashboard opera, watcher recuerda 24h antes)
CREATE TABLE IF NOT EXISTS citas (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono             TEXT NOT NULL,
    nombre               TEXT,
    servicio             TEXT,
    fecha                TEXT NOT NULL,
    hora                 TEXT NOT NULL,
    estatus              TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK(estatus IN ('pendiente','confirmada','completada','cancelada','no_asistio')),
    notas                TEXT,
    recordatorio_enviado INTEGER NOT NULL DEFAULT 0,
    creado_en            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_citas_fecha ON citas(fecha, hora);
CREATE INDEX IF NOT EXISTS idx_citas_tel ON citas(telefono);

-- 0027: variantes talla×color con stock por sucursal (ropa/zapatos)
CREATE TABLE IF NOT EXISTS producto_variantes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto INTEGER NOT NULL,
    talla       TEXT,
    color       TEXT,
    sku         TEXT,
    upc         TEXT,
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(id_producto, talla, color)
);
CREATE TABLE IF NOT EXISTS inventario_variantes (
    id_variante INTEGER NOT NULL,
    sucursal    TEXT NOT NULL,
    stock       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id_variante, sucursal)
);
-- 0027: pedido_detalle.id_variante / variante · 0028: rastro de cancelación en pedidos
-- (ALTER en migraciones; en fresh-install van inline en las CREATE de arriba si aplica)
-- 0030 (espejo): INMUTABILIDAD de los libros (idea SAP "storno"): asientos y kardex
-- NO se editan ni borran — los errores se corrigen con documento inverso
-- (REVERSA / movimiento contrario). El candado vive en la BD, no en el
-- código. Bypass ÚNICO: configuracion.mantenimiento_bd='1' (lo usa el
-- reset de instancia de Prime y nada más).
CREATE TRIGGER IF NOT EXISTS trg_asientos_no_update BEFORE UPDATE ON asientos
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'Los asientos son inmutables: corrige con REVERSA'); END;
CREATE TRIGGER IF NOT EXISTS trg_asientos_no_delete BEFORE DELETE ON asientos
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'Los asientos son inmutables: corrige con REVERSA'); END;
CREATE TRIGGER IF NOT EXISTS trg_asientos_det_no_update BEFORE UPDATE ON asientos_detalle
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'Las partidas son inmutables: corrige con REVERSA'); END;
CREATE TRIGGER IF NOT EXISTS trg_asientos_det_no_delete BEFORE DELETE ON asientos_detalle
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'Las partidas son inmutables: corrige con REVERSA'); END;
CREATE TRIGGER IF NOT EXISTS trg_kardex_no_update BEFORE UPDATE ON inventario_movimientos
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'El kardex es inmutable: registra el movimiento contrario'); END;
CREATE TRIGGER IF NOT EXISTS trg_kardex_no_delete BEFORE DELETE ON inventario_movimientos
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'El kardex es inmutable: registra el movimiento contrario'); END;

-- 0033: nómina fiscal — expediente + desglose (columnas añadidas a empleados/nominas)
-- empleados += fecha_alta, departamento, comision_pct, metodo_pago, username, contacto_emergencia
-- nominas   += horas_extra, comisiones
-- 0034 (espejo): mesas de restaurante (módulo mesas_activo). Abrir mesa, agregar
-- platillos con comentario libre, preticket a cocina, cerrar → cobro en POS.
CREATE TABLE IF NOT EXISTS mesas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    numero     TEXT NOT NULL,
    estatus    TEXT NOT NULL DEFAULT 'abierta' CHECK(estatus IN ('abierta','cobrada')),
    id_pedido  INTEGER,
    abierta_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    cerrada_en TEXT
);
CREATE TABLE IF NOT EXISTS mesa_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    id_mesa        INTEGER NOT NULL,
    id_producto    INTEGER,
    nombre         TEXT NOT NULL,
    precio         REAL NOT NULL DEFAULT 0,
    cantidad       INTEGER NOT NULL DEFAULT 1,
    comentario     TEXT,
    enviado_cocina INTEGER NOT NULL DEFAULT 0,
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_mesa_items_mesa ON mesa_items(id_mesa);
