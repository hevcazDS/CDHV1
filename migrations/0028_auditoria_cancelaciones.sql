-- 0028: rastro de cancelaciones (antifraude — quién canceló y cuándo)
ALTER TABLE pedidos ADD COLUMN cancelado_por TEXT;
ALTER TABLE pedidos ADD COLUMN cancelado_en TEXT;
