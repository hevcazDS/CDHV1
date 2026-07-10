-- 0041: tipo y fecha de baja del empleado. Antes el finiquito solo tenía un
-- flag despido_injustificado; el tipo de baja cambia la indemnización (LFT):
-- renuncia / despido justificado = sin indemnización; despido injustificado =
-- 90 días + 20/año. Guardarlos permite recalcular y documentar la baja.
-- (Mirror en db/schema.sql.)

ALTER TABLE empleados ADD COLUMN tipo_baja TEXT;   -- renuncia|despido_justificado|despido_injustificado|jubilacion
ALTER TABLE empleados ADD COLUMN fecha_baja TEXT;
