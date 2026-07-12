-- 0063: documentos (F5.2, módulo documentos_activo). Cotizaciones, pagarés y
-- contratos con plantillas estándar + plantilla propia por sucursal. El cuerpo de
-- la plantilla usa {{placeholders}} que se sustituyen al emitir; {{n}} = salto de
-- línea. El documento guarda su contenido renderizado (inmutable) para reimprimir.
-- Las plantillas estándar se siembran perezosamente desde código (documentos.js)
-- si faltan — así no hay drift entre schema.sql y esta migración.
CREATE TABLE IF NOT EXISTS plantillas_documento (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo       TEXT NOT NULL,                 -- cotizacion | pagare | contrato
    nombre     TEXT NOT NULL,
    cuerpo     TEXT NOT NULL,                 -- texto con {{placeholders}}
    sucursal   TEXT,                          -- NULL = estándar (todas); con valor = de esa sucursal
    creado_por TEXT,
    creado_en  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS documentos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo              TEXT NOT NULL,          -- cotizacion | pagare | contrato
    id_plantilla      INTEGER,
    contraparte_tipo  TEXT,                   -- cliente | proveedor | empleado
    contraparte_nombre TEXT,
    contraparte_ref   TEXT,                   -- RFC / teléfono / folio ligado (ej. fiado)
    monto             REAL,
    contenido         TEXT,                   -- renderizado (inmutable)
    estatus           TEXT NOT NULL DEFAULT 'borrador', -- borrador|emitido|firmado|cancelado
    folio             TEXT,
    id_pedido         INTEGER,
    sucursal          TEXT,
    creado_por        TEXT,
    creado_en         TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_documentos_tipo ON documentos(tipo, creado_en);
