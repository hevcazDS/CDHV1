-- 0064: datos del empleado para el contrato laboral (F5.2 documentos). El
-- contrato de personal cruza estos datos capturados al dar de alta al empleado
-- con los del negocio. Todos nullable (empleados existentes no se rompen).
ALTER TABLE empleados ADD COLUMN fecha_nacimiento TEXT;   -- para calcular edad
ALTER TABLE empleados ADD COLUMN domicilio        TEXT;
ALTER TABLE empleados ADD COLUMN horario          TEXT;    -- ej. "Lunes a viernes 9:00-18:00"
ALTER TABLE empleados ADD COLUMN dia_descanso     TEXT;    -- ej. "Domingo"
