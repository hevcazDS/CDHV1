-- 0054: propina en el cobro de mesa (restaurante). Se cobra APARTE del subtotal
-- (no es venta gravada; va al total y se registra para el reparto a meseros).
ALTER TABLE mesas ADD COLUMN propina REAL NOT NULL DEFAULT 0;
