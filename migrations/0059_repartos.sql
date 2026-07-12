-- 0059: reparto de propinas/comisiones entre el personal. Registro simple (no
-- contabilidad): la propina en México no es ingreso gravado del negocio, solo
-- se cobra aparte (mesas.propina) y se reparte. Esta tabla guarda quién recibió
-- cuánto y de qué concepto, para restaurantes/materiales que activen el módulo.
CREATE TABLE IF NOT EXISTS repartos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha        TEXT NOT NULL DEFAULT (date('now','localtime')),
    concepto     TEXT NOT NULL DEFAULT 'propina',  -- propina|comision|otro
    beneficiario TEXT NOT NULL,                     -- nombre del empleado/mesero
    monto        REAL NOT NULL,
    sucursal     TEXT,
    creado_por   TEXT,
    creado_en    TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_repartos_fecha ON repartos(fecha);
