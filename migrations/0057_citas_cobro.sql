-- 0057: cobro de cita/servicio. La cita guarda el servicio elegido (id+precio)
-- y el pedido generado al cobrar (id_pedido != NULL = cita cobrada). No toca el
-- CHECK de estatus: "cobrada" se infiere de id_pedido.
ALTER TABLE citas ADD COLUMN servicio_precio REAL NOT NULL DEFAULT 0;
ALTER TABLE citas ADD COLUMN id_servicio INTEGER;
ALTER TABLE citas ADD COLUMN id_pedido INTEGER;
