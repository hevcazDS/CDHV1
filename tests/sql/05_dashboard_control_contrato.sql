-- 05_dashboard_control_contrato.sql — columnas que usan los endpoints nuevos
-- de control del dashboard (pagos, devoluciones, cola_atencion, promociones)
-- contra el esquema real. Cualquier fila distinta de 'OK' es una columna que
-- el código referencia pero la tabla no tiene.
SELECT 'links_pago' AS tabla,
    CASE WHEN COUNT(*) = 5 THEN 'OK' ELSE 'FALLA' END AS resultado
FROM pragma_table_info('links_pago')
WHERE name IN ('id_pedido','monto','estatus','pagado_en','fecha_expiracion')

UNION ALL
SELECT 'pedidos (join cliente)',
    CASE WHEN COUNT(*) = 3 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('pedidos')
WHERE name IN ('id_cliente','cliente','estatus')

UNION ALL
SELECT 'cola_atencion',
    CASE WHEN COUNT(*) = 6 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('cola_atencion')
WHERE name IN ('id_cliente','motivo_escalada','prioridad','estatus','atendida_en','resuelta_en')

UNION ALL
SELECT 'devoluciones (notas/resuelta_en)',
    CASE WHEN COUNT(*) = 2 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('devoluciones')
WHERE name IN ('notas','resuelta_en')

UNION ALL
SELECT 'promociones (admin CRUD)',
    CASE WHEN COUNT(*) = 11 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('promociones')
WHERE name IN ('codigo','descripcion','tipo','valor','id_producto','id_categoria','activa','fecha_inicio','fecha_fin','usos_max','usos_actual')

UNION ALL
SELECT 'tickets_venta.id_promocion',
    CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('tickets_venta')
WHERE name = 'id_promocion';
