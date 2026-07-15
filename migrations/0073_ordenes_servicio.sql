-- 0073_ordenes_servicio.sql — auditoría de giros r2 #3: órdenes de servicio /
-- trabajo (mantenimiento, servicios, ferretería-taller). Registra QUÉ se hizo:
-- descripción del encargo, quién lo atiende, estatus y el trabajo realizado al
-- cerrar — la evidencia que faltaba. Fotos: pendiente (subida de archivos es
-- infra aparte); las notas de texto cubren la v1.
CREATE TABLE IF NOT EXISTS ordenes_servicio (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    folio             TEXT,
    id_cliente        INTEGER,
    id_cita           INTEGER,
    cliente_nombre    TEXT,
    telefono          TEXT,
    descripcion       TEXT NOT NULL,
    trabajo_realizado TEXT,
    estatus           TEXT NOT NULL DEFAULT 'abierta'
                      CHECK(estatus IN ('abierta','en_curso','completada','cancelada')),
    id_empleado       INTEGER,
    creado_por        TEXT,
    creado_en         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    cerrado_en        TEXT
);
CREATE INDEX IF NOT EXISTS idx_ordenes_servicio_estatus ON ordenes_servicio(estatus);
