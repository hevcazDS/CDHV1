-- 0048: tareas/recordatorios — cubre dos huecos reportados en la revisión ERP:
--   (a) "desde administración no hay manera de ponerle trabajo" → gerente+ asigna
--       una tarea a un rol-área (almacen/pos/operacion/...) o a un usuario.
--   (b) "almacén no puede poner fechas ni recordatorios" → cualquier rol crea sus
--       propios recordatorios con fecha; los de almacén aparecen en su calendario.
-- Espejado en db/schema.sql.
CREATE TABLE IF NOT EXISTS tareas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    notas TEXT,
    fecha TEXT,                     -- fecha límite / del recordatorio (opcional)
    area TEXT,                      -- asignada a un área (almacen/pos/...) o NULL
    asignado_a TEXT,                -- asignada a un username específico o NULL
    creado_por TEXT NOT NULL,
    estatus TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | hecha
    creado_en TEXT DEFAULT (datetime('now','localtime')),
    hecha_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_tareas_estatus ON tareas(estatus, fecha);
