-- 0084: módulo de correo (correo_activo). Tabla que sirve para el registro de
-- ENVIADOS (Fase A) y, más adelante, la bandeja de ENTRANTES por IMAP (Fase B).
-- Espejo en db/schema.sql. Ver INFORME_CORREO.md.
CREATE TABLE IF NOT EXISTS correos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    direccion     TEXT NOT NULL DEFAULT 'saliente' CHECK(direccion IN ('entrante','saliente')),
    uid           TEXT,                 -- UID IMAP (entrantes) para dedup; NULL en salientes
    de            TEXT,
    para          TEXT,
    asunto        TEXT,
    cuerpo        TEXT,
    adjuntos_json TEXT,                 -- [{nombre, tipo, tamano}]
    leido         INTEGER NOT NULL DEFAULT 1,   -- salientes nacen leídos
    fecha         TEXT,
    creado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_correos_dir ON correos(direccion, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_correos_uid ON correos(uid) WHERE uid IS NOT NULL;
