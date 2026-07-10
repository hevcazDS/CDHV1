-- 0040: fecha estimada de llegada en las órdenes de compra, para proyectar
-- las entradas de mercancía en el calendario de almacén (además de preventas).
-- (Mirror en db/schema.sql.)

ALTER TABLE ordenes_compra ADD COLUMN fecha_llegada_est TEXT;
