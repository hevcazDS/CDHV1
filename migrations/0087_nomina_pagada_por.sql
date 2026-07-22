-- 0087: quién ejecutó el pago de nómina (corrida periódica). aguinaldo/finiquito
-- ya guardan el usuario en nomina_extraordinaria.usuario; la corrida de nómina
-- normal actualizaba varias filas de `nominas` a estatus='pagada' sin dejar
-- ningún rastro de quién la disparó. Espejo en db/schema.sql.
ALTER TABLE nominas ADD COLUMN pagada_por TEXT;
