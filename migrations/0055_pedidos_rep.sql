-- 0055: complemento de pago (REP). UUID del recibo electrónico de pago que se
-- timbra cuando una factura PPD (pago en parcialidades/diferido) se cobra.
ALTER TABLE pedidos ADD COLUMN rep_uuid TEXT;
