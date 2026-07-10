-- 0043: UUID del CFDI timbrado por pedido (para cuando el PAC esté integrado).
-- El timbrado real lo hará services/pacService.js con las credenciales que
-- Prime configure; aquí se guardará el folio fiscal (UUID) y su estatus.
-- (Mirror en db/schema.sql.)

ALTER TABLE pedidos ADD COLUMN cfdi_uuid TEXT;
ALTER TABLE pedidos ADD COLUMN cfdi_estatus TEXT;   -- timbrado|cancelado|null
