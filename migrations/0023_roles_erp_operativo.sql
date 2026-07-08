-- 0023: roles operativos del ERP (8), corte por usuario, PIN de autorización,
-- tipo de producto, compras/requisiciones, RRHH/nómina, almacén geoespacial.

-- Rebuild de usuarios: el CHECK viejo solo permitía usuario/gerente/prime.
-- (FKs off durante el swap: hay tablas que referencian usuarios)
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS usuarios_v2 (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL DEFAULT '',
    email         TEXT,
    password_hash TEXT NOT NULL,
    id_rol        INTEGER,
    sucursal      TEXT,
    activo        INTEGER NOT NULL DEFAULT 1,
    creado_en     TEXT DEFAULT (datetime('now','localtime')),
    ultimo_acceso TEXT,
    username      TEXT NOT NULL UNIQUE,
    salt          TEXT NOT NULL,
    rol           TEXT NOT NULL CHECK(rol IN ('cajero','operador','almacen','compras','rh','contabilidad','usuario','gerente','admin','prime'))
);
INSERT OR IGNORE INTO usuarios_v2 (id, nombre, email, password_hash, id_rol, sucursal, activo, creado_en, ultimo_acceso, username, salt, rol)
    SELECT id, nombre, email, password_hash, id_rol, sucursal, activo, creado_en, ultimo_acceso, username, salt, rol FROM usuarios;
DROP TABLE usuarios;
ALTER TABLE usuarios_v2 RENAME TO usuarios;
-- El rol legacy 'usuario' pasa a 'operador' (mismas capacidades + POS)
UPDATE usuarios SET rol='operador' WHERE rol='usuario';
PRAGMA foreign_keys=ON;

-- Quién cobró cada pedido (corte de caja POR usuario)
ALTER TABLE pedidos ADD COLUMN cobrado_por TEXT;

-- cortes_caja: la BD de producción traía una tabla LEGACY del sistema
-- Python previo (id_turno/id_usuario, sin fecha) — el corte del POS nunca
-- pudo escribir ahí. Se preserva como _legacy y se crea la forma correcta.
ALTER TABLE cortes_caja RENAME TO cortes_caja_legacy;
CREATE TABLE IF NOT EXISTS cortes_caja (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha            TEXT NOT NULL,
    usuario          TEXT NOT NULL,
    total_sistema    REAL NOT NULL DEFAULT 0,
    efectivo_sistema REAL NOT NULL DEFAULT 0,
    efectivo_contado REAL,
    diferencia       REAL,
    detalle_json     TEXT,
    creado_en        TEXT DEFAULT (datetime('now','localtime'))
);
-- Un corte por usuario por día (el ERP nunca duplica)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cortes_dia_usuario ON cortes_caja(fecha, usuario);

-- Tipo de producto: fisico (inventariable/enviable), consumible (inventariable,
-- insumo), servicio (sin stock ni envío)
ALTER TABLE productos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'fisico';

-- Solicitudes de adquisición (rol compras crea, administrador aprueba → OC)
CREATE TABLE IF NOT EXISTS solicitudes_compra (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    descripcion TEXT NOT NULL,
    id_producto INTEGER,
    cantidad    INTEGER,
    motivo      TEXT,
    estatus     TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|aprobada|rechazada
    creada_por  TEXT,
    resuelta_por TEXT,
    creada_en   TEXT DEFAULT (datetime('now','localtime')),
    resuelta_en TEXT
);

-- Almacén: ubicación física por producto+sucursal, y geo por sucursal
ALTER TABLE sucursales ADD COLUMN lat REAL;
ALTER TABLE sucursales ADD COLUMN lng REAL;
CREATE TABLE IF NOT EXISTS ubicaciones_inventario (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto   INTEGER NOT NULL,
    sucursal      TEXT NOT NULL,
    zona          TEXT,
    pasillo       TEXT,
    rack          TEXT,
    nivel         TEXT,
    actualizado_en TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(id_producto, sucursal)
);

-- RRHH (módulo rrhh_activo)
CREATE TABLE IF NOT EXISTS empleados (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre         TEXT NOT NULL,
    puesto         TEXT,
    salario_diario REAL NOT NULL DEFAULT 0,
    con_impuestos  INTEGER NOT NULL DEFAULT 0,   -- 1 = retener ISR/IMSS
    rfc            TEXT,
    curp           TEXT,
    nss            TEXT,
    activo         INTEGER NOT NULL DEFAULT 1,
    creado_en      TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS horarios_empleado (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_empleado INTEGER NOT NULL REFERENCES empleados(id),
    fecha       TEXT NOT NULL,
    horas       REAL NOT NULL,
    creado_en   TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(id_empleado, fecha)
);
CREATE TABLE IF NOT EXISTS nominas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_empleado  INTEGER NOT NULL REFERENCES empleados(id),
    desde        TEXT NOT NULL,
    hasta        TEXT NOT NULL,
    horas        REAL NOT NULL DEFAULT 0,
    bruto        REAL NOT NULL DEFAULT 0,
    isr          REAL NOT NULL DEFAULT 0,
    imss         REAL NOT NULL DEFAULT 0,
    neto         REAL NOT NULL DEFAULT 0,
    estatus      TEXT NOT NULL DEFAULT 'calculada',  -- calculada|pagada
    pagada_en    TEXT,
    creada_en    TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(id_empleado, desde, hasta)
);
