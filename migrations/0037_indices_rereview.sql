-- 0037: índices para las vías calientes detectadas en el re-review v1.08
-- (agente de Rendimiento). Todos verificados: cubren queries que hoy hacen
-- full scan. (Mirror en db/schema.sql.)

-- checkLinksPagoPorVencer filtra por estatus + fecha_expiracion cada ciclo
CREATE INDEX IF NOT EXISTS idx_links_pago_est_expira ON links_pago(estatus, fecha_expiracion);
-- /api/metricas/canales agrupa clientes por fecha de alta
CREATE INDEX IF NOT EXISTS idx_clientes_creado_en ON clientes(creado_en);
-- idempotencia de asientos (venta_credito/cobro_credito/reversa/aguinaldo…)
CREATE INDEX IF NOT EXISTS idx_asientos_referencia ON asientos(referencia_tipo, referencia_id);
