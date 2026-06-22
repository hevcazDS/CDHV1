-- 0004_logs_error.sql
-- Fase 3: tabla SQL consultable para fallos que hoy solo se ven en
-- bot/logs/*.log (texto plano, sin vista en el dashboard) — ver validar()
-- en dashboard/server.js (responde 400 al cliente pero no persistía nada
-- server-side) y los catches de cola_notificaciones/cola_emails ya
-- instrumentados con log.warn/log.debug desde la Fase JIUA 6. No
-- reemplaza esos logs de archivo, los complementa en los puntos de mayor
-- valor para auditoría/diagnóstico desde Beta.jsx.

CREATE TABLE IF NOT EXISTS logs_error (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    proceso       TEXT NOT NULL,
    motivo        TEXT NOT NULL,
    contexto_json TEXT,
    registrado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_error_fecha ON logs_error(date(registrado_en));
