-- 0049: multitienda Ola A — la sesión conoce su tienda.
--
-- usuarios.sucursal: a qué tienda pertenece el usuario (nombre de la tabla
-- `sucursales`, mismo convenio texto-libre que inventarios.sucursal). NULL =
-- opera en la sucursal de facturación default (comportamiento actual, así
-- Julio Cepeda queda byte-idéntico). OJO: la BD de producción original YA trae
-- esta columna (legacy del sistema Python previo, preservada por el rebuild de
-- 0023) — migrate.js tolera "duplicate column name", este ALTER es para
-- instancias creadas desde un schema.sql anterior a esta ola.
ALTER TABLE usuarios ADD COLUMN sucursal TEXT;

-- cortes_caja.sucursal: en qué tienda se hizo el corte (se llena con la
-- sucursal de la sesión al cerrar). NULL en cortes históricos.
ALTER TABLE cortes_caja ADD COLUMN sucursal TEXT;

-- Semilla de series_folios para instancias clonadas desde un schema.sql viejo
-- (el fix de la Ola R la agregó a schema.sql para instalaciones nuevas; esto
-- cubre las ya creadas). INSERT OR IGNORE: producción ya las tiene.
INSERT OR IGNORE INTO series_folios (tipo, prefijo, ultimo_folio, longitud) VALUES
    ('pedido',         'HEV-PED-', 0, 6),
    ('ticket',         'HEV-TKT-', 0, 6),
    ('transferencia',  'HEV-TRF-', 0, 6),
    ('devolucion',     'HEV-DEV-', 0, 6),
    ('factura',        'HEV-FAC-', 0, 6),
    ('guia_estafeta',  'EST-SIM-', 0, 8),
    ('preventa',       'PREV-',    0, 6),
    ('lista_espera',   'ESP-',     0, 6),
    ('ticket_qr',      'TK-',      0, 8),
    ('regalo_lealtad', 'REGALO-',  0, 6);
