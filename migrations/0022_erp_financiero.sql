-- 0022: base financiera del ERP (Fase 6) — proveedores/órdenes de compra/
-- cuentas por pagar, plan de cuentas + asientos (libro mayor) y costeo
-- promedio. Los asientos automáticos se activan con el módulo
-- `contabilidad_activo` (apagado por default: Julio Cepeda no cambia).

CREATE TABLE IF NOT EXISTS proveedores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre       TEXT NOT NULL,
    rfc          TEXT,
    telefono     TEXT,
    email        TEXT,
    dias_credito INTEGER NOT NULL DEFAULT 0,
    activo       INTEGER NOT NULL DEFAULT 1,
    creado_en    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ordenes_compra (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    folio        TEXT NOT NULL,
    id_proveedor INTEGER NOT NULL REFERENCES proveedores(id),
    estatus      TEXT NOT NULL DEFAULT 'abierta',   -- abierta|recibida|cancelada
    total        REAL NOT NULL DEFAULT 0,
    notas        TEXT,
    creada_en    TEXT DEFAULT (datetime('now','localtime')),
    recibida_en  TEXT
);

CREATE TABLE IF NOT EXISTS ordenes_compra_detalle (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    id_oc          INTEGER NOT NULL REFERENCES ordenes_compra(id),
    id_producto    INTEGER NOT NULL,
    cantidad       INTEGER NOT NULL,
    costo_unitario REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS cuentas_pagar (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_proveedor INTEGER NOT NULL REFERENCES proveedores(id),
    id_oc        INTEGER REFERENCES ordenes_compra(id),
    monto        REAL NOT NULL,
    vence_en     TEXT,
    estatus      TEXT NOT NULL DEFAULT 'pendiente', -- pendiente|pagada
    pagada_en    TEXT,
    referencia   TEXT,
    creada_en    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS plan_cuentas (
    codigo TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo   TEXT NOT NULL   -- activo|pasivo|capital|ingreso|costo|gasto
);
INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES
    ('101', 'Caja', 'activo'),
    ('102', 'Bancos', 'activo'),
    ('105', 'Clientes (por cobrar)', 'activo'),
    ('115', 'Inventario', 'activo'),
    ('119', 'IVA acreditable', 'activo'),
    ('201', 'Proveedores (por pagar)', 'pasivo'),
    ('209', 'IVA trasladado', 'pasivo'),
    ('301', 'Capital', 'capital'),
    ('401', 'Ventas', 'ingreso'),
    ('501', 'Costo de ventas', 'costo'),
    ('601', 'Gastos generales', 'gasto');

CREATE TABLE IF NOT EXISTS asientos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha           TEXT NOT NULL DEFAULT (date('now','localtime')),
    concepto        TEXT NOT NULL,
    referencia_tipo TEXT,   -- venta|costo_venta|compra|pago_cxp|manual
    referencia_id   TEXT,
    creado_en       TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS asientos_detalle (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    id_asiento INTEGER NOT NULL REFERENCES asientos(id),
    cuenta     TEXT NOT NULL REFERENCES plan_cuentas(codigo),
    debe       REAL NOT NULL DEFAULT 0,
    haber      REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_asientos_fecha ON asientos(fecha);
CREATE INDEX IF NOT EXISTS idx_asientos_det_cuenta ON asientos_detalle(cuenta);

CREATE TABLE IF NOT EXISTS historial_costos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto    INTEGER NOT NULL,
    cantidad       INTEGER NOT NULL,
    costo_unitario REAL NOT NULL,
    origen         TEXT,   -- oc:<folio> | entrada_manual
    creado_en      TEXT DEFAULT (datetime('now','localtime'))
);
