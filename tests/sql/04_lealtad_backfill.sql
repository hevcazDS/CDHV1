-- 04_lealtad_backfill.sql — valida que 021_lealtad_descuento.sql (migraciones_pendientes/)
-- sea seguro contra el esquema real: columnas correctas y qué filas migraría.
-- No modifica nada — usa SELECT, no INSERT.

-- Columnas que usa el backfill deben existir en ambas tablas
SELECT 'regalos_lealtad' AS tabla,
    CASE WHEN COUNT(*) = 4 THEN 'OK' ELSE 'FALLA' END AS resultado
FROM pragma_table_info('regalos_lealtad')
WHERE name IN ('codigo_cupon','valor','estatus','expira_en')

UNION ALL
SELECT 'promociones (backfill)',
    CASE WHEN COUNT(*) = 9 THEN 'OK' ELSE 'FALLA' END
FROM pragma_table_info('promociones')
WHERE name IN ('codigo','tipo','valor','id_producto','fecha_inicio','fecha_fin','usos_max','usos_actual','activa');

-- Vista previa: qué cupones de regalo viejos migraría el backfill
-- (vacío en esta copia porque regalos_lealtad no tiene filas — esperado)
SELECT rl.codigo_cupon, rl.valor, rl.expira_en
FROM regalos_lealtad rl
WHERE rl.estatus = 'activo'
  AND rl.expira_en >= date('now','localtime')
  AND NOT EXISTS (SELECT 1 FROM promociones p WHERE UPPER(p.codigo) = UPPER(rl.codigo_cupon));
