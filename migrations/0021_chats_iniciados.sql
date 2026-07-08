-- 0021: registro de chats iniciados por día (KPI "Chats nuevos hoy").
-- Un chat = un cliente que escribió ese día (primera vez del día); el bot
-- hace INSERT OR IGNORE por mensaje y el UNIQUE deduplica. Histórico
-- consultable por fecha, no solo el contador del día.
CREATE TABLE IF NOT EXISTS chats_iniciados (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono  TEXT NOT NULL,
    fecha     TEXT NOT NULL,
    creado_en TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(telefono, fecha)
);
CREATE INDEX IF NOT EXISTS idx_chats_iniciados_fecha ON chats_iniciados(fecha);
