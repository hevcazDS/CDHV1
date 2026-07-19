-- 0085: terrenos (NO se deprecian) + revaluación al alza de activos fijos.
-- Contable: un TERRENO no pierde valor con el tiempo — nunca se deprecia. Y los
-- bienes inmuebles/terrenos pueden SUBIR de valor (modelo de revaluación): el
-- incremento se carga a la cuenta 12x del activo y se abona a "Superávit por
-- revaluación" (capital, 330), sin pasar por resultados. Antes el motor
-- depreciaba TODO por igual, incluidos inmuebles. Amplía el CHECK de categoria
-- (SQLite: requiere rebuild con FK off) y agrega revaluacion_acumulada.
-- Espejo en db/schema.sql.
PRAGMA foreign_keys=OFF;

CREATE TABLE activos_fijos_new (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre                 TEXT NOT NULL,
    categoria              TEXT NOT NULL DEFAULT 'equipo'
                           CHECK(categoria IN ('equipo','computo','vehiculos','maquinaria','inmuebles','terrenos')),
    costo                  REAL NOT NULL DEFAULT 0,
    valor_residual         REAL NOT NULL DEFAULT 0,
    vida_util_meses        INTEGER NOT NULL DEFAULT 60,
    depreciacion_acumulada REAL NOT NULL DEFAULT 0,
    revaluacion_acumulada  REAL NOT NULL DEFAULT 0,   -- 0085: plusvalía reconocida (revaluación al alza)
    fecha_compra           TEXT NOT NULL DEFAULT (date('now','localtime')),
    ultima_depreciacion    TEXT,
    estatus                TEXT NOT NULL DEFAULT 'activo' CHECK(estatus IN ('activo','baja')),
    sucursal               TEXT,
    creado_en              TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

INSERT INTO activos_fijos_new (id, nombre, categoria, costo, valor_residual, vida_util_meses,
    depreciacion_acumulada, fecha_compra, ultima_depreciacion, estatus, sucursal, creado_en)
  SELECT id, nombre, categoria, costo, valor_residual, vida_util_meses,
    depreciacion_acumulada, fecha_compra, ultima_depreciacion, estatus, sucursal, creado_en
  FROM activos_fijos;

DROP TABLE activos_fijos;
ALTER TABLE activos_fijos_new RENAME TO activos_fijos;
CREATE INDEX IF NOT EXISTS idx_activos_estatus ON activos_fijos(estatus);

PRAGMA foreign_keys=ON;

INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES
    ('125', 'Terrenos', 'activo'),
    ('330', 'Superávit por revaluación', 'capital');
