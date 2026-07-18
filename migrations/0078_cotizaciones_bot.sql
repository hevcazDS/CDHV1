-- 0078: cotizaciones del BOT (conversacionales, efímeras → ahora persistidas para
-- poder CONSULTARLAS: "¿cómo va mi cotización?"). Distinto de documentos_activo
-- (generador de documentos con plantillas en el panel): esto es la cotización que
-- el bot arma en el chat con la acción 'cotizar'. Solo informativa, no cobra.
-- Espejo en db/schema.sql.
CREATE TABLE IF NOT EXISTS cotizaciones_bot (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono   TEXT NOT NULL,
    subtotal   REAL NOT NULL DEFAULT 0,
    envio      REAL NOT NULL DEFAULT 0,
    total      REAL NOT NULL DEFAULT 0,
    n_items    INTEGER NOT NULL DEFAULT 0,
    items_json TEXT,
    estatus    TEXT NOT NULL DEFAULT 'vigente'
               CHECK(estatus IN ('vigente','vencida','convertida')),
    vence_en   TEXT,
    creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_bot_tel ON cotizaciones_bot(telefono, creado_en);
