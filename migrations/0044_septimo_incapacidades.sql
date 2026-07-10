-- 0044: séptimo día en la nómina (LFT 69, día de descanso pagado) e
-- incapacidades del IMSS. En la nómina fiscal, los días dentro de una
-- incapacidad NO se pagan como salario normal (el subsidio lo cubre el IMSS —
-- el contador lo concilia). (Mirror en db/schema.sql.)

ALTER TABLE nominas ADD COLUMN septimo_dia REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS incapacidades_empleado (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_empleado INTEGER NOT NULL REFERENCES empleados(id),
    tipo        TEXT,          -- enfermedad_general|riesgo_trabajo|maternidad
    desde       TEXT NOT NULL,
    hasta       TEXT NOT NULL,
    folio_imss  TEXT,
    creado_en   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_incap_emp ON incapacidades_empleado(id_empleado, desde, hasta);
