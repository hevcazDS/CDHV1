-- 0083: check-in / asistencia (gym P1). Registra cada visita del cliente al
-- gimnasio/estudio (control de acceso simple, sin torniquete). Espejo en schema.sql.
CREATE TABLE IF NOT EXISTS asistencias (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente  INTEGER,
    telefono    TEXT,
    nombre      TEXT,
    fecha       TEXT NOT NULL DEFAULT (date('now','localtime')),
    hora        TEXT NOT NULL DEFAULT (strftime('%H:%M','now','localtime')),
    sucursal    TEXT,
    registrado_por TEXT,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha ON asistencias(fecha);
CREATE INDEX IF NOT EXISTS idx_asistencias_cli ON asistencias(id_cliente, fecha);
