-- 0033: nómina fiscal (LFT completa) — expediente + desglose. Toggleable con
-- nomina_fiscal_activo; sin el módulo, la nómina sencilla sigue igual.
ALTER TABLE empleados ADD COLUMN fecha_alta TEXT;
ALTER TABLE empleados ADD COLUMN departamento TEXT;
ALTER TABLE empleados ADD COLUMN comision_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE empleados ADD COLUMN metodo_pago TEXT NOT NULL DEFAULT 'transferencia';
ALTER TABLE empleados ADD COLUMN username TEXT;
ALTER TABLE empleados ADD COLUMN contacto_emergencia TEXT;
ALTER TABLE nominas ADD COLUMN horas_extra REAL NOT NULL DEFAULT 0;
ALTER TABLE nominas ADD COLUMN comisiones REAL NOT NULL DEFAULT 0;
