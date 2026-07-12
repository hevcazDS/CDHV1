-- 0050: multitienda Ola B — compras y mesas por tienda.
--
-- ordenes_compra.sucursal_destino: a qué tienda/almacén entra la mercancía al
-- recibir la OC (nombre en `sucursales`). NULL = comportamiento actual (entra
-- a la sucursal de la sesión que recibe, o a la default) → JC byte-idéntico.
ALTER TABLE ordenes_compra ADD COLUMN sucursal_destino TEXT;

-- mesas.sucursal: en qué local está la mesa (restaurante de 2+ locales). NULL
-- = local único (comportamiento actual).
ALTER TABLE mesas ADD COLUMN sucursal TEXT;
