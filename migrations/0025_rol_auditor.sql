-- 0025: rol AUDITOR — lectura de todo el sistema (reportes, kardex, libros,
-- cortes) sin poder escribir NADA. El CHECK de usuarios (0023) se rebuild
-- para admitirlo.
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS usuarios_v3 (
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
    rol           TEXT NOT NULL CHECK(rol IN ('cajero','operador','almacen','compras','rh','contabilidad','auditor','usuario','gerente','admin','prime'))
);
INSERT OR IGNORE INTO usuarios_v3 (id, nombre, email, password_hash, id_rol, sucursal, activo, creado_en, ultimo_acceso, username, salt, rol)
    SELECT id, nombre, email, password_hash, id_rol, sucursal, activo, creado_en, ultimo_acceso, username, salt, rol FROM usuarios;
DROP TABLE usuarios;
ALTER TABLE usuarios_v3 RENAME TO usuarios;
PRAGMA foreign_keys=ON;
