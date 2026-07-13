-- 0067_flujo_nodo_xy.sql — editor visual del motor (lienzo tipo ComfyUI).
-- Posición del nodo en el canvas de Prime. Nullable: sin posición el editor
-- auto-acomoda (layout por defecto). No afecta al intérprete en nada.
ALTER TABLE flujo_nodo ADD COLUMN pos_x REAL;
ALTER TABLE flujo_nodo ADD COLUMN pos_y REAL;
