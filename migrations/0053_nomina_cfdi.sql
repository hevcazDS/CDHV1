-- 0053: timbrado de recibos de nómina (CFDI 4.0 nómina). Columnas para guardar
-- el UUID que devuelve el PAC, simétrico a pedidos.cfdi_uuid.
ALTER TABLE nominas ADD COLUMN cfdi_uuid TEXT;
ALTER TABLE nominas ADD COLUMN cfdi_estatus TEXT;
