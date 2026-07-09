-- 0031: bitácora de cambios a configuracion (auditoría forense — Oxford D1/D5).
-- Registra quién cambió qué valor crítico y cuándo. Hace DETECTABLE el
-- bypass mantenimiento_bd, el apagado de contabilidad y la reapertura de
-- períodos, que antes no dejaban rastro.
CREATE TABLE IF NOT EXISTS configuracion_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    clave          TEXT NOT NULL,
    valor_anterior TEXT,
    valor_nuevo    TEXT,
    usuario        TEXT,
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_conflog_clave ON configuracion_log(clave, creado_en);
