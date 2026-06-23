-- 0018_cortes_caja.sql
-- Bloque 2B: corte de caja del POS de mostrador. Guarda el cierre diario:
-- total del sistema por método de pago (JSON), efectivo esperado vs contado y
-- la diferencia, con quién lo cerró. El módulo se prende con pos_activo.
CREATE TABLE IF NOT EXISTS cortes_caja (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha            TEXT NOT NULL,                 -- YYYY-MM-DD del corte
    usuario          TEXT,                          -- quién cerró la caja
    total_sistema    REAL NOT NULL DEFAULT 0,       -- total cobrado (todos los métodos)
    efectivo_sistema REAL NOT NULL DEFAULT 0,       -- lo que el sistema esperaba en efectivo
    efectivo_contado REAL,                          -- lo que el cajero contó
    diferencia       REAL,                          -- contado - esperado
    detalle_json     TEXT,                          -- desglose por método de pago
    creado_en        TEXT DEFAULT (datetime('now','localtime'))
);
