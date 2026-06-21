-- 01_reporte_revenue.sql — ¿pedidos.total refleja el dinero real?
-- dashboard/server.js (/api/reporte) hace SUM(pedidos.total). Este script
-- compara esa columna contra el dinero real en links_pago y pedido_detalle.
-- Si imprime filas, el reporte de ingresos del dashboard está mal.
SELECT
    p.id_pedido,
    p.total                       AS total_en_pedidos,
    COALESCE(lp.monto_real, 0)    AS monto_real_links_pago,
    COALESCE(pd.subtotal_real, 0) AS subtotal_real_detalle
FROM pedidos p
LEFT JOIN (SELECT id_pedido, SUM(monto) AS monto_real FROM links_pago GROUP BY id_pedido) lp
    ON lp.id_pedido = p.id_pedido
LEFT JOIN (SELECT id_pedido, SUM(subtotal_linea) AS subtotal_real FROM pedido_detalle GROUP BY id_pedido) pd
    ON pd.id_pedido = p.id_pedido
WHERE p.total != COALESCE(lp.monto_real, pd.subtotal_real, p.total);
