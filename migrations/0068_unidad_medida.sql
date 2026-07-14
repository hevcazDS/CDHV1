-- 0068_unidad_medida.sql — P1 de AUDITORIA_ERP_COMPLETITUD: venta por peso/granel.
-- Unidad de venta del producto: 'pza' (default, comportamiento actual) | 'kg' |
-- 'g' | 'lt' | 'ml' | 'm'. Con unidad ≠ pza el POS permite cantidad DECIMAL
-- (0.750 kg) — el backend de venta ya acepta decimales (parseFloat + redondeo
-- a milésimas) y SQLite guarda 1.5 en columnas INTEGER-affinity sin pérdida.
-- Desbloquea carnicería (kg), abarrotes (granel) y ferretería (metro).
ALTER TABLE productos ADD COLUMN unidad_medida TEXT NOT NULL DEFAULT 'pza';
