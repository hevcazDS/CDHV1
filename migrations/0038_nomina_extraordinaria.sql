-- 0038: registro permanente de pagos de aguinaldo/finiquito. Antes el pago se
-- BLOQUEABA si el módulo Contabilidad estaba apagado (un negocio informal no
-- podía pagar). Ahora el pago SIEMPRE queda asentado en esta tabla (aunque no
-- haya libros contables); el asiento de partida doble se agrega ADEMÁS cuando
-- Contabilidad está activo (id_asiento). La idempotencia vive aquí (referencia
-- única), no en la existencia del asiento. (Mirror en db/schema.sql.)

CREATE TABLE IF NOT EXISTS nomina_extraordinaria (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    referencia  TEXT NOT NULL UNIQUE,   -- 'aguinaldo_<idEmp>_<anio>' | 'finiquito_<idEmp>'
    id_empleado INTEGER NOT NULL,
    tipo        TEXT NOT NULL,          -- 'aguinaldo' | 'finiquito'
    anio        INTEGER,                -- solo aguinaldo
    monto       REAL NOT NULL,
    id_asiento  INTEGER,                -- NULL si Contabilidad estaba apagado
    usuario     TEXT,                   -- quién autorizó
    creado_en   TEXT DEFAULT (datetime('now','localtime'))
);
