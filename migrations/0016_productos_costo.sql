-- 0016_productos_costo.sql
-- Bloque 2B: costo de producto (costo de adquisición) para poder calcular
-- margen/utilidad en catálogo, POS y reportes. Nullable: productos viejos no
-- lo tienen hasta que se capture (en alta/edición o al recibir mercancía).
ALTER TABLE productos ADD COLUMN costo REAL;
