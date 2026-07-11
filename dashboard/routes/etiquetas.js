'use strict';
// Fase 3 (trazabilidad de datos para entrenar un LLM): revisión humana de
// las etiquetas que Google Vision le puso a fotos de clientes — ver
// migrations/0003_vision_revisiones.sql y bot/index.js (sección
// "PREPROCESSOR DE IMAGEN"). También expone logs_error (migrations/
// 0004_logs_error.sql) para Beta.jsx, ya que ambos son tablas nuevas de
// esta misma fase y no amerita un tercer archivo de rutas solo para eso.
// Migrado al patrón declarativo del tronco: sin gate por-ruta (todo cae al
// gate global de sesión); sin opts.prefijo porque mezcla 3 prefijos distintos.
const fs   = require('fs');
const path = require('path');
const construirModulo = require('./_construirModulo');

const IMG_DIR = path.join(__dirname, '..', '..', 'bot', 'imagenes_clientes');
// Mismo patrón de nombre que genera bot/index.js (_tel_ts.ext) — cualquier
// cosa que no calce esta forma se rechaza antes de tocar el filesystem,
// nunca se concatena el parámetro de la URL directo a una ruta.
const _RE_ARCHIVO = /^[0-9]+_[0-9]+\.(jpg|jpeg|png|webp|gif)$/i;
const _MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

// GET /api/etiquetas?estado=pendiente|aceptada|corregida|todas (default: pendiente)
function listar(req, res, ctx, { u }) {
    const { db, json } = ctx;
    const estado = u.searchParams.get('estado') || 'pendiente';
    let sql = `
        SELECT vr.id, vr.archivo_imagen, vr.telefono, vr.estado, vr.etiqueta_corregida,
               vr.registrado_en, vr.revisado_en, vc.labels_json, vc.query_text
        FROM vision_revisiones vr
        LEFT JOIN vision_cache vc ON vc.hash = vr.hash_vision
    `;
    const params = [];
    if (estado !== 'todas') { sql += ' WHERE vr.estado = ?'; params.push(estado); }
    sql += ' ORDER BY vr.registrado_en DESC LIMIT 200';
    const rows = db.prepare(sql).all(...params).map(r => ({
        ...r,
        labels: r.labels_json ? JSON.parse(r.labels_json) : [],
        labels_json: undefined,
    }));
    return json(res, rows);
}

// GET /api/etiquetas/pendientes-count — para el ícono de notificaciones
// del header (NotificationBell.jsx), se hace polling cada 30s así que
// se mantiene como un COUNT aparte en vez de mandar la lista completa.
function pendientesCount(req, res, ctx) {
    const { db, json } = ctx;
    const { n } = db.prepare("SELECT COUNT(*) n FROM vision_revisiones WHERE estado = 'pendiente'").get();
    return json(res, { count: n });
}

// PUT /api/etiquetas/:id — Body: { accion: 'aceptar'|'corregir', etiqueta_corregida? }
function actualizar(req, res, ctx, { params }) {
    const { db, json, readBody, registrarErrorDB } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const { accion, etiqueta_corregida } = JSON.parse(body || '{}');
            if (!['aceptar', 'corregir'].includes(accion)) {
                return json(res, { ok: false, error: "accion debe ser 'aceptar' o 'corregir'" }, 400);
            }
            if (accion === 'corregir' && !String(etiqueta_corregida || '').trim()) {
                return json(res, { ok: false, error: 'Falta etiqueta_corregida' }, 400);
            }
            const estado = accion === 'aceptar' ? 'aceptada' : 'corregida';
            db.prepare(`
                UPDATE vision_revisiones
                SET estado = ?, etiqueta_corregida = ?, revisado_en = datetime('now','localtime')
                WHERE id = ?
            `).run(estado, accion === 'corregir' ? String(etiqueta_corregida).trim() : null, id);
            return json(res, { ok: true, id, estado });
        } catch (e) {
            registrarErrorDB('dashboard:etiquetas:put', e.message, { id });
            return json(res, { ok: false, error: e.message }, 500);
        }
    });
}

// GET /api/imagenes_clientes/:archivo — sirve la foto del cliente para
// que el operador la vea junto a la etiqueta de Vision. Ya está detrás
// de requireSession (gate global de /api/*); el nombre se valida contra
// _RE_ARCHIVO antes de tocar el filesystem.
function servirImagen(req, res, ctx, { params }) {
    const { json, SECURITY_HEADERS } = ctx;
    const archivo = decodeURIComponent(params[0]);
    if (!_RE_ARCHIVO.test(archivo)) return json(res, { error: 'Nombre de archivo inválido' }, 400);
    const filePath = path.join(IMG_DIR, archivo);
    if (!filePath.startsWith(IMG_DIR) || !fs.existsSync(filePath)) return json(res, { error: 'No encontrada' }, 404);
    const ext = archivo.split('.').pop().toLowerCase();
    res.writeHead(200, { 'Content-Type': _MIME[ext] || 'application/octet-stream', ...SECURITY_HEADERS });
    return res.end(fs.readFileSync(filePath));
}

// GET /api/logs_error?limite=50 — diagnóstico (ver Beta.jsx)
function logsError(req, res, ctx, { u }) {
    const { db, json } = ctx;
    const limite = Math.min(parseInt(u.searchParams.get('limite')) || 50, 200);
    const rows = db.prepare('SELECT id, proceso, motivo, contexto_json, registrado_en FROM logs_error ORDER BY id DESC LIMIT ?').all(limite);
    return json(res, rows);
}

const RUTAS = [
    { metodo: 'GET', path: '/api/etiquetas',                     handler: listar },
    { metodo: 'GET', path: '/api/etiquetas/pendientes-count',    handler: pendientesCount },
    { metodo: 'PUT', path: /^\/api\/etiquetas\/(\d+)$/,          handler: actualizar },
    { metodo: 'GET', path: /^\/api\/imagenes_clientes\/(.+)$/,   handler: servirImagen },
    { metodo: 'GET', path: '/api/logs_error',                    handler: logsError },
];

module.exports = construirModulo(RUTAS);
