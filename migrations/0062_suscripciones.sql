-- 0062: suscripciones mensuales (F5.1, módulo suscripcion_activo, giro servicios).
-- Cobro recurrente + proyección de ingreso (MRR = SUM(monto) de activas). El cobro
-- de cada período reusa la ruta de dinero sellada (pedido + links_pago), no inventa
-- cobro nuevo. proximo_cobro avanza un mes al generar el cargo.
CREATE TABLE IF NOT EXISTS suscripciones (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente    INTEGER,                       -- REFERENCES clientes(id) (opcional)
    nombre        TEXT NOT NULL,                 -- cliente / nombre de la suscripción
    telefono      TEXT,
    concepto      TEXT,                          -- "Plan mensual X"
    monto         REAL NOT NULL,
    periodicidad  TEXT NOT NULL DEFAULT 'mensual',
    dia_corte     INTEGER,                       -- día del mes a cobrar (1-28)
    estatus       TEXT NOT NULL DEFAULT 'activa', -- activa | suspendida | cancelada
    proximo_cobro TEXT,                          -- YYYY-MM-DD
    referencia    TEXT,                          -- datos de referencia del cliente
    sucursal      TEXT,
    creado_por    TEXT,
    creado_en     TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_suscripciones_estatus ON suscripciones(estatus);
CREATE INDEX IF NOT EXISTS idx_suscripciones_proximo ON suscripciones(proximo_cobro);
