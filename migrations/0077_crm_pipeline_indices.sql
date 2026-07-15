-- 0077: índices para el pipeline CRM (hallazgo de la prueba de estrés:
-- /api/crm/pipeline pasó de ~235 ms a >1 s con 5k clientes — la subconsulta
-- del último mensaje por cv.telefono = c.telefono era table-scan por fila).
-- Espejo en db/schema.sql.
CREATE INDEX IF NOT EXISTS idx_conversaciones_telefono ON conversaciones(telefono);
CREATE INDEX IF NOT EXISTS idx_mensajes_conv_enviado ON mensajes(id_conversacion, enviado_en);
