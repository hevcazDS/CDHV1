-- 0010_sesiones_bot_version.sql
-- Fase 3, prerequisito técnico para el chat en vivo con "regresar al bot":
-- bot/sessionManager.js's getSession() revisaba SOLO el cache en memoria
-- (Map, hasta 30 min de TTL) antes de tocar SQLite -- si el dashboard
-- escribía sesiones_bot directo (como marketing.js's /api/beta/limpiar ya
-- hace hoy), el bot podía ignorar ese cambio hasta 30 minutos si ya tenía
-- la sesión cacheada. Esta columna deja que getSession() detecte con un
-- SELECT barato (PK) si la fila en SQLite cambió desde afuera del proceso,
-- sin tener que tirar el cache completo en cada lectura.
ALTER TABLE sesiones_bot ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
