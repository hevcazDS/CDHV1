-- 0058: base/IVA reales del CFDI en cuentas por pagar. La DIOT derivaba la base
-- dividiendo el total entre (1+iva_pct) plano — incorrecto con tasas mixtas,
-- exentos, IEPS o retenciones. Al importar un CFDI XML ya tenemos el subtotal
-- exacto: se guarda para que la DIOT use el IVA acreditable real cuando exista
-- (fallback al cálculo plano para las CxP capturadas a mano, sin CFDI).
ALTER TABLE cuentas_pagar ADD COLUMN base REAL;  -- subtotal exacto del CFDI (NULL = derivar plano)
ALTER TABLE cuentas_pagar ADD COLUMN iva  REAL;  -- IVA acreditable exacto del CFDI (NULL = derivar plano)
