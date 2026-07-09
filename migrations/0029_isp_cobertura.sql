-- 0029: ISP/cambaceo — zonas de cobertura por CP. Si la tabla tiene filas
-- activas, el checkout valida el CP del cliente; vacía = sin restricción
-- (todos los demás giros no se enteran).
CREATE TABLE IF NOT EXISTS zonas_cobertura (
    cp        TEXT PRIMARY KEY,
    colonia   TEXT,
    activa    INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
