-- 0066_flujo_nodo_render.sql — Fase 3: columna `render` en flujo_nodo.
-- Un nodo de conversación con prompt DINÁMICO (menú/resultados/detalle) nombra
-- aquí una acción de render que envuelve el código existente (menuPrincipal,
-- formatProducts…) para reproducirlo byte-idéntico. NULL = prompt estático por
-- frase_clave. Ver DISENO_MOTOR_FLUJO.md (decisión render-hook, Fase 3).
ALTER TABLE flujo_nodo ADD COLUMN render TEXT;
