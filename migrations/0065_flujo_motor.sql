-- 0065_flujo_motor.sql — Fase 1 del motor de flujo configurable por tenant.
-- Crea el andamiaje de datos del grafo (nodos/aristas/versión) + las columnas
-- de anticipo en citas. TODO INERTE: sin grafo activo, el intérprete (Fase 2)
-- no existe aún y el bot corre exactamente igual. Ver DISENO_MOTOR_FLUJO.md §A.3.
-- Espejado en db/schema.sql (regla CLAUDE.md: migración versionada + espejo).

-- Un grafo por instancia, versionado para revertir. Máx 1 activo (validado en app).
CREATE TABLE IF NOT EXISTS flujo_grafo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    INTEGER NOT NULL DEFAULT 1,
  giro_base  TEXT,                                  -- de qué plantilla se sembró
  activo     INTEGER NOT NULL DEFAULT 0,            -- CHECK máx 1 activo (en app)
  valido     INTEGER NOT NULL DEFAULT 0,            -- pasó el linter de grafo (§D)
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS flujo_nodo (
  id_grafo       INTEGER NOT NULL REFERENCES flujo_grafo(id) ON DELETE CASCADE,
  paso           TEXT NOT NULL,                     -- = paso_actual
  tipo           TEXT NOT NULL DEFAULT 'conversacion'
                 CHECK(tipo IN ('conversacion','sistema')),
  frase_clave    TEXT,                              -- apunta a configuracion.frase_<clave>
  accion_entrada TEXT,                              -- nombre en ACTIONS (opcional)
  params_json    TEXT NOT NULL DEFAULT '{}',        -- parámetros de la acción/nodo
  es_inicial     INTEGER NOT NULL DEFAULT 0,        -- nodo raíz del giro (usualmente MENU)
  PRIMARY KEY (id_grafo, paso)
);

CREATE TABLE IF NOT EXISTS flujo_arista (
  id_grafo    INTEGER NOT NULL REFERENCES flujo_grafo(id) ON DELETE CASCADE,
  paso        TEXT NOT NULL,                        -- nodo origen
  orden       INTEGER NOT NULL,                     -- orden de render de la opción
  label       TEXT,                                 -- lo que ve el cliente | NULL si no es opción de menú
  input       TEXT NOT NULL,                        -- '1' | 'kw:x' | 'regex:x' | 'resultado:x' | '*'
  destino     TEXT NOT NULL,                        -- paso destino
  accion      TEXT,                                 -- acción de negocio en la transición (opcional)
  params_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (id_grafo, paso, orden)
);

-- Anticipo de cita por bot (link 'generado', pago online) — CONVIVE con el cobro
-- de mostrador que ya existe (citas.id_pedido / POST /api/citas/:id/cobrar).
-- Nullable a propósito: NULL = sin flujo de anticipo (no es lo mismo que 0).
ALTER TABLE citas ADD COLUMN anticipo REAL;            -- monto anticipado
ALTER TABLE citas ADD COLUMN saldo_pendiente REAL;     -- resto a pagar en sucursal
