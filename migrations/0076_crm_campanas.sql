-- 0076_crm_campanas.sql — CRM Fase 3: campañas multi-paso sobre segmentos.
-- REGLAS DURAS: una campaña solo corre tras LANZARLA un gerente+ (aprobada_por
-- queda como rastro); el tick de stockWatcher solo encola a cola_notificaciones
-- (los tiempos de envío reales son los del poller escalonado INMUTABLE del bot);
-- el opt-out se excluye al inscribir Y se re-verifica en cada tick.
CREATE TABLE IF NOT EXISTS crm_campanas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre       TEXT NOT NULL,
    id_segmento  INTEGER,
    estatus      TEXT NOT NULL DEFAULT 'borrador'
                 CHECK(estatus IN ('borrador','activa','pausada','terminada')),
    aprobada_por TEXT,
    aprobada_en  TEXT,
    creado_por   TEXT,
    creado_en    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS crm_campana_pasos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_campana   INTEGER NOT NULL REFERENCES crm_campanas(id) ON DELETE CASCADE,
    orden        INTEGER NOT NULL,
    dia_offset   INTEGER NOT NULL DEFAULT 0,        -- días desde la inscripción
    mensaje      TEXT NOT NULL,                     -- {nombre} disponible
    condicion_salto TEXT                            -- 'si_compro' = termina si ya compró
);
CREATE TABLE IF NOT EXISTS crm_campana_inscritos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id_campana   INTEGER NOT NULL REFERENCES crm_campanas(id) ON DELETE CASCADE,
    id_cliente   INTEGER NOT NULL REFERENCES clientes(id),
    inscrito_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    paso_actual  INTEGER NOT NULL DEFAULT 0,        -- último paso ENVIADO (0 = ninguno)
    terminado    INTEGER NOT NULL DEFAULT 0,
    UNIQUE(id_campana, id_cliente)
);
CREATE INDEX IF NOT EXISTS idx_crm_inscritos_activos ON crm_campana_inscritos(id_campana, terminado);
