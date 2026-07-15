-- 0070_merma_caducidad.sql — P4 de AUDITORIA_ERP_COMPLETITUD: mermas tipificadas
-- + caducidad/lote LEAN. El lote y la fecha de caducidad viven en el MOVIMIENTO
-- de entrada (rastro auditable, sin FIFO por lote — a propósito, lean); la merma
-- se tipifica en el motivo del movimiento de salida ('merma:caducidad', etc.) y
-- el reporte de costo agrupa por tipo. Para abarrotes/carnicería/restaurante.
ALTER TABLE inventario_movimientos ADD COLUMN lote TEXT;
ALTER TABLE inventario_movimientos ADD COLUMN caducidad TEXT;
