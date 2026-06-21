-- 03_marketing_contrato.sql — columnas que asumen las funciones nuevas de
-- stockWatcher.js (checkCarritosAbandonados24h, checkClientesDormidos)
-- contra el esquema real. Cualquier fila distinta de 'OK' es una columna
-- que el código referencia pero la tabla no tiene.
SELECT 'carritos_abandonados' AS tabla,
    CASE WHEN COUNT(*) = 5 THEN 'OK' ELSE 'FALLA' END AS resultado
FROM pragma_table_info('carritos_abandonados')
WHERE name IN ('telefono','carrito_json','abandonado_en','notificado','convertido')

UNION ALL
SELECT 'promociones',
    CASE WHEN COUNT(*) = 9 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('promociones')
WHERE name IN ('codigo','tipo','valor','id_producto','fecha_inicio','fecha_fin','usos_max','usos_actual','activa')

UNION ALL
SELECT 'clientes',
    CASE WHEN COUNT(*) = 4 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('clientes')
WHERE name IN ('id','telefono','nombre','tags')

UNION ALL
SELECT 'pedidos (id_cliente/creado_en)',
    CASE WHEN COUNT(*) = 2 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('pedidos')
WHERE name IN ('id_cliente','creado_en')

UNION ALL
SELECT 'cola_notificaciones',
    CASE WHEN COUNT(*) = 5 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('cola_notificaciones')
WHERE name IN ('tipo','destinatario','asunto','cuerpo','estatus')

UNION ALL
SELECT 'productos.ventas_simuladas',
    CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('productos')
WHERE name = 'ventas_simuladas';
