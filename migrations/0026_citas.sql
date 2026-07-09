-- 0026: CITAS — la pieza que desbloquea los giros de servicio (barbería,
-- tatuajes, estética, uñas, mantenimiento, servicios). El bot agenda por
-- fecha/hora contra capacidad configurable; el dashboard opera la agenda.
CREATE TABLE IF NOT EXISTS citas (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono             TEXT NOT NULL,
    nombre               TEXT,
    servicio             TEXT,                -- texto libre o nombre del producto tipo servicio
    fecha                TEXT NOT NULL,       -- YYYY-MM-DD
    hora                 TEXT NOT NULL,       -- HH:MM
    estatus              TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK(estatus IN ('pendiente','confirmada','completada','cancelada','no_asistio')),
    notas                TEXT,
    recordatorio_enviado INTEGER NOT NULL DEFAULT 0,
    creado_en            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_citas_fecha ON citas(fecha, hora);
CREATE INDEX IF NOT EXISTS idx_citas_tel ON citas(telefono);
