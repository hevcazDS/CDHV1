'use strict';
// ── Cifrado at-rest de los secretos del PAC (TOGGLEABLE) ────────────────────
// pac_cifrado_activo (default ON) cifra password/.cer/.key/csd_pass con una
// clave derivada del secreto de instancia (transparente, sin maestra) —
// equivalente al modo 'bajo' de los respaldos. Cliente que NO quiera tanta
// seguridad lo apaga y se guardan en claro. Lectura tolerante: detecta el
// prefijo 'enc:' por valor, así conviven claros y cifrados (y cambiar el
// toggle no rompe lo ya guardado). La implementación vive en services/
// secretos.js (hogar canónico — antes estaba triplicada aquí y en gateway).
const { cifrarSecreto, descifrarSecreto } = require('./secretos');

// ── PUNTO ÚNICO de integración con el PAC (timbrado CFDI 4.0) ───────────────
// IMPLEMENTADO (key-only, Facturapi): timbrar()/timbrarNomina()/timbrarREP()
// llaman al PAC real vía pacProviders.js y guardan el UUID. Sigue con doble-gate
// y fail-closed: si el módulo facturacion_activo está OFF o faltan credenciales,
// devuelve { ok:false, pendiente:true } — NO un error. Es "inerte por config",
// no por falta de integración.
//
// Cómo se configura (todo desde el panel, sin tocar certificados):
//   1. Prime configura credenciales en Prime > General → /api/prime/pac
//      (se guardan en `configuracion`: pac_proveedor, pac_rfc, pac_ambiente,
//       pac_usuario, pac_password, pac_csd_cer, pac_csd_key, pac_csd_pass,
//       pac_serie). Sensibles: cer/key/passwords no se devuelven en el GET.
//   2. Activar el módulo `facturacion_activo`.
//   3. En timbrar(): armar el CFDI 4.0 (emisor RFC + CSD, receptor razon_social
//      /rfc del pedido, conceptos desde pedido_detalle, IVA), llamar al SDK/API
//      del PAC según pac_proveedor, y guardar el UUID en pedidos.cfdi_uuid
//      (+ cfdi_estatus='timbrado'). El PDF/XML se puede adjuntar al correo.
//
// Doble-gate: módulo facturacion_activo ON **y** credenciales completas.

function _cfg(db, clave, fb = '') { try { return db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)?.valor ?? fb; } catch (_) { return fb; } }

function cifradoActivo(db) { return _cfg(db, 'pac_cifrado_activo', '1') === '1'; } // default ON
// Lee un secreto ya descifrado (para cuando se complete el timbrado real).
function secreto(db, clave) { return descifrarSecreto(_cfg(db, clave)); }

// ¿Están cargadas las credenciales mínimas para timbrar?
// DOS modelos: (A) key-only [Facturapi/Facturama] = proveedor + api_key (el PAC
// guarda el CSD); (B) CSD propio [legacy] = proveedor + rfc + usuario + cer/key.
function esKeyOnly(prov) { return prov === 'facturapi' || prov === 'facturama'; }
function estaConfigurado(db) {
    const prov = _cfg(db, 'pac_proveedor');
    if (!prov) return false;
    if (esKeyOnly(prov)) return !!secreto(db, 'pac_api_key');
    return !!(_cfg(db, 'pac_rfc') && _cfg(db, 'pac_usuario') && _cfg(db, 'pac_csd_cer') && _cfg(db, 'pac_csd_key'));
}

// ¿Se puede timbrar? (módulo + credenciales)
function activo(db) {
    return _cfg(db, 'facturacion_activo') === '1' && estaConfigurado(db);
}

// Mapea metodo_pago del pedido → forma de pago SAT (c_FormaPago)
function _formaPagoSAT(metodo) {
    return ({ efectivo: '01', transferencia: '03', tarjeta: '04', tarjeta_credito: '04', paypal: '04', mercadopago: '04', oxxo: '01' })[String(metodo || '').toLowerCase()] || '99';
}

// Arma el payload Facturapi (JSON) desde un pedido ya con datos fiscales.
function _payloadFacturapi(db, ped, detalle) {
    const claveProd = _cfg(db, 'pac_clave_prod_sat', '01010101');
    const claveUnidad = _cfg(db, 'pac_clave_unidad', 'H87'); // pieza
    const usoCfdi = _cfg(db, 'pac_uso_cfdi', 'G03');          // gastos en general
    const regimenReceptor = _cfg(db, 'pac_regimen_receptor', '616'); // sin obligaciones (default seguro)
    return {
        customer: {
            legal_name: String(ped.razon_social || '').trim(),
            tax_id: String(ped.rfc || '').trim().toUpperCase(),
            tax_system: regimenReceptor,
            address: { zip: String(_cfg(db, 'pac_cp_receptor') || _cfg(db, 'codigo_postal') || '').replace(/\D/g, '') || undefined },
        },
        items: detalle.map(d => ({
            quantity: d.cantidad,
            product: {
                description: String(d.name || 'Producto').slice(0, 200),
                product_key: claveProd,
                unit_key: claveUnidad,
                price: Number(d.precio_unitario),   // Facturapi asume precio CON IVA incluido salvo tax_included=false
            },
        })),
        payment_form: _formaPagoSAT(ped.metodo_pago),
        use: usoCfdi,
    };
}

// Timbra un pedido → CFDI. Con proveedor+key configurados, LLAMA al PAC de verdad.
async function timbrar(db, idPedido) {
    if (_cfg(db, 'facturacion_activo') !== '1') return { ok: false, pendiente: true, motivo: 'Activa el módulo Facturación en Módulos' };
    const prov = _cfg(db, 'pac_proveedor');
    if (!estaConfigurado(db)) return { ok: false, pendiente: true, motivo: 'Configura el PAC en Prime > General (proveedor + API key)' };
    const ped = db.prepare('SELECT id_pedido, folio, razon_social, rfc, metodo_pago, cfdi_uuid FROM pedidos WHERE id_pedido=?').get(idPedido);
    if (!ped) return { ok: false, error: 'Pedido no encontrado' };
    if (ped.cfdi_uuid) return { ok: false, error: 'Este pedido ya fue timbrado', uuid: ped.cfdi_uuid };
    if (!ped.rfc || !ped.razon_social) return { ok: false, error: 'El pedido no tiene datos fiscales (RFC/razón social)' };
    const detalle = db.prepare('SELECT pd.cantidad, pd.precio_unitario, pr.name FROM pedido_detalle pd LEFT JOIN productos pr ON pr.id=pd.id_producto WHERE pd.id_pedido=?').all(idPedido);
    if (!detalle.length) return { ok: false, error: 'El pedido no tiene conceptos' };

    const adap = require('./pacProviders').adaptador(prov);
    if (!adap) return { ok: false, error: 'Proveedor de PAC no soportado: ' + prov };
    const cfg = { api_key: secreto(db, 'pac_api_key'), ambiente: _cfg(db, 'pac_ambiente', 'sandbox') };
    const payload = _payloadFacturapi(db, ped, detalle);
    try {
        const r = await adap.timbrarFactura(cfg, payload);
        if (r.ok && r.uuid) {
            db.prepare("UPDATE pedidos SET cfdi_uuid=?, cfdi_estatus='timbrado' WHERE id_pedido=?").run(r.uuid, idPedido);
            try { require('./configAudit').logCambio(db, 'cfdi_timbrado', ped.folio + ' → ' + r.uuid, 'sistema'); } catch (_) {}
            enviarComprobante(db, idPedido); // avisa al cliente (best-effort)
            return { ok: true, uuid: r.uuid, folio: ped.folio };
        }
        return { ok: false, error: r.error || 'El PAC no devolvió UUID', detalle: r.detalle };
    } catch (e) { return { ok: false, error: 'Error al conectar con el PAC: ' + e.message }; }
}

// Timbra un recibo de NÓMINA (CFDI 4.0 nómina). Mismo modelo key-only. El PAC
// (Facturapi) arma el complemento de nómina desde el JSON. Requiere que el
// empleado tenga RFC/CURP/NSS y el patrón su registro patronal + CP.
async function timbrarNomina(db, idNomina) {
    if (_cfg(db, 'facturacion_activo') !== '1') return { ok: false, pendiente: true, motivo: 'Activa el módulo Facturación' };
    const prov = _cfg(db, 'pac_proveedor');
    if (!estaConfigurado(db)) return { ok: false, pendiente: true, motivo: 'Configura el PAC en Prime > General' };
    const n = db.prepare('SELECT * FROM nominas WHERE id=?').get(idNomina);
    if (!n) return { ok: false, error: 'Nómina no encontrada' };
    if (n.cfdi_uuid) return { ok: false, error: 'Este recibo ya fue timbrado', uuid: n.cfdi_uuid };
    const emp = db.prepare('SELECT * FROM empleados WHERE id=?').get(n.id_empleado);
    if (!emp) return { ok: false, error: 'Empleado no encontrado' };
    const faltan = [];
    if (!emp.rfc) faltan.push('RFC del empleado'); if (!emp.curp) faltan.push('CURP'); if (!emp.nss) faltan.push('NSS');
    if (!_cfg(db, 'pac_registro_patronal')) faltan.push('registro patronal (Prime > General)');
    if (faltan.length) return { ok: false, error: 'Faltan datos para el recibo: ' + faltan.join(', ') };

    const adap = require('./pacProviders').adaptador(prov);
    if (!adap || !adap.timbrarNomina) return { ok: false, error: 'El proveedor ' + prov + ' no soporta nómina aún (usa Facturapi)' };
    const cfg = { api_key: secreto(db, 'pac_api_key'), ambiente: _cfg(db, 'pac_ambiente', 'sandbox') };
    // Payload de nómina Facturapi: percepciones = bruto (sueldos), deducciones = ISR + IMSS obrero.
    const payload = {
        customer: { legal_name: emp.nombre, tax_id: String(emp.rfc).toUpperCase(), tax_system: '605', address: { zip: String(_cfg(db, 'pac_cp_receptor') || '').replace(/\D/g, '') || undefined } },
        payroll: {
            type: 'O',                                   // ordinaria
            date: n.pagada_en || n.hasta,
            payment_date: n.pagada_en || n.hasta,
            initial_payment_date: n.desde, final_payment_date: n.hasta,
            days_paid: Math.max(1, Math.round((Date.parse(n.hasta) - Date.parse(n.desde)) / 86400000) + 1),
            employer_registration: _cfg(db, 'pac_registro_patronal'),
            employee: {
                curp: emp.curp, social_security_number: emp.nss,
                start_date_labor_relations: emp.creado_en?.slice(0, 10),
                contract_type: '01', regime_type: '02', union: false,
                risk_type: '1', frequency_payment: '04',
                base_salary: n.bruto, daily_salary: emp.salario_diario,
            },
            perceptions: [{ type: '001', code: '001', taxed_amount: n.bruto, exempt_amount: 0 }],
            deductions: [
                ...(n.isr > 0 ? [{ type: '002', code: '002', amount: n.isr }] : []),
                ...(n.imss > 0 ? [{ type: '001', code: '001', amount: n.imss }] : []),
            ],
        },
    };
    try {
        const r = await adap.timbrarNomina(cfg, payload);
        if (r.ok && r.uuid) {
            db.prepare("UPDATE nominas SET cfdi_uuid=?, cfdi_estatus='timbrado' WHERE id=?").run(r.uuid, idNomina);
            return { ok: true, uuid: r.uuid };
        }
        return { ok: false, error: r.error || 'El PAC no devolvió UUID', detalle: r.detalle };
    } catch (e) { return { ok: false, error: 'Error al conectar con el PAC: ' + e.message }; }
}

// Complemento de pago (REP): timbra el recibo de pago de una factura PPD ya
// cobrada. Lo dispara contabilidad manualmente (NO automático: una factura PUE
// no lleva REP). Requiere que el pedido tenga cfdi_uuid (fue facturado PPD).
// El sistema no rastrea parcialidades reales contra una factura CFDI (el abono
// de fiado es una feature de POS aparte, no ligada a facturas): cada REP que
// este código emite representa el pago TOTAL del documento en una sola
// exhibición, por lo que el saldo insoluto correcto es SIEMPRE 0 (no
// ped.total, que reportaría "sigues debiendo todo" — corregido, ver auditoría
// REVISION_CODIGO_ERP.md MEDIO 2). `payment_form` ahora usa el método de pago
// real del pedido (mismo helper que la factura principal), no '03' fijo.
// OJO (sigue pendiente, no arreglado a ciegas): `taxes: []` — el desglose de
// impuestos trasladados del complemento de pago no se arma aquí porque
// replicarlo mal en un PAC real (Facturapi) podría timbrar un CFDI incorrecto;
// validar el formato exacto contra una factura PPD real de sandbox antes de
// confiar en él para un régimen que sí lo exija.
async function timbrarREP(db, idPedido) {
    if (_cfg(db, 'facturacion_activo') !== '1' || !estaConfigurado(db)) return { ok: false, error: 'Configura el PAC y activa Facturación' };
    const ped = db.prepare('SELECT folio, razon_social, rfc, cfdi_uuid, rep_uuid, total, metodo_pago FROM pedidos WHERE id_pedido=?').get(idPedido);
    if (!ped) return { ok: false, error: 'Pedido no encontrado' };
    if (!ped.cfdi_uuid) return { ok: false, error: 'El pedido no tiene factura timbrada (el REP referencia una factura PPD)' };
    if (ped.rep_uuid) return { ok: false, error: 'Este pago ya tiene complemento (REP)', uuid: ped.rep_uuid };
    const prov = _cfg(db, 'pac_proveedor');
    const adap = require('./pacProviders').adaptador(prov);
    if (!adap?.timbrarPago) return { ok: false, error: 'El proveedor no soporta complemento de pago' };
    const cfg = { api_key: secreto(db, 'pac_api_key') };
    const payload = {
        customer: { legal_name: ped.razon_social, tax_id: String(ped.rfc || '').toUpperCase() },
        complements: [{
            type: 'pago',
            data: [{
                payment_form: _formaPagoSAT(ped.metodo_pago), date: new Date().toISOString(),
                related_documents: [{ uuid: ped.cfdi_uuid, amount: ped.total, last_balance: 0, taxes: [] }],
            }],
        }],
    };
    try {
        const r = await adap.timbrarPago(cfg, payload);
        if (r.ok && r.uuid) {
            db.prepare('UPDATE pedidos SET rep_uuid=? WHERE id_pedido=?').run(r.uuid, idPedido);
            try { require('./configAudit').logCambio(db, 'cfdi_rep', ped.folio + ' → ' + r.uuid, 'sistema'); } catch (_) {}
            return { ok: true, uuid: r.uuid };
        }
        return { ok: false, error: r.error || 'El PAC no devolvió UUID', detalle: r.detalle };
    } catch (e) { return { ok: false, error: 'Error con el PAC: ' + e.message }; }
}

// Cancela el CFDI de un pedido. motivo SAT (default '02' sin relación).
async function cancelarCFDI(db, idPedido, motivo) {
    const ped = db.prepare('SELECT cfdi_uuid, cfdi_estatus FROM pedidos WHERE id_pedido=?').get(idPedido);
    if (!ped?.cfdi_uuid) return { ok: false, error: 'Este pedido no está timbrado' };
    if (ped.cfdi_estatus === 'cancelado') return { ok: false, error: 'El CFDI ya está cancelado' };
    const prov = _cfg(db, 'pac_proveedor');
    const adap = require('./pacProviders').adaptador(prov);
    if (!adap || !adap.cancelar) return { ok: false, error: 'El proveedor no soporta cancelación' };
    const cfg = { api_key: secreto(db, 'pac_api_key') };
    try {
        const r = await adap.cancelar(cfg, { uuid: ped.cfdi_uuid, motivo: motivo || '02' });
        if (r.ok) {
            db.prepare("UPDATE pedidos SET cfdi_estatus='cancelado' WHERE id_pedido=?").run(idPedido);
            try { require('./configAudit').logCambio(db, 'cfdi_cancelado', ped.cfdi_uuid + ' motivo ' + (motivo || '02'), 'sistema'); } catch (_) {}
            return { ok: true, estatus: 'cancelado' };
        }
        return r;
    } catch (e) { return { ok: false, error: 'Error con el PAC: ' + e.message }; }
}

// Al timbrar: avisa al cliente por WhatsApp que su CFDI está listo (el PDF/XML
// se descargan desde el panel, GET /api/erp/cfdi/:id). Best-effort — no rompe el
// timbrado si falla. (Email con adjunto = follow-up, reusaría el SMTP de backup.js.)
function enviarComprobante(db, idPedido) {
    try {
        const ped = db.prepare("SELECT p.folio, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente WHERE p.id_pedido=?").get(idPedido);
        if (ped?.telefono) {
            db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Tu factura',?,'pendiente')")
                .run(ped.telefono, 'Tu factura (CFDI) del pedido ' + (ped.folio || idPedido) + ' ya está lista ✅. Pídela en el negocio si la necesitas en PDF/XML.');
        }
        return { ok: true };
    } catch (_) { return { ok: false }; }
}

// Descarga el CFDI (pdf|xml) de un RECIBO DE NÓMINA ya timbrado.
async function descargarNominaCFDI(db, idNomina, formato) {
    const fmt = formato === 'xml' ? 'xml' : 'pdf';
    const n = db.prepare('SELECT id, cfdi_uuid FROM nominas WHERE id=?').get(idNomina);
    if (!n?.cfdi_uuid) return { ok: false, error: 'Este recibo no está timbrado' };
    const adap = require('./pacProviders').adaptador(_cfg(db, 'pac_proveedor'));
    if (!adap?.descargar) return { ok: false, error: 'El proveedor no soporta descarga' };
    const r = await adap.descargar({ api_key: secreto(db, 'pac_api_key') }, { uuid: n.cfdi_uuid, formato: fmt });
    if (!r.ok) return r;
    return { ok: true, buffer: r.buffer, contentType: r.contentType, filename: 'nomina_' + idNomina + '.' + fmt };
}

// Descarga el CFDI (pdf|xml) de un pedido YA timbrado, desde el PAC.
async function descargarCFDI(db, idPedido, formato) {
    const fmt = formato === 'xml' ? 'xml' : 'pdf';
    const ped = db.prepare('SELECT folio, cfdi_uuid FROM pedidos WHERE id_pedido=?').get(idPedido);
    if (!ped?.cfdi_uuid) return { ok: false, error: 'Este pedido no está timbrado' };
    const prov = _cfg(db, 'pac_proveedor');
    const adap = require('./pacProviders').adaptador(prov);
    if (!adap || !adap.descargar) return { ok: false, error: 'El proveedor no soporta descarga' };
    const cfg = { api_key: secreto(db, 'pac_api_key') };
    const r = await adap.descargar(cfg, { uuid: ped.cfdi_uuid, formato: fmt });
    if (!r.ok) return r;
    return { ok: true, buffer: r.buffer, contentType: r.contentType, filename: (ped.folio || idPedido) + '.' + fmt };
}

module.exports = { estaConfigurado, activo, timbrar, timbrarNomina, timbrarREP, descargarCFDI, descargarNominaCFDI, cancelarCFDI, enviarComprobante, esKeyOnly, cifrarSecreto, descifrarSecreto, cifradoActivo, secreto };
