-- 0079: media avanzada de producto (módulo media_avanzada_activo, default OFF).
-- Campos para aprovechar la BD más adelante (tienda en línea): liga de VIDEO y
-- liga de MODELO/RENDER/ANIMACIÓN 3D. Solo se capturan/guardan por ahora; el
-- consumo (galería web, visor 3D) es futuro. Aditivo, nullable → JC intacto.
-- Espejo en db/schema.sql.
ALTER TABLE productos ADD COLUMN video_url TEXT;
ALTER TABLE productos ADD COLUMN modelo_3d_url TEXT;
