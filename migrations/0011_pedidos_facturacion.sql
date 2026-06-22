-- 0011_pedidos_facturacion.sql
-- Fase 3: el ticket de venta (GET /api/pedidos/:id/ticket, modal "Ver
-- ticket" en Pedidos.jsx) no tenía ningún campo de facturación -- el
-- operador pidió poder capturar razón social y RFC por pedido para poder
-- facturar de verdad, no solo mostrar un ticket de cortesía. Ambas
-- nullable: la inmensa mayoría de pedidos nunca van a necesitar factura.
ALTER TABLE pedidos ADD COLUMN razon_social TEXT;
ALTER TABLE pedidos ADD COLUMN rfc TEXT;
