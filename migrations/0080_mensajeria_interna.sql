-- 0080: mensajería interna entre usuarios del ERP (1-a-1 y canales de grupo).
-- Distinta de `mensajes` (conversación de WhatsApp con clientes) y de crm_notas.
-- Es el chat del EQUIPO dentro del panel. Espejo en db/schema.sql.
--
-- Un canal 'directo' tiene exactamente 2 miembros; clave_directo = "<minId>_<maxId>"
-- con índice único para no duplicar el 1-a-1 entre el mismo par. Un canal 'grupo'
-- tiene nombre y N miembros. La lectura se rastrea con canal_miembros.ultimo_leido.
CREATE TABLE IF NOT EXISTS canales_internos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo          TEXT NOT NULL DEFAULT 'directo' CHECK(tipo IN ('directo','grupo')),
    nombre        TEXT,                       -- solo grupos
    clave_directo TEXT,                       -- "<minId>_<maxId>" para directos (dedupe)
    creado_por    INTEGER,
    creado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canales_directo ON canales_internos(clave_directo) WHERE clave_directo IS NOT NULL;

CREATE TABLE IF NOT EXISTS canal_miembros (
    id_canal     INTEGER NOT NULL REFERENCES canales_internos(id) ON DELETE CASCADE,
    id_usuario   INTEGER NOT NULL,
    ultimo_leido INTEGER NOT NULL DEFAULT 0,  -- id del último mensaje leído por este usuario
    agregado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (id_canal, id_usuario)
);

CREATE TABLE IF NOT EXISTS mensajes_internos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_canal     INTEGER NOT NULL REFERENCES canales_internos(id) ON DELETE CASCADE,
    id_remitente INTEGER NOT NULL,
    cuerpo       TEXT NOT NULL,
    creado_en    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_mensajes_internos_canal ON mensajes_internos(id_canal, id);
