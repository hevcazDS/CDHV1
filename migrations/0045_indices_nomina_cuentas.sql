-- 0045: índices de la superficie nueva (3er comité, Rendimiento) + cuentas de
-- pasivo para asentar correctamente la nómina (Forense + RH): IMSS patronal y
-- retenciones por pagar. (Mirror en db/schema.sql.)

-- Índices (vías calientes: reportes de fiado, watcher, libroMayor, calendario)
CREATE INDEX IF NOT EXISTS idx_pedidos_a_credito     ON pedidos(a_credito, fiado_vence_en);
CREATE INDEX IF NOT EXISTS idx_asientos_det_asiento  ON asientos_detalle(id_asiento);
CREATE INDEX IF NOT EXISTS idx_preventas_llegada     ON preventas(activa, fecha_llegada_est);
CREATE INDEX IF NOT EXISTS idx_oc_estatus_llegada    ON ordenes_compra(estatus, fecha_llegada_est);
CREATE INDEX IF NOT EXISTS idx_guias_envio_est       ON guias_estafeta(fecha_envio_est);

-- Cuentas de pasivo para la nómina (antes el asiento cargaba el bruto a 601 y
-- abonaba el bruto a Bancos, ignorando retenciones e IMSS patronal).
INSERT OR IGNORE INTO plan_cuentas (codigo, nombre, tipo) VALUES
    ('210', 'IMSS patronal por pagar', 'pasivo'),
    ('211', 'Retenciones por pagar (ISR/IMSS)', 'pasivo');
