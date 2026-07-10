-- 0035: índices para la superficie nueva (auditoría de rendimiento v1.08).
CREATE INDEX IF NOT EXISTS idx_asientos_fecha        ON asientos(fecha);
CREATE INDEX IF NOT EXISTS idx_links_pago_est_fecha  ON links_pago(estatus, pagado_en);
CREATE INDEX IF NOT EXISTS idx_pedidos_cobrado_por   ON pedidos(cobrado_por);
CREATE INDEX IF NOT EXISTS idx_pedidos_creado_en     ON pedidos(creado_en);
CREATE INDEX IF NOT EXISTS idx_mesas_estatus         ON mesas(estatus);
CREATE INDEX IF NOT EXISTS idx_horarios_emp_fecha    ON horarios_empleado(id_empleado, fecha);
CREATE INDEX IF NOT EXISTS idx_productos_cat         ON productos(cat);
