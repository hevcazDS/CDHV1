'use strict';
// flota.js — hub PULL de solo-lectura para el panel de flota Hevcaz y el
// consolidado multi-tienda (VIABILIDAD_MULTI_ERP §D3). Cada instancia expone
// GET /api/flota/status con un TOKEN (no la sesión del dashboard): un agregador
// central pollea todas las instancias y arma el panel del proveedor. Es
// solo-lectura: no escribe nada, no expone datos de clientes, solo el pulso del
// negocio (versión, ventas de hoy, bot online, último backup, errores).
//
// Seguridad: token dedicado en configuracion.flota_token (o env FLOTA_TOKEN).
// Si no hay token configurado, el endpoint responde 404 (apagado por defecto —
// una instancia no publica su pulso hasta que el proveedor le pone token).
// NO usa requireSession: es máquina-a-máquina. Va ANTES del candado global de
// /api/* en server.js gracias a su propio chequeo de token.
const construirModulo = require('./_construirModulo');

function _token(db) {
    try { return db.prepare("SELECT valor FROM configuracion WHERE clave='flota_token'").get()?.valor || process.env.FLOTA_TOKEN || ''; }
    catch (_) { return process.env.FLOTA_TOKEN || ''; }
}

function status(req, res, ctx) {
    const { db, json } = ctx;
    const tokenCfg = _token(db);
    if (!tokenCfg) return json(res, { ok: false, error: 'no disponible' }, 404); // apagado
    const enviado = req.headers['x-flota-token'] || (new URL(req.url, 'http://x')).searchParams.get('token') || '';
    // Comparación en tiempo constante
    const a = Buffer.from(String(enviado)); const b = Buffer.from(String(tokenCfg));
    const ok = a.length === b.length && require('crypto').timingSafeEqual(a, b);
    if (!ok) return json(res, { ok: false, error: 'token inválido' }, 401);

    const g = (clave, fb = null) => { try { return db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)?.valor ?? fb; } catch (_) { return fb; } };
    const num = (sql) => { try { return db.prepare(sql).get()?.v || 0; } catch (_) { return 0; } };
    return json(res, {
        ok: true,
        negocio: g('nombre_negocio'), giro: g('giro'),
        version: (() => { try { return require('../../package.json').version; } catch (_) { return '0'; } })(),
        ventas_hoy: num("SELECT COALESCE(SUM(monto),0) v FROM links_pago WHERE estatus='pagado' AND date(pagado_en)=date('now','localtime')"),
        pedidos_hoy: num("SELECT COUNT(*) v FROM pedidos WHERE date(creado_en)=date('now','localtime')"),
        // El estatus vivo del bot lo da pm2 (no la BD); el hub usa el último
        // registrado en bot_status_log como aproximación para el panel de flota.
        ultimo_bot_estatus: (() => { try { return db.prepare('SELECT estatus, registrado_en FROM bot_status_log ORDER BY id DESC LIMIT 1').get() || null; } catch (_) { return null; } })(),
        cola_atencion: num("SELECT COUNT(*) v FROM cola_atencion WHERE estatus='en_espera'"),
        emails_error: num("SELECT COUNT(*) v FROM cola_emails WHERE estatus='error'"),
        pagos_por_cobrar: num("SELECT COUNT(*) v FROM links_pago WHERE estatus='generado'"),
        ts: new Date().toISOString(),
    });
}

const RUTAS = [
    // Sin area/roles: el gate es el token propio (máquina-a-máquina).
    { metodo: 'GET', path: '/api/flota/status', handler: status },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/flota' });
