'use strict';
// Módulo de correo (Fase A: redacción + envío con adjuntos). Usa el SMTP
// hand-rolled + la clave de aplicación de Gmail que ya existen. Adjuntos posibles:
//   · archivos subidos a mano (base64)
//   · imagen de un producto (por id → archivo local/liga)
//   · un PDF generado al vuelo desde HTML (cotización/factura/reporte que la UI
//     ya sabe imprimir) — vía Chrome (services/pdfService), sin dependencia nueva.
// Gate gerente+ (el buzón del negocio es sensible). La bandeja de ENTRANTES (IMAP)
// es Fase B (requiere imapflow) — ver INFORME_CORREO.md.
const construirModulo = require('./_construirModulo');
const emailSvc = require('../../services/emailService');

const MAX_ADJUNTO_BYTES = 20 * 1024 * 1024;   // Gmail tope ~25 MB con overhead base64

function activo(db) {
    try { return db.prepare("SELECT valor FROM configuracion WHERE clave='correo_activo'").get()?.valor === '1'; }
    catch (_) { return false; }
}

// GET /api/correo/config — ¿módulo on? ¿SMTP configurado (clave de app)?
function configGet(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, { activo: activo(db), configurado: emailSvc.isConfigured() });
}

// GET /api/correo/enviados — registro de salientes.
function enviadosGet(req, res, ctx) {
    const { db, json } = ctx;
    const rows = db.prepare("SELECT id, para, asunto, fecha, adjuntos_json, creado_en FROM correos WHERE direccion='saliente' ORDER BY id DESC LIMIT 100").all();
    return json(res, rows.map(r => ({ ...r, adjuntos: _safe(r.adjuntos_json) })));
}
function _safe(j) { try { return JSON.parse(j || '[]'); } catch (_) { return []; } }

// POST /api/correo/enviar — { to, asunto, cuerpo(html/texto), adjuntos_manuales:
//   [{nombre,tipo,base64}], imagen_producto: id?, pdf: {html, nombre}? }
function enviarPost(req, res, ctx, { ses }) {
    const { db, json, readJson, log } = ctx;
    if (!activo(db)) return json(res, { ok: false, error: 'El módulo de correo está apagado' }, 403);
    if (!emailSvc.isConfigured()) return json(res, { ok: false, error: 'Configura el correo (usuario + clave de aplicación) en Prime' }, 400);
    return readJson(req, res, async d => {
        try {
            const to = String(d.to || '').trim();
            if (!to) return json(res, { ok: false, error: 'Falta el destinatario' }, 400);
            const cuerpo = String(d.cuerpo || '');
            const html = /<[a-z][\s\S]*>/i.test(cuerpo) ? cuerpo : ('<p>' + emailSvc.esc(cuerpo).replace(/\n/g, '<br>') + '</p>');
            const adjuntos = [];
            const metaAdj = [];

            // 1) archivos subidos a mano (base64)
            for (const a of (Array.isArray(d.adjuntos_manuales) ? d.adjuntos_manuales : [])) {
                const data = Buffer.from(String(a.base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
                if (!data.length || data.length > MAX_ADJUNTO_BYTES) continue;
                const nombre = String(a.nombre || 'adjunto').slice(0, 120);
                adjuntos.push({ nombre, tipo: a.tipo || 'application/octet-stream', data });
                metaAdj.push({ nombre, tipo: a.tipo || '', tamano: data.length });
            }

            // 2) imagen de producto (archivo local o liga externa)
            if (d.imagen_producto) {
                try {
                    const prod = db.prepare('SELECT name, url_imagen FROM productos WHERE id=?').get(Number(d.imagen_producto));
                    if (prod && prod.url_imagen) {
                        const imgP = require('../../services/imagenProducto');
                        let buf = null, nombre = (prod.name || 'producto').slice(0, 60);
                        if (imgP.esExterna(prod.url_imagen)) { /* liga externa: no se re-descarga en P0 */ }
                        else { const ruta = imgP.rutaLocal(prod.url_imagen) || imgP.rutaWhatsapp(prod.url_imagen); if (ruta) buf = require('fs').readFileSync(ruta); }
                        if (buf) { adjuntos.push({ nombre: nombre + '.webp', tipo: 'image/webp', data: buf }); metaAdj.push({ nombre: nombre + '.webp', tipo: 'image/webp', tamano: buf.length }); }
                    }
                } catch (e) { log.debug('adjuntar imagen producto: ' + e.message); }
            }

            // 3) PDF generado al vuelo desde HTML (cotización/factura/reporte)
            if (d.pdf && d.pdf.html) {
                try {
                    const pdf = await require('../../services/pdfService').htmlAPdf(String(d.pdf.html));
                    const nombre = String(d.pdf.nombre || 'documento').slice(0, 80).replace(/[^\w.\- ]/g, '') + '.pdf';
                    adjuntos.push({ nombre, tipo: 'application/pdf', data: pdf });
                    metaAdj.push({ nombre, tipo: 'application/pdf', tamano: pdf.length });
                } catch (e) { return json(res, { ok: false, error: 'No se pudo generar el PDF: ' + e.message }, 400); }
            }

            await emailSvc.enviarCorreo({ to, subject: d.asunto, html, adjuntos });
            try {
                db.prepare("INSERT INTO correos (direccion, de, para, asunto, cuerpo, adjuntos_json, fecha) VALUES ('saliente', ?,?,?,?,?, datetime('now','localtime'))")
                    .run(ses?.username || null, to, String(d.asunto || ''), cuerpo.slice(0, 20000), JSON.stringify(metaAdj));
            } catch (_) {}
            return json(res, { ok: true, adjuntos: metaAdj.length });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/correo/config',    roles: ['gerente'], handler: configGet },
    { metodo: 'GET',  path: '/api/correo/enviados',  roles: ['gerente'], handler: enviadosGet },
    { metodo: 'POST', path: '/api/correo/enviar',    roles: ['gerente'], handler: enviarPost },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/correo' });
module.exports._test = { enviarPost, configGet, enviadosGet, activo };
