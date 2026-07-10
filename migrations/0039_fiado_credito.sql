-- 0039: completar ventas a crédito (fiado). Límite de crédito por cliente y
-- fecha de vencimiento del fiado, para poder cobrar y ver morosidad.
-- (Mirror en db/schema.sql.)

-- Límite de crédito por cliente (0 = sin límite / no aplica).
ALTER TABLE clientes ADD COLUMN limite_credito REAL DEFAULT 0;
-- Fecha en que vence el fiado (se llena al vender a crédito).
ALTER TABLE pedidos ADD COLUMN fiado_vence_en TEXT;
