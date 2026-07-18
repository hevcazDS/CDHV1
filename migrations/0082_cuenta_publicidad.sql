-- 0082: subcuenta de Publicidad y marketing (finanzas P1). Antes la publicidad
-- caía mezclada en 601 (Gastos generales) y el CAC no podía separar "costo de
-- adquirir clientes" de "costo de operar". Con 602 el gasto de marketing sale
-- solo del libro mayor por fecha → CAC automático. Espejo en db/schema.sql.
INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES
    ('602', 'Publicidad y marketing', 'gasto');
