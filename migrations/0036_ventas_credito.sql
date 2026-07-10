-- 0036: Ventas a crédito (fiado) — capa de DEVENGADO sobre el motor de flujo
-- de efectivo. México: el ingreso se reconoce al vender (Debe 105 Clientes /
-- Haber 401 Ventas), y el IVA NO es exigible hasta cobrarlo, así que se causa
-- en 208 "IVA trasladado no cobrado" y solo al cobrar pasa a 209 (por pagar).
-- Módulo ventas_credito_activo (default off): quien no vende a crédito no ve
-- ningún cambio.
-- (Mirror en db/schema.sql — mantener equivalentes.)

INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES
    ('208', 'IVA trasladado no cobrado', 'pasivo');

-- Marca del pedido vendido a crédito (para saldar la CxC al cobrar y no
-- volver a descontar inventario ni re-reconocer el ingreso en marcar-pagado).
ALTER TABLE pedidos ADD COLUMN a_credito INTEGER DEFAULT 0;
