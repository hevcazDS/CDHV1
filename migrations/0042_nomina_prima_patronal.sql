-- 0042: prima dominical (25% por horas trabajadas en domingo, LFT Art. 71) y
-- costo patronal aproximado de IMSS (cuota del PATRÓN, ~17.5% — NO se descuenta
-- al trabajador, es gasto del negocio) en la nómina. (Mirror en db/schema.sql.)

ALTER TABLE nominas ADD COLUMN prima_dominical REAL NOT NULL DEFAULT 0;
ALTER TABLE nominas ADD COLUMN imss_patronal REAL NOT NULL DEFAULT 0;
