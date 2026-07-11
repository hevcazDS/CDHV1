-- 0046: índices para la superficie del 3er/4º comité (Rendimiento).
-- (Mirror en db/schema.sql.)

-- Subconsulta de stock vivo del bot: SUM(stock) FROM inventarios WHERE
-- id_producto=?. El UNIQUE(id_producto,sucursal) ya la cubre, pero se agrega
-- explícito por el drift histórico entre schema.sql y la BD real.
CREATE INDEX IF NOT EXISTS idx_inventarios_producto ON inventarios(id_producto);
-- /api/metricas/salud-bot: GROUP BY tipo_evento con filtro de fecha.
CREATE INDEX IF NOT EXISTS idx_log_eventos_tipo_fecha ON log_eventos(tipo_evento, registrado_en);
-- Joins por id_cliente (segmentación, rentabilidad) — el índice previo era
-- sobre `cliente` (nombre), no sobre id_cliente.
CREATE INDEX IF NOT EXISTS idx_pedidos_id_cliente ON pedidos(id_cliente);
-- Join de links_pago por pedido+estatus (segmentación, aging).
CREATE INDEX IF NOT EXISTS idx_links_pago_pedido_estatus ON links_pago(id_pedido, estatus);
