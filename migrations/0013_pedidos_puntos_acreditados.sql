-- 0013_pedidos_puntos_acreditados.sql
-- El sistema de puntos deja de depender de escanear un ticket físico en
-- tienda: ahora CUALQUIER pedido pagado/confirmado otorga 1 punto por peso
-- (ver puntosService.js: otorgarPuntosPorCompra, llamada desde
-- POST /api/pagos/:id/marcar-pagado). Esta columna evita acreditar el mismo
-- pedido dos veces si ese endpoint se llega a invocar más de una vez.
ALTER TABLE pedidos ADD COLUMN puntos_acreditados INTEGER NOT NULL DEFAULT 0;
