# PLAN DE INTEGRACIÓN — cerrar la brecha vs Odoo / Dynamics BC

Deriva de `BRECHA_ODOO_DYNAMICS.md`. Objetivo: convertir cada hallazgo aplicable
de la comparativa en trabajo concreto, priorizado por "cuánto duele en una venta
real" en una PYME mexicana. Filosofía intacta: boring-tech, sin framework, sin
tenant_id, todo aditivo/toggleable, JC byte-idéntico.

## Estado tras esta sesión
- ✅ **Timbrado CFDI 4.0 (factura + venta mostrador + nómina)** — HECHO: modelo
  key-only con Facturapi conectado de verdad (`pacProviders.js`/`pacService.js`).
  Solo falta que el cliente ingrese su API key. Era la brecha #1 dura.

## Ola 1 — completar lo fiscal MX (lo que más duele al vender) · ~3-4 días
1. **Complemento de pago (REP)** — cuando una factura PPD se cobra, el SAT exige
   timbrar un "recibo electrónico de pago". YA existe el chokepoint `marcar-pagado`
   y el UUID de la factura → agregar `pacProviders.timbrarPago()` (Facturapi
   `/v2/receipts` o payment-complement) disparado desde ahí cuando la factura es
   PPD. Esfuerzo: medio. Sin esto, quien factura a crédito queda incompleto ante el SAT.
2. **Cancelación de CFDI** — Facturapi `DELETE /v2/invoices/:id` con motivo. Botón
   "cancelar CFDI" en Pedidos cuando hay `cfdi_uuid`. Esfuerzo: bajo.
3. **Enviar el CFDI al cliente** — Facturapi devuelve PDF/XML; adjuntarlos al correo
   (ya hay `emailService`) y/o mandar el link por WhatsApp (cola_notificaciones).
   Esfuerzo: bajo. Cierra el círculo "vendí → facturé → se lo mandé".

## Ola 2 — reportería fiscal que YA tiene los datos (reporte, no captura) · ~3 días
4. **DIOT** — declaración informativa de operaciones con terceros. Los CFDI de
   proveedores YA se parsean (`cfdiService`/`compras.js`) → agregar
   `GET /api/erp/diot?mes=` que agrupa IVA acreditable por proveedor/RFC y exporta
   el TXT del SAT. Esfuerzo: medio. Es reporte sobre datos existentes.
5. **Contabilidad electrónica SAT (XML catálogo + balanza)** — el plan de cuentas
   y los asientos ya existen (`contabilidadService`) → generar el XML de catálogo
   de cuentas y balanza de comprobación mensual (namespaces del SAT). Esfuerzo:
   medio-alto (el mapeo a código agrupador SAT es lo laborioso). Solo negocios que
   lo pidan (toggle).

## Ola 3 — flujo de efectivo real · ~4-5 días
6. **Conciliación bancaria** — importar estado de cuenta (CSV/OFX del banco) y
   casar contra `links_pago`/`cuentas_pagar`. Nueva tabla `movimientos_banco` +
   pantalla de conciliación (marcar casado/pendiente). Tiene sentido DESPUÉS de la
   pasarela de pago. Esfuerzo: alto. Es lo que Dynamics BC hace bien y aquí falta.
7. **Pasarela de pago real** (stub `pagoLinkService` existe) — conectar 1 gateway
   (Clip/Mercado Pago/Stripe) por API key, mismo patrón key-only del PAC. El cobro
   sigue confluyendo en `marcar-pagado`. Esfuerzo: medio (el stub ya está armado).

## Ola 4 — recombinaciones de alto ROI (reusar lo que ya existe) · por demanda
8. **Valuación de inventario tipo Odoo** — el kardex + costeo promedio YA calculan
   el valor; falta el *reporte* "valor de inventario a fecha X por sucursal".
   Esfuerzo: bajo (query sobre datos existentes).
9. **CRM conversacional** — el bot + citas + historial de cliente YA son un CRM que
   Dynamics cobra caro; falta un *pipeline* visible (etapas lead→cliente) sobre los
   datos de `conversaciones`/`clientes`. Esfuerzo: medio.
10. **Recepción parcial de OC + 3-way match** (OC vs recepción vs factura) — la
    única pieza que falta en Compras vs Odoo. `ordenes_compra` ya tiene el detalle;
    agregar recepción por líneas parciales. Esfuerzo: medio.
11. **Panel de flota multi-cliente** (idea NetSuite, ya en cola) — status.json por
    instancia; cuando haya 3+ clientes. Esfuerzo: medio.
12. **Multi-moneda** — solo si llega cliente que compra/vende en USD. `configuracion`
    ya tiene `moneda`; falta tipo de cambio por operación. Esfuerzo: medio. NO ahora.

## Lo que NO se hace (fuera del segmento objetivo)
- Manufactura/MRP (Odoo Enterprise) — la PYME MX de retail/servicios no lo usa.
- Proyectos/timesheets — nicho distinto.
- Consolidación contable multi-empresa — el modelo instancia-por-tenant no la busca.

## Orden recomendado de ejecución
Ola 1 (complemento de pago + cancelación + envío) es lo que hace el timbrado
**vendible sin pena** — sin ellos, "factura" está a medias ante el SAT. Luego DIOT
(barato, alto valor percibido por el contador). Conciliación y pasarela después,
cuando el cliente ya opere el timbrado.
