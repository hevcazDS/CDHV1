'use strict';
// pacProviders.js — adaptadores HTTP a los PAC (timbrado CFDI 4.0). Sin SDK ni
// dependencias: cliente https nativo (mismo estilo hand-rolled de emailService).
//
// MODELO KEY-ONLY (Facturapi): el negocio sube su CSD UNA vez en el portal del
// PAC (facturapi.io) y obtiene un API key `sk_live_...`; nosotros SOLO guardamos
// la key y mandamos los datos como JSON — el PAC arma, sella y timbra el CFDI y
// devuelve el UUID. Así "dejar todo hecho, solo ingresar la key" es literal: el
// producto nunca toca certificados.
//
// Cada adaptador expone timbrarFactura(cfg, payload) y timbrarNomina(cfg, payload)
// y devuelve { ok, uuid?, xml?, error? }. cfg = { api_key, ambiente }.
const https = require('https');

// GET con Bearer; devuelve { status, buffer, contentType } (para bajar PDF/XML).
function _get(host, ruta, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request({ host, path: ruta, method: 'GET', timeout: 20000, headers },
            (res) => {
                const chunks = [];
                res.on('data', c => { chunks.push(c); });
                res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] }));
            });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Timeout con el PAC (20s)')));
        req.end();
    });
}

// POST JSON con Bearer/Basic; resuelve { status, body } sin lanzar por HTTP≠2xx.
function _post(host, ruta, headers, bodyObj) {
    return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify(bodyObj), 'utf8');
        const req = https.request({ host, path: ruta, method: 'POST', timeout: 20000,
            headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...headers } },
            (res) => {
                let data = '';
                res.on('data', c => { data += c; if (data.length > 5 * 1024 * 1024) req.destroy(); });
                res.on('end', () => { let j = null; try { j = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, body: j, raw: data }); });
            });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('Timeout con el PAC (20s)')); });
        req.write(body); req.end();
    });
}

// ── Facturapi (facturapi.io) — key-only, ellos guardan el CSD ───────────────
// Doc: POST https://www.facturapi.io/v2/invoices  Authorization: Bearer sk_...
const facturapi = {
    _host: 'www.facturapi.io',
    _auth(cfg) { return { Authorization: 'Bearer ' + cfg.api_key }; },
    async timbrarFactura(cfg, payload) {
        // payload ya viene con { customer, items, payment_form, use } (formato Facturapi)
        const r = await _post(this._host, '/v2/invoices', this._auth(cfg), payload);
        if (r.status >= 200 && r.status < 300 && r.body?.uuid) {
            return { ok: true, uuid: r.body.uuid, id_pac: r.body.id, total: r.body.total };
        }
        return { ok: false, error: r.body?.message || ('El PAC respondió ' + r.status), detalle: r.body };
    },
    async timbrarNomina(cfg, payload) {
        // Facturapi: type='payroll' en el mismo endpoint de invoices
        const r = await _post(this._host, '/v2/invoices', this._auth(cfg), { ...payload, type: 'payroll' });
        if (r.status >= 200 && r.status < 300 && r.body?.uuid) return { ok: true, uuid: r.body.uuid, id_pac: r.body.id };
        return { ok: false, error: r.body?.message || ('El PAC respondió ' + r.status), detalle: r.body };
    },
    // Descarga el CFDI ya timbrado. formato: 'pdf' | 'xml'. Facturapi indexa por
    // su id interno; si solo tenemos el UUID, primero lo resolvemos.
    async descargar(cfg, { id_pac, uuid, formato }) {
        let id = id_pac;
        if (!id && uuid) {
            const r = await _get(this._host, '/v2/invoices?q=' + encodeURIComponent(uuid), this._auth(cfg));
            try { const arr = JSON.parse(r.buffer.toString('utf8')); id = (arr.data || arr)[0]?.id; } catch (_) {}
        }
        if (!id) return { ok: false, error: 'No encontré el CFDI en el PAC' };
        const r = await _get(this._host, `/v2/invoices/${id}/${formato}`, this._auth(cfg));
        if (r.status >= 200 && r.status < 300) return { ok: true, buffer: r.buffer, contentType: r.contentType || (formato === 'pdf' ? 'application/pdf' : 'application/xml') };
        return { ok: false, error: 'El PAC respondió ' + r.status };
    },
};

// ── Facturama (api.facturama.mx) — Basic auth; ellos guardan el CSD del perfil ─
// Se deja el gancho listo con el mismo contrato; el mapeo de payload de Facturama
// difiere (Receiver/Items/PaymentForm) y se completa cuando un cliente lo pida.
const facturama = {
    _host: 'api.facturama.mx',
    _auth(cfg) { return { Authorization: 'Basic ' + Buffer.from(cfg.api_key).toString('base64') }; }, // api_key = "usuario:password"
    async timbrarFactura(cfg, payload) {
        const r = await _post(this._host, '/2/cfdis', this._auth(cfg), payload);
        if (r.status >= 200 && r.status < 300 && (r.body?.Complement?.TaxStamp?.Uuid || r.body?.Id)) {
            return { ok: true, uuid: r.body?.Complement?.TaxStamp?.Uuid || null, id_pac: r.body?.Id };
        }
        return { ok: false, error: r.body?.Message || ('El PAC respondió ' + r.status), detalle: r.body };
    },
    async timbrarNomina() { return { ok: false, error: 'Nómina Facturama: mapeo pendiente (usa Facturapi por ahora)' }; },
};

const PROVEEDORES = { facturapi, facturama };
function adaptador(proveedor) { return PROVEEDORES[proveedor] || null; }

module.exports = { adaptador, PROVEEDORES };
