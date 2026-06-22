-- 0008_sucursales_codigo_postal.sql
-- El operador no podía capturar el código postal de una sucursal desde el
-- panel Prime -- la columna no existía en ninguna tabla (ni `sucursales`
-- ni `cobertura`, que es un concepto distinto, ver db/schema.sql). Se
-- agrega nullable: no hay dato fuente para backfillear, queda pendiente
-- de captura manual desde el nuevo botón de editar sucursal.
ALTER TABLE sucursales ADD COLUMN codigo_postal TEXT;
