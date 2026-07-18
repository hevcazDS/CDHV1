-- 0081: activos fijos (equipo, maquinaria, vehículos, cómputo, inmuebles) con
-- depreciación lineal. Antes NO existían: comprar una caminadora se mal-clasificaba
-- como inventario (115) o gasto (601). Ahora se capitaliza en su cuenta 12x y se
-- deprecia contra 129/605. Distinto del inventario-para-vender. Espejo en schema.sql.
CREATE TABLE IF NOT EXISTS activos_fijos (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre                 TEXT NOT NULL,
    categoria              TEXT NOT NULL DEFAULT 'equipo'
                           CHECK(categoria IN ('equipo','computo','vehiculos','maquinaria','inmuebles')),
    costo                  REAL NOT NULL DEFAULT 0,
    valor_residual         REAL NOT NULL DEFAULT 0,
    vida_util_meses        INTEGER NOT NULL DEFAULT 60,
    depreciacion_acumulada REAL NOT NULL DEFAULT 0,
    fecha_compra           TEXT NOT NULL DEFAULT (date('now','localtime')),
    ultima_depreciacion    TEXT,                 -- 'YYYY-MM' del último mes depreciado (idempotencia)
    estatus                TEXT NOT NULL DEFAULT 'activo' CHECK(estatus IN ('activo','baja')),
    sucursal               TEXT,
    creado_en              TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_activos_estatus ON activos_fijos(estatus);

-- Cuentas de activo fijo por categoría + depreciación acumulada (contra-activo)
-- + gasto por depreciación. 602 se deja libre para "Publicidad" (finanzas P1).
INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES
    ('120', 'Mobiliario y equipo', 'activo'),
    ('121', 'Equipo de cómputo', 'activo'),
    ('122', 'Vehículos', 'activo'),
    ('123', 'Maquinaria', 'activo'),
    ('124', 'Inmuebles', 'activo'),
    ('129', 'Depreciación acumulada', 'activo'),
    ('605', 'Gasto por depreciación', 'gasto');
