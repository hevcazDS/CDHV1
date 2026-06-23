-- 0014_negocio_giro_metodo_pago.sql
-- Bloque 1: volver el sistema agnóstico de giro + onboarding + pago multi-método.
--
-- 1) pedidos.metodo_pago: qué método eligió el cliente (efectivo/transferencia/
--    link/etc.). Nullable: pedidos viejos no lo tienen.
-- 2) Reconciliar el drift de `metodos_pago` (ya existe en producción pero NO en
--    db/schema.sql) — CREATE IF NOT EXISTS + INSERT OR IGNORE es seguro tanto en
--    la base de Julio Cepeda (no toca nada) como en un clon nuevo (lo siembra).
-- 3) Backfill DATA-AWARE de la identidad del negocio: solo se siembra si la base
--    YA tiene catálogo (= instancia existente de Julio Cepeda). Una base vacía
--    (clon nuevo para otro cliente) NO se siembra, para que el dashboard dispare
--    el onboarding de alta desde cero (negocio_configurado ausente).

ALTER TABLE pedidos ADD COLUMN metodo_pago TEXT;

CREATE TABLE IF NOT EXISTS metodos_pago (
    id            INTEGER PRIMARY KEY,
    nombre        TEXT,
    activo        INTEGER NOT NULL DEFAULT 1,
    requiere_link INTEGER NOT NULL DEFAULT 0,
    configuracion TEXT
);
INSERT OR IGNORE INTO metodos_pago (id, nombre, activo, requiere_link) VALUES
    (1, 'efectivo',      1, 0),
    (2, 'transferencia', 1, 0),
    (3, 'tarjeta',       1, 0),
    (4, 'paypal',        1, 1),
    (5, 'mercadopago',   1, 1),
    (6, 'oxxo',          1, 0);

-- Identidad de la instancia #1 (Julio Cepeda). "Hevcaz Solutions" era el valor
-- previo (la empresa de software, que ahora vive en el widget de soporte, no
-- como nombre del negocio del cliente).
INSERT OR REPLACE INTO configuracion (clave, valor)
    SELECT 'nombre_negocio', 'Julio Cepeda Jugueterías' WHERE (SELECT COUNT(*) FROM productos) > 0;
INSERT OR REPLACE INTO configuracion (clave, valor)
    SELECT 'nombre_negocio_corto', 'Julio Cepeda' WHERE (SELECT COUNT(*) FROM productos) > 0;
INSERT OR REPLACE INTO configuracion (clave, valor)
    SELECT 'giro', 'jugueteria' WHERE (SELECT COUNT(*) FROM productos) > 0;
INSERT OR REPLACE INTO configuracion (clave, valor)
    SELECT 'moneda', 'MXN' WHERE (SELECT COUNT(*) FROM productos) > 0;
INSERT OR REPLACE INTO configuracion (clave, valor)
    SELECT 'iva_pct', '16' WHERE (SELECT COUNT(*) FROM productos) > 0;
-- Marca la instancia como "ya configurada" para que NO muestre el onboarding.
INSERT OR REPLACE INTO configuracion (clave, valor)
    SELECT 'negocio_configurado', '1' WHERE (SELECT COUNT(*) FROM productos) > 0;
