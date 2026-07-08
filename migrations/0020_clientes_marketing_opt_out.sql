-- 0020: opt-out de marketing (comando BAJA en el bot — LFPDPPP).
-- Solo afecta mensajes promocionales (carritos abandonados, ofertas por
-- vencer, reactivación de dormidos, masivos); los transaccionales (estatus
-- de pedido, guías, CSAT) se siguen enviando.
ALTER TABLE clientes ADD COLUMN marketing_opt_out INTEGER NOT NULL DEFAULT 0;
