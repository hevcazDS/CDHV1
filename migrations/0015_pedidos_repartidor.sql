-- 0015_pedidos_repartidor.sql
-- Bloque 2: entrega con repartidor propio (módulo activable).
--
-- IMPORTANTE (corrección de lógica): el repartidor NO es un usuario ni tiene
-- WhatsApp propio. Es solo un dato del pedido (nombre/teléfono) para referencia
-- interna. El aviso "va en camino con el repartidor" lo manda el ÚNICO WhatsApp
-- del negocio (el bot, vía cola_notificaciones) cuando el operador cambia el
-- estado desde el dashboard.
--
-- pedidos.metodo_entrega: 'pickup' | 'paqueteria' | 'repartidor' (o NULL viejo).
ALTER TABLE pedidos ADD COLUMN metodo_entrega TEXT;
ALTER TABLE pedidos ADD COLUMN repartidor_nombre TEXT;
ALTER TABLE pedidos ADD COLUMN repartidor_telefono TEXT;

-- Catálogo opcional de repartidores frecuentes (solo para reusar nombres al
-- asignar; no son cuentas de acceso). Lean a propósito.
CREATE TABLE IF NOT EXISTS repartidores (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre    TEXT NOT NULL,
    telefono  TEXT,
    activo    INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now','localtime'))
);
