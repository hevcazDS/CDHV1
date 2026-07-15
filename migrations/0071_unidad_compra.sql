-- 0071_unidad_compra.sql — P6 de AUDITORIA_ERP_COMPLETITUD: conversión de
-- unidades compra↔venta (ferretería/abarrotes): se COMPRA por caja/bulto/rollo
-- y se VENDE por pieza/kg/m. factor_compra = cuántas unidades de VENTA trae una
-- unidad de COMPRA (caja de 100 tornillos → factor 100). Default 1 = sin
-- conversión (comportamiento actual, byte-idéntico).
ALTER TABLE productos ADD COLUMN unidad_compra TEXT;
ALTER TABLE productos ADD COLUMN factor_compra REAL NOT NULL DEFAULT 1;
