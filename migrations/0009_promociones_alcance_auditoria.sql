-- 0009_promociones_alcance_auditoria.sql
-- Fase 2 del lote de Ofertas/Cupones: alcance por marca/edad (hoy solo se
-- puede filtrar por producto único o categoría -- id_categoria ya existía
-- en producción, ver db/schema.sql) y trazabilidad de quién crea/tumba una
-- oferta, pedida explícitamente por el operador para poder responsabilizar
-- descuentos mal puestos. Todas nullable: filas viejas simplemente quedan
-- sin marca/edad (sin restricción adicional) y sin auditoría retroactiva
-- (no hay dato fuente de quién las creó).
ALTER TABLE promociones ADD COLUMN brand TEXT;
ALTER TABLE promociones ADD COLUMN edad_min INTEGER;
ALTER TABLE promociones ADD COLUMN edad_max INTEGER;
ALTER TABLE promociones ADD COLUMN creado_por TEXT;
ALTER TABLE promociones ADD COLUMN motivo_baja TEXT;
ALTER TABLE promociones ADD COLUMN baja_por TEXT;
ALTER TABLE promociones ADD COLUMN baja_en TEXT;
