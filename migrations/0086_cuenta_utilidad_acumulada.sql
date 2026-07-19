-- 0086: cuenta de Utilidad acumulada (capital) para el CIERRE CONTABLE ANUAL.
-- Al cerrar un ejercicio, el saldo de las cuentas de resultados (ingreso/costo/
-- gasto) se traspasa aquí y esas cuentas quedan en cero. Antes no había cierre
-- anual formal (la utilidad se recomputaba del histórico completo cada vez).
-- Espejo en db/schema.sql.
INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES
    ('302', 'Utilidad acumulada', 'capital');
