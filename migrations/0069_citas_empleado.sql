-- 0069_citas_empleado.sql — P2 de AUDITORIA_ERP_COMPLETITUD: citas por empleado.
-- Barbería/estética multi-staff: la cita se asigna a UN empleado (el barbero/
-- estilista que atiende). Nullable: NULL = sin asignar (compatible con todo lo
-- existente y con el bot, que agenda sin elegir persona — el negocio asigna
-- desde el panel). La comisión por servicio usa empleados.comision_pct (ya
-- existente) sobre las citas COBRADAS del empleado.
ALTER TABLE citas ADD COLUMN id_empleado INTEGER;
