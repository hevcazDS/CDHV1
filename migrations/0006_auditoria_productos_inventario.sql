-- 0006_auditoria_productos_inventario.sql
-- Trazabilidad de catálogo/inventario (inspirado en el modelo Part/StockItem/
-- StockItemTracking de InvenTree, ver conversación): hoy no existe ningún
-- registro de quién/cuándo se da de alta un producto o se ajusta su stock.
--
-- creado_en/creado_por en productos: quién registró el producto y cuándo.
-- SQLite no permite ALTER TABLE ADD COLUMN con un DEFAULT no-constante
-- (datetime('now',...)), así que se agrega nullable y se hace el backfill
-- con UPDATE -- los 600 productos ya existentes quedan con la fecha de esta
-- migración (no hay forma de recuperar su fecha real de alta). El código
-- de creación (dashboard/routes/primeCatalogo.js) siempre manda un valor
-- explícito desde aquí en adelante, así que en la práctica nunca queda NULL
-- para productos nuevos aunque la columna no tenga NOT NULL a nivel de
-- esquema (mismo patrón ya tolerado en otras columnas agregadas ad-hoc).
ALTER TABLE productos ADD COLUMN creado_por TEXT;
ALTER TABLE productos ADD COLUMN creado_en TEXT;
UPDATE productos SET creado_en = datetime('now','localtime') WHERE creado_en IS NULL;

-- inventario_movimientos: ledger de cada alta/ajuste de stock -- el número
-- final en `inventarios.stock` ya existe, esto es el HISTORIAL de cómo llegó
-- ahí. Sin FK a productos/inventarios a propósito: un registro de auditoría
-- no debe poder desaparecer ni romperse si el producto se borra después
-- (consistente con cómo ya se manejan `cola_emails`/`logs_error`, que tampoco
-- dependen de que la fila referenciada siga existiendo).
CREATE TABLE IF NOT EXISTS inventario_movimientos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto       INTEGER NOT NULL,
    sucursal          TEXT NOT NULL,
    tipo              TEXT NOT NULL CHECK(tipo IN ('alta', 'ajuste_minimo', 'ajuste_stock')),
    cantidad_anterior INTEGER,
    cantidad_nueva    INTEGER,
    motivo            TEXT,
    creado_por        TEXT,
    creado_en         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_producto ON inventario_movimientos(id_producto, sucursal);
