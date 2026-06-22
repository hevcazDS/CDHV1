-- 0007_backfill_id_categoria.sql
-- Los 600 productos existentes tienen id_categoria=NULL pero `cat` (texto)
-- con un valor que matchea exactamente un categorias.nombre -- confirmado
-- por inspección directa antes de escribir esta migración: 0 huérfanos,
-- 0 mismatches. dashboard/routes/primeCatalogo.js (alta/edición de
-- producto) ya escribe ambos campos sincronizados desde esta sesión en
-- adelante; esto solo cierra la brecha para los productos que existían
-- antes de ese cambio.
UPDATE productos
SET id_categoria = (SELECT id FROM categorias WHERE categorias.nombre = productos.cat)
WHERE id_categoria IS NULL
  AND cat IN (SELECT nombre FROM categorias);
