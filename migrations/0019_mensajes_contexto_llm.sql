-- 0019_mensajes_contexto_llm.sql
-- Preparar datos para un futuro LLM: hoy `mensajes` guarda el texto pero no en
-- qué punto del flujo (paso_actual) iba la conversación ni qué intención se
-- detectó. Esas dos columnas son justo el contexto que un LLM necesita para
-- (a) entrenar/evaluar y (b) decidir a qué flujo enrutar. `intencion` queda
-- nullable: la llenará el clasificador del LLM cuando se active (llm_activo).
ALTER TABLE mensajes ADD COLUMN paso_actual TEXT;
ALTER TABLE mensajes ADD COLUMN intencion TEXT;
