-- 0047: índice de devoluciones por pedido. (Mirror en db/schema.sql.)
-- Lo usan el historial del pedido (GET /api/pedidos/:id/historial) y el clamp
-- de cantidad devolvible en el PUT de devoluciones (comité de dominio).
CREATE INDEX IF NOT EXISTS idx_devoluciones_pedido ON devoluciones(id_pedido, id_producto);
