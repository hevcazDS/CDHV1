-- 0061: congela el costo del producto al momento del pedido. Antes el costo de
-- venta (COGS) se calculaba con productos.costo ACTUAL al cobrar — un fiado
-- cobrado semanas después (tras una entrada que subió el costo promedio) asentaba
-- un COGS distinto al del kardex, descuadrando el margen del período. Guardar el
-- costo por línea al crear el pedido lo congela. NULL en filas viejas → el asiento
-- cae al costo actual (comportamiento previo, sin romper nada).
ALTER TABLE pedido_detalle ADD COLUMN costo_unitario REAL;
