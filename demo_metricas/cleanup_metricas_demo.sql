-- cleanup_metricas_demo.sql
-- ═══════════════════════════════════════════════════════════════════════
-- Deja en CERO todas las tablas usadas por seed_metricas_demo.sql —
-- borra TODO su contenido, no solo lo insertado por el seed. Esto es a
-- propósito: lo poco que hubiera de datos viejos/de pruebas dispersos en
-- estas tablas no sigue ningún patrón identificable, así que en vez de
-- intentar borrar selectivamente, se vacían por completo.
--
-- ⚠️  IRREVERSIBLE. No toca `productos`, `clientes` reales fuera de las
-- filas que referencian estas tablas, `usuarios`, `configuracion`,
-- `puntos_entrega`, ni el catálogo — solo las tablas de
-- pedidos/transacciones/marketing/atención listadas abajo. Haz un
-- respaldo de la base antes de correr esto si tienes cualquier duda.
--
-- Corre con: sqlite3 "ruta/a/jugueteria.db" < cleanup_metricas_demo.sql
-- ═══════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = OFF;

DELETE FROM pedido_detalle;
DELETE FROM links_pago;
DELETE FROM envios;
DELETE FROM reservas_pickup;
DELETE FROM guias_estafeta;
DELETE FROM devoluciones;
DELETE FROM cola_atencion;
DELETE FROM carritos_abandonados;
DELETE FROM cola_notificaciones;
DELETE FROM valoraciones;
DELETE FROM lista_espera;
DELETE FROM preventa_clientes;
DELETE FROM preventas;
DELETE FROM log_eventos;
DELETE FROM regalos_lealtad;
DELETE FROM tickets_venta;
DELETE FROM promociones;
DELETE FROM pedidos;
DELETE FROM clientes;

-- Reinicia los contadores AUTOINCREMENT de esas tablas para que el
-- próximo registro real vuelva a empezar en 1 (literalmente "en cero").
DELETE FROM sqlite_sequence WHERE name IN (
    'pedido_detalle','links_pago','envios','reservas_pickup','guias_estafeta',
    'devoluciones','cola_atencion','carritos_abandonados','cola_notificaciones',
    'valoraciones','lista_espera','preventa_clientes','preventas','log_eventos',
    'regalos_lealtad','tickets_venta','promociones','pedidos','clientes'
);

PRAGMA foreign_keys = ON;

-- ═══════════════════════════════════════════════════════════════════════
-- Listo. Todas las tablas de arriba quedan en 0 filas. El catálogo de
-- productos, usuarios del dashboard y configuración NO se tocan.
-- ═══════════════════════════════════════════════════════════════════════
