-- 0024: inventario_movimientos traía CHECK(tipo IN ('alta','ajuste_minimo',
-- 'ajuste_stock')) — el kardex universal (venta/entrada/salida/traslado/
-- ajuste_conteo/reversa/devolucion) fallaba EN SILENCIO. Rebuild sin ese
-- candado: es un ledger, el tipo es descriptivo.
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS inventario_movimientos_v2 (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto       INTEGER NOT NULL,
    sucursal          TEXT NOT NULL,
    tipo              TEXT NOT NULL,
    cantidad_anterior INTEGER,
    cantidad_nueva    INTEGER,
    motivo            TEXT,
    creado_por        TEXT,
    creado_en         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT OR IGNORE INTO inventario_movimientos_v2 (id, id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por, creado_en)
    SELECT id, id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por, creado_en FROM inventario_movimientos;
DROP TABLE inventario_movimientos;
ALTER TABLE inventario_movimientos_v2 RENAME TO inventario_movimientos;
CREATE INDEX IF NOT EXISTS idx_invmov_producto ON inventario_movimientos(id_producto, creado_en);
PRAGMA foreign_keys=ON;
