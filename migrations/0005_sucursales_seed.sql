-- 0005_sucursales_seed.sql
-- La tabla `sucursales` (registro maestro, ver migrations/... y db/schema.sql)
-- se creó vacía y nada la sembraba: las sucursales reales del negocio viven
-- como texto libre en `inventarios.sucursal` (11 valores, los mismos que
-- services/stockService.js's DIAS_ENTREGA usa para la red nacional). El
-- panel Prime ("Sucursales") apuntaba a la tabla nueva y por eso no mostraba
-- nada -- no es un bug de la consulta, es que nunca se sembró.
--
-- Esto es un backfill de DATOS, no un cambio de esquema -- no se mirrorea en
-- db/schema.sql porque una instalación nueva no tiene filas en `inventarios`
-- de las que copiar (la tabla quedaría igual de vacía hasta que se cargue
-- inventario real, que es justo cuando esta misma migración ya habrá corrido
-- una vez). Idempotente: el NOT IN evita duplicar si ya se corrió o si
-- alguien ya agregó sucursales a mano desde el panel.
INSERT INTO sucursales (nombre, activa)
SELECT DISTINCT sucursal, 1
FROM inventarios
WHERE sucursal IS NOT NULL
  AND TRIM(sucursal) != ''
  AND sucursal NOT IN (SELECT nombre FROM sucursales);
