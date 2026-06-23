-- 0012_referidos_descuento_usado.sql
-- Programa de referidos: el 10% de descuento de bienvenida del cliente
-- referido debe aplicarse una sola vez (su primera compra), no en cada
-- pedido futuro -- esta columna es la marca de "ya lo usé" que consultan
-- calcularDescuentoReferido()/marcarDescuentoReferidoUsado() en
-- bot/handlers/referidosService.js antes de aplicar/cerrar el descuento.
ALTER TABLE clientes ADD COLUMN descuento_referido_usado INTEGER NOT NULL DEFAULT 0;
