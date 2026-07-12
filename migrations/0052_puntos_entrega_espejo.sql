-- 0052: multitienda Ola D — reconcilia puntos_entrega con la forma real de
-- producción (nombre/direccion/maps_url ya existen allá y el bot los usa en
-- orderFlow.js; schema.sql estaba angosto — mismo patrón de drift que
-- cobertura). Necesario para que el espejo sucursal→punto de pickup
-- (primeCatalogo.js) funcione también en instancias creadas de un schema viejo.
ALTER TABLE puntos_entrega ADD COLUMN nombre TEXT;
ALTER TABLE puntos_entrega ADD COLUMN direccion TEXT;
ALTER TABLE puntos_entrega ADD COLUMN maps_url TEXT;
