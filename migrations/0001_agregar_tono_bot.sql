-- 0001_agregar_tono_bot.sql
-- Fase JIUA 8, hallazgo #1 del comité (Datos + IA): no había forma de saber
-- con qué tono (A/B/C/D) se generó cada pedido o cada evento de log, así que
-- era imposible medir conversión por tono. Esto agrega la columna y un
-- trigger que la auto-rellena desde `configuracion.tono_bot` en cada INSERT,
-- sin tocar los ~6 sitios del código que ya insertan en estas tablas.
--
-- Idempotente: ALTER TABLE ADD COLUMN sobre una columna que ya existe lanza
-- "duplicate column name", que scripts/migrate.js tolera explícitamente;
-- CREATE TRIGGER IF NOT EXISTS ya es idempotente por sí mismo.

ALTER TABLE pedidos ADD COLUMN tono_bot TEXT;
ALTER TABLE log_eventos ADD COLUMN tono_bot TEXT;

CREATE TRIGGER IF NOT EXISTS trg_pedidos_tono_bot
AFTER INSERT ON pedidos
WHEN NEW.tono_bot IS NULL
BEGIN
    UPDATE pedidos SET tono_bot = (SELECT valor FROM configuracion WHERE clave = 'tono_bot')
    WHERE id_pedido = NEW.id_pedido;
END;

CREATE TRIGGER IF NOT EXISTS trg_log_eventos_tono_bot
AFTER INSERT ON log_eventos
WHEN NEW.tono_bot IS NULL
BEGIN
    UPDATE log_eventos SET tono_bot = (SELECT valor FROM configuracion WHERE clave = 'tono_bot')
    WHERE id = NEW.id;
END;
