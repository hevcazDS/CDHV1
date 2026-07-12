-- 0060: conciliación bancaria. Importa el estado de cuenta (líneas del banco) y
-- las casa contra los cobros (links_pago pagados) y pagos (cuentas_pagar pagadas)
-- ya registrados. El valor de control: ver qué movimientos del banco NO
-- corresponden a nada registrado (y viceversa). monto con signo: + ingreso,
-- - egreso. match_tipo/match_id ligan la fila casada; lote = id del import.
CREATE TABLE IF NOT EXISTS movimientos_banco (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha        TEXT NOT NULL,
    concepto     TEXT,
    monto        REAL NOT NULL,              -- + ingreso / - egreso
    referencia   TEXT,
    conciliado   INTEGER NOT NULL DEFAULT 0,
    match_tipo   TEXT,                        -- link_pago | cuenta_pagar | manual
    match_id     INTEGER,
    lote         TEXT,                        -- id del import (para deshacer)
    sucursal     TEXT,
    importado_en TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_mov_banco_fecha ON movimientos_banco(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_banco_lote  ON movimientos_banco(lote);
