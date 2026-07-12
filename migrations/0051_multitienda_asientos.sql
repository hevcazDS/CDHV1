-- 0051: multitienda Ola C — dimensión sucursal en los libros.
--
-- asientos.sucursal: centro de costos ligero — qué tienda originó el asiento.
-- La pueblan los chokepoints (venta POS/mesa/marcar-pagado desde
-- pedido_detalle.sucursal_origen; compra desde la sucursal destino de la OC;
-- gasto/póliza manual opcional). NULL = asientos históricos o del negocio en
-- general. Solo agrega columna: los triggers de inmutabilidad (0030) sobre
-- UPDATE/DELETE quedan intactos.
ALTER TABLE asientos ADD COLUMN sucursal TEXT;
