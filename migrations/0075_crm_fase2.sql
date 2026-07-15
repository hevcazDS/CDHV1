-- 0075_crm_fase2.sql — CRM Fase 2: tareas de seguimiento por cliente (distintas
-- de las tareas de ERP: aquí es "llamar a X el viernes", ligadas al pipeline) +
-- segmentos guardados (audiencias reutilizables definidas como filtro JSON).
CREATE TABLE IF NOT EXISTS crm_tareas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente  INTEGER NOT NULL REFERENCES clientes(id),
    titulo      TEXT NOT NULL,
    tipo        TEXT NOT NULL DEFAULT 'seguimiento'
                CHECK(tipo IN ('llamada','whatsapp','visita','seguimiento','otro')),
    vence_en    TEXT,                                -- YYYY-MM-DD (NULL = sin fecha)
    asignado_a  TEXT,                                -- username (NULL = cualquiera)
    estatus     TEXT NOT NULL DEFAULT 'pendiente'
                CHECK(estatus IN ('pendiente','hecha','cancelada')),
    creado_por  TEXT,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    hecha_en    TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_tareas_cliente ON crm_tareas(id_cliente);
CREATE INDEX IF NOT EXISTS idx_crm_tareas_estatus ON crm_tareas(estatus, vence_en);

CREATE TABLE IF NOT EXISTS crm_segmentos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT NOT NULL,
    filtro_json TEXT NOT NULL DEFAULT '{}',
    creado_por  TEXT,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
