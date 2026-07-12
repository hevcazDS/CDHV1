-- 0056: recepción parcial de órdenes de compra. cantidad_recibida por línea; la
-- OC queda 'parcial' hasta recibir todo. CxP se genera por lo recibido en cada
-- recepción (no el total de golpe).
ALTER TABLE ordenes_compra_detalle ADD COLUMN cantidad_recibida REAL NOT NULL DEFAULT 0;
