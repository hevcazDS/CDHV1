-- 0002_indices_estabilidad.sql
-- Fase 2 del hardening post-auditoría (hallazgo del ingeniero de datos del
-- comité): cola_notificaciones, pedidos y cola_emails no tienen ningún
-- índice explícito y se consultan constantemente por polling (cada 30s/60min
-- desde bot/index.js y services/stockWatcher.js) filtrando por estatus y por
-- date(creada_en)/date(creado_en) para deduplicar envíos del día — full table
-- scan en cada poll. Verificado contra PRAGMA table_info() de la base real
-- (no solo contra db/schema.sql, que está desactualizado respecto a la BD en
-- producción — ver columnas duplicadas html_body/cuerpo_html en cola_emails).
--
-- Se descartó indexar sesiones_bot: su único acceso es por id_usuario, que ya
-- es PRIMARY KEY (índice implícito); no había nada que optimizar ahí.
--
-- Índices de expresión sobre date(...) porque el código filtra así
-- literalmente (14 sitios en bot/index.js, dashboard/server.js,
-- services/stockWatcher.js) — un índice plano sobre la columna no se usaría
-- para esas queries.

CREATE INDEX IF NOT EXISTS idx_cola_notif_estatus_tipo ON cola_notificaciones(estatus, tipo);
CREATE INDEX IF NOT EXISTS idx_cola_notif_fecha         ON cola_notificaciones(date(creada_en));

CREATE INDEX IF NOT EXISTS idx_pedidos_estatus ON pedidos(estatus);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha   ON pedidos(date(creado_en));

CREATE INDEX IF NOT EXISTS idx_cola_emails_estatus ON cola_emails(estatus);
CREATE INDEX IF NOT EXISTS idx_cola_emails_fecha    ON cola_emails(date(creada_en));
