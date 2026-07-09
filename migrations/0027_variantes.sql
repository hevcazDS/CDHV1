-- 0027: VARIANTES talla×color (ropa/zapatos) con stock POR SUCURSAL.
-- El stock agregado del producto sigue viviendo en `inventarios` (todo el
-- checkout/búsqueda existente lo usa); la matriz por variante vive aquí y
-- el agregado se recalcula vía kardex al editarla (auditable).
CREATE TABLE IF NOT EXISTS producto_variantes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto INTEGER NOT NULL,
    talla       TEXT,
    color       TEXT,
    sku         TEXT,
    upc         TEXT,
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(id_producto, talla, color)
);
CREATE INDEX IF NOT EXISTS idx_variantes_prod ON producto_variantes(id_producto);
CREATE INDEX IF NOT EXISTS idx_variantes_upc ON producto_variantes(upc);

CREATE TABLE IF NOT EXISTS inventario_variantes (
    id_variante INTEGER NOT NULL,
    sucursal    TEXT NOT NULL,
    stock       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id_variante, sucursal)
);

ALTER TABLE pedido_detalle ADD COLUMN id_variante INTEGER;
ALTER TABLE pedido_detalle ADD COLUMN variante TEXT;
