-- 0030: INMUTABILIDAD de los libros (idea SAP "storno"): asientos y kardex
-- NO se editan ni borran — los errores se corrigen con documento inverso
-- (REVERSA / movimiento contrario). El candado vive en la BD, no en el
-- código. Bypass ÚNICO: configuracion.mantenimiento_bd='1' (lo usa el
-- reset de instancia de Prime y nada más).
CREATE TRIGGER IF NOT EXISTS trg_asientos_no_update BEFORE UPDATE ON asientos
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'Los asientos son inmutables: corrige con REVERSA'); END;
CREATE TRIGGER IF NOT EXISTS trg_asientos_no_delete BEFORE DELETE ON asientos
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'Los asientos son inmutables: corrige con REVERSA'); END;
CREATE TRIGGER IF NOT EXISTS trg_asientos_det_no_update BEFORE UPDATE ON asientos_detalle
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'Las partidas son inmutables: corrige con REVERSA'); END;
CREATE TRIGGER IF NOT EXISTS trg_asientos_det_no_delete BEFORE DELETE ON asientos_detalle
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'Las partidas son inmutables: corrige con REVERSA'); END;
CREATE TRIGGER IF NOT EXISTS trg_kardex_no_update BEFORE UPDATE ON inventario_movimientos
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'El kardex es inmutable: registra el movimiento contrario'); END;
CREATE TRIGGER IF NOT EXISTS trg_kardex_no_delete BEFORE DELETE ON inventario_movimientos
WHEN COALESCE((SELECT valor FROM configuracion WHERE clave='mantenimiento_bd'),'0') != '1'
BEGIN SELECT RAISE(ABORT, 'El kardex es inmutable: registra el movimiento contrario'); END;
