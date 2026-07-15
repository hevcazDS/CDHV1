-- 0072_recetas_cocina.sql — P3 de AUDITORIA_ERP_COMPLETITUD: recetas/insumos
-- (BOM plano de 1 nivel) + vista cocina. El platillo (producto vendible) se
-- compone de INSUMOS (otros productos); al COBRAR se descuentan los insumos,
-- no el platillo — el inventario del restaurante deja de ser ficción.
CREATE TABLE IF NOT EXISTS producto_insumos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto INTEGER NOT NULL REFERENCES productos(id),  -- el platillo
    id_insumo   INTEGER NOT NULL REFERENCES productos(id),  -- el ingrediente
    cantidad    REAL NOT NULL,                              -- por 1 unidad del platillo (decimal: 0.120 kg)
    UNIQUE(id_producto, id_insumo)
);
-- Vista cocina (KDS): el item de mesa se marca listo desde la pantalla de cocina.
ALTER TABLE mesa_items ADD COLUMN listo INTEGER NOT NULL DEFAULT 0;
