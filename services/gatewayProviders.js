'use strict';
// gatewayProviders.js — adaptadores HTTP a pasarelas de pago KEY-ONLY (solo se
// necesita UNA llave/token del proveedor; ellos hospedan la página de pago y nos
// devuelven la URL). Sin SDK: https nativo, mismo estilo que pacProviders.js.
//
// Proveedores key-only soportados (un solo secreto genera un link hospedado):
//   · stripe       → Checkout Session, secret key `sk_live_...`  (Bearer)
//   · mercadopago  → Preference,       access token `APP_USR-...` (Bearer)
// (Clip/Conekta también son key-only y encajan aquí igual; se agregan cuando un
//  cliente los pida — la firma crearLink(cfg,{monto,concepto,referencia}) es la misma.)
//
// Cada adaptador: async crearLink(cfg, { monto, concepto, referencia }) →
//   { ok, url?, id?, error? }.  cfg = { api_key, ambiente }.
const https = require('https');

// POST con cuerpo crudo (JSON o form-urlencoded) + Bearer. No lanza por HTTP≠2xx.
function _post(host, ruta, headers, body) {
    return new Promise((resolve, reject) => {
        const buf = Buffer.from(body, 'utf8');
        const req = https.request({ host, path: ruta, method: 'POST', timeout: 20000,
            headers: { 'Content-Length': buf.length, ...headers } },
            (res) => {
                let data = '';
                res.on('data', c => { data += c; if (data.length > 2 * 1024 * 1024) req.destroy(); });
                res.on('end', () => { let j = null; try { j = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, body: j, raw: data }); });
            });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Timeout con la pasarela (20s)')));
        req.write(buf); req.end();
    });
}

// ── Stripe — Checkout Session (form-urlencoded) ─────────────────────────────
const stripe = {
    async crearLink(cfg, { monto, concepto, referencia }) {
        const centavos = Math.round(Number(monto) * 100);
        const base = (cfg.return_url || 'https://pago.example.com').replace(/\/$/, '');
        const params = {
            mode: 'payment',
            success_url: base + '/ok?ref=' + encodeURIComponent(referencia),
            cancel_url: base + '/cancel?ref=' + encodeURIComponent(referencia),
            client_reference_id: referencia,
            'line_items[0][quantity]': '1',
            'line_items[0][price_data][currency]': 'mxn',
            'line_items[0][price_data][unit_amount]': String(centavos),
            'line_items[0][price_data][product_data][name]': concepto || ('Pedido ' + referencia),
        };
        const form = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
        const r = await _post('api.stripe.com', '/v1/checkout/sessions',
            { Authorization: 'Bearer ' + cfg.api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, form);
        if (r.status >= 200 && r.status < 300 && r.body?.url) return { ok: true, url: r.body.url, id: r.body.id };
        return { ok: false, error: r.body?.error?.message || ('Stripe respondió ' + r.status) };
    },
};

// ── Mercado Pago — Preference (JSON) ────────────────────────────────────────
const mercadopago = {
    async crearLink(cfg, { monto, concepto, referencia }) {
        const body = JSON.stringify({
            items: [{ title: concepto || ('Pedido ' + referencia), quantity: 1, unit_price: Math.round(Number(monto) * 100) / 100, currency_id: 'MXN' }],
            external_reference: referencia,
        });
        const r = await _post('api.mercadopago.com', '/checkout/preferences',
            { Authorization: 'Bearer ' + cfg.api_key, 'Content-Type': 'application/json' }, body);
        const url = r.body?.init_point || (cfg.ambiente !== 'live' ? r.body?.sandbox_init_point : null);
        if (r.status >= 200 && r.status < 300 && url) return { ok: true, url, id: r.body.id };
        return { ok: false, error: r.body?.message || ('Mercado Pago respondió ' + r.status) };
    },
};

const PROVIDERS = { stripe, mercadopago };
function get(nombre) { return PROVIDERS[String(nombre || '').toLowerCase()] || null; }

module.exports = { get, PROVIDERS };
