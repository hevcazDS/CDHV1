-- 02_devoluciones_contrato.sql — columnas que asesorFlow.js usa en su INSERT
-- deben existir en la tabla real. Si imprime FALLA, el INSERT del bot
-- truena en silencio (está envuelto en try/catch) y la devolución nunca
-- queda registrada.
SELECT
    CASE WHEN COUNT(*) = 4 THEN 'OK: columnas del INSERT existen'
         ELSE 'FALLA: faltan columnas en devoluciones'
    END AS resultado
FROM pragma_table_info('devoluciones')
WHERE name IN ('id_pedido','motivo','estatus','creada_en');
