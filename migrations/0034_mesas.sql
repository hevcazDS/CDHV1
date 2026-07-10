-- 0034: mesas de restaurante (módulo mesas_activo). Abrir mesa, agregar
-- platillos con comentario libre, preticket a cocina, cerrar → cobro en POS.
CREATE TABLE IF NOT EXISTS mesas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    numero     TEXT NOT NULL,
    estatus    TEXT NOT NULL DEFAULT 'abierta' CHECK(estatus IN ('abierta','cobrada')),
    id_pedido  INTEGER,
    abierta_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    cerrada_en TEXT
);
CREATE TABLE IF NOT EXISTS mesa_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    id_mesa        INTEGER NOT NULL,
    id_producto    INTEGER,
    nombre         TEXT NOT NULL,
    precio         REAL NOT NULL DEFAULT 0,
    cantidad       INTEGER NOT NULL DEFAULT 1,
    comentario     TEXT,
    enviado_cocina INTEGER NOT NULL DEFAULT 0,
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_mesa_items_mesa ON mesa_items(id_mesa);
