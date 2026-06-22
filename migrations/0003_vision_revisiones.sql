-- 0003_vision_revisiones.sql
-- Fase 3 (trazabilidad de datos para entrenar un LLM): vision_cache es una
-- tabla de caché por contenido (hash de un prefijo del base64 + longitud,
-- ver bot/imageAnalyzer.js), no por ocurrencia — varias fotos de clientes
-- distintos pueden compartir la misma fila si el contenido coincide, así
-- que no le agregamos ahí una columna de archivo (solo capturaría la
-- primera foto que generó ese hash). Esta tabla nueva registra cada
-- OCURRENCIA real (una fila por foto guardada en bot/imagenes_clientes/),
-- enlazada al hash de Vision que le tocó, para que un humano confirme o
-- corrija la etiqueta desde el dashboard antes de usarla para entrenar nada.

CREATE TABLE IF NOT EXISTS vision_revisiones (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    archivo_imagen      TEXT NOT NULL,
    hash_vision         TEXT NOT NULL,
    telefono            TEXT,
    estado              TEXT NOT NULL DEFAULT 'pendiente',
    etiqueta_corregida  TEXT,
    registrado_en       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    revisado_en         TEXT
);
CREATE INDEX IF NOT EXISTS idx_vision_revisiones_estado ON vision_revisiones(estado);
