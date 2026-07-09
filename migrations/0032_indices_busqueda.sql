-- 0032: índices para las búsquedas calientes (auditoría de rendimiento).
-- folio/cliente/nombre/brand hacían full-scan en cada búsqueda del panel.
CREATE INDEX IF NOT EXISTS idx_pedidos_folio   ON pedidos(folio);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);
CREATE INDEX IF NOT EXISTS idx_productos_brand ON productos(brand);
CREATE INDEX IF NOT EXISTS idx_links_pago_pagado ON links_pago(estatus, pagado_en);
