-- 0074_crm_fase1.sql — CRM Fase 1 (INFORME_CRM.md): pipeline + notas.
-- clientes.etapa: NULL = sin clasificar (la vista deriva: con pedido pagado →
-- 'ganado', sin él → 'lead'); al moverlo a mano queda explícita. El log de
-- cambios (crm_etapas) es el rastro del pipeline; las notas son el contexto
-- que hoy se pierde en el chat.
ALTER TABLE clientes ADD COLUMN etapa TEXT;

CREATE TABLE IF NOT EXISTS crm_etapas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente INTEGER NOT NULL REFERENCES clientes(id),
    de         TEXT,
    a          TEXT NOT NULL,
    creado_por TEXT,
    creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_crm_etapas_cliente ON crm_etapas(id_cliente);

CREATE TABLE IF NOT EXISTS crm_notas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente INTEGER NOT NULL REFERENCES clientes(id),
    contenido  TEXT NOT NULL,
    creado_por TEXT,
    creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_crm_notas_cliente ON crm_notas(id_cliente);
