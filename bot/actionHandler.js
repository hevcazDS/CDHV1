// actionHandler.js — Router principal del bot
// ═══════════════════════════════════════════════════════════════
// La lógica de cada grupo de estados vive en flows/ independientes.
// Un error en un flow se captura aquí y resetea al usuario a MENU
// sin tumbar el resto del bot. Sistema de tonos en flows/_config.js
// (configurable desde el dashboard, tabla configuracion.tono_bot).
//
//   flows/_config.js     — tonos A/B/C/D + flags de módulos
//   flows/_shared.js     — helpers, constantes y servicios comunes
//   flows/menuFlow.js    — MENU, SEARCHING, WIZARD, VIEW_PRODUCT, ADD_MORE
//   flows/cartFlow.js    — SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON
//   flows/orderFlow.js   — ASK_CP, SPLIT_*, DELIVERY, PICKUP_CONFIRM
//   flows/addressFlow.js — ASK_NOMBRE..ASK_REF
//   flows/asesorFlow.js  — ASESOR, LISTA_ESPERA, SUSTITUTO, PREVENTA, CSAT, DEVOLUCION
// ═══════════════════════════════════════════════════════════════
'use strict';

const shared = require('./flows/_shared');
const { safeEqual } = require('./validators');
const ventaPreviaService = require('../services/ventaPreviaService');
const abandonoHandler = require('./handlers/abandonoHandler');
const {
    S, db, sessionManager, log,
    puntosHandler, menuPrincipal, mostrarCarrito, _RE_DEVOLUCION, t,
    registrarEscalada,
} = shared;

const FLOWS = [
    require('./flows/menuFlow'),
    require('./flows/cartFlow'),
    require('./flows/orderFlow'),
    require('./flows/addressFlow'),
    require('./flows/asesorFlow'),
];

async function handleAction(userId, session, message, client) {
    const raw    = (message.body || '').slice(0, 500).trim();          // max 500 chars
    const action = raw.toLowerCase().replace(/[^\wáéíóúüñ\s]/gi, '').trim().slice(0, 100);
    let step     = session.paso_actual;
    let data     = session.data || {};
    const tel    = userId.replace(/@.*$/, '').slice(0, 20);            // max 20 chars (teléfono)

    // ── Venta previa pendiente (POS) ────────────────────────────────
    // Un asesor armó un carrito desde el dashboard y se le mandó al
    // cliente por WhatsApp. En su primera respuesta lo metemos directo
    // a SHOW_CART para que siga el flujo normal de carrito/envío/pago
    // (no se reimplementa esa lógica aquí).
    try {
        const _ventaPrevia = ventaPreviaService.obtenerPendiente(db, tel);
        if (_ventaPrevia) {
            ventaPreviaService.marcarConsumida(db, _ventaPrevia.id);
            data = { ...data, carrito: JSON.parse(_ventaPrevia.carrito_json), origenVentaPrevia: true };
            step = S.SHOW_CART;
            sessionManager.updateSession(userId, step, data);
        }
    } catch (e) {
        log.error('Error venta previa', e);
    }

    // ── Puntos de lealtad ─────────────────────────────────────────
    // Delegado a puntosHandler.js — solo activo cuando puntos_activo=1
    const _puntosResp = puntosHandler ? puntosHandler.handle(raw, userId, tel, sessionManager, menuPrincipal) : null;
    if (_puntosResp !== null) return _puntosResp;

    // ── Motivo de abandono de carrito ────────────────────────────────
    // Solo en MENU: free-text (precio/envío/otro), nunca dígitos — 1-4 ya
    // son comandos reservados del menú principal (ver flows/menuFlow.js).
    if (step === S.MENU) {
        const _abandonoResp = abandonoHandler.handle(raw, tel);
        if (_abandonoResp) return _abandonoResp;
    }

    // ── Código de reset betatestor ────────────────────────────────
    const _BETA_CODE = process.env.BETA_RESET_CODE || '';
    if (_BETA_CODE && safeEqual(raw.trim(), _BETA_CODE)) {
        try {
            const _tel = tel;
            const _cli = db.prepare(
                'SELECT id FROM clientes WHERE telefono=? OR telefono LIKE ? OR telefono LIKE ? LIMIT 1'
            ).get(_tel, _tel + '%', '%' + _tel);

            // Desactivar FKs durante el reset
            db.pragma('foreign_keys = OFF');
            try {
                if (_cli) {
                    const _id = _cli.id;
                    db.prepare('DELETE FROM lista_espera        WHERE id_cliente=? OR telefono LIKE ?').run(_id, '%'+_tel+'%');
                    db.prepare('DELETE FROM carritos_abandonados WHERE telefono LIKE ?').run('%'+_tel+'%');
                    db.prepare('DELETE FROM alertas_reabasto    WHERE id_cliente=? OR telefono LIKE ?').run(_id, '%'+_tel+'%');
                    db.prepare('DELETE FROM valoraciones        WHERE id_cliente=?').run(_id);
                    db.prepare('DELETE FROM cola_atencion       WHERE id_cliente=?').run(_id);
                    db.prepare('DELETE FROM preventa_clientes   WHERE id_cliente=? OR telefono LIKE ?').run(_id, '%'+_tel+'%');
                    db.prepare('DELETE FROM log_eventos         WHERE id_cliente=?').run(_id);
                    db.prepare('DELETE FROM conversaciones      WHERE id_cliente=?').run(_id);
                    db.prepare('DELETE FROM cola_notificaciones WHERE destinatario LIKE ?').run('%'+_tel+'%');
                    db.prepare('UPDATE pedidos SET id_cliente=NULL WHERE id_cliente=?').run(_id);
                    db.prepare('DELETE FROM clientes            WHERE id=?').run(_id);
                } else {
                    db.prepare('DELETE FROM cola_notificaciones WHERE destinatario LIKE ?').run('%'+_tel+'%');
                    db.prepare('DELETE FROM carritos_abandonados WHERE telefono LIKE ?').run('%'+_tel+'%');
                }
            } finally {
                db.pragma('foreign_keys = ON');
            }

            sessionManager.clearSession(userId);
            log.info('Reset beta completado', { userId });
            return '🧹 Listo. Todos tus datos de prueba han sido eliminados.\n\nEscribe *hola* para empezar de cero.';
        } catch(e) {
            db.pragma('foreign_keys = ON');
            log.error('Error en reset beta', e);
            return '⚠️ Error al limpiar: ' + e.message;
        }
    }

    // Reset global
    if (['hola','inicio','menú','menu','0','salir'].includes(action)) {
        sessionManager.clearSession(userId);
        return menuPrincipal(tel);
    }

    // Detección de devolución desde cualquier estado (MENU o SEARCHING)
    if ((step === S.MENU || step === S.SEARCHING) && _RE_DEVOLUCION.test(raw)) {
        sessionManager.updateSession(userId, S.DEVOLUCION, { paso: 'bienvenida' });
        return (
            '\u21A9\uFE0F Entendido, voy a ayudarte con tu devolución.\n\n' +
            '¿Qué pasó con tu producto?\n\n' +
            '1\uFE0F\u20E3  Llegó dañado o defectuoso\n' +
            '2\uFE0F\u20E3  Producto incorrecto (me llegó otro)\n' +
            '3\uFE0F\u20E3  Llegó duplicado / ya lo tenía\n' +
            '4\uFE0F\u20E3  No funciona correctamente\n' +
            '5\uFE0F\u20E3  Otro motivo'
        );
    }

    // Atajo: "ver carrito" desde cualquier paso de búsqueda
    if (['carrito','ver carrito','mi carrito'].includes(action) && (data.carrito||[]).length > 0) {
        sessionManager.updateSession(userId, S.SHOW_CART, { ...data, _returnStep: step });
        return mostrarCarrito(data.carrito);
    }

    // ── MENU ────────────────────────────────────────────

    // ── Despacho a flows ──────────────────────────────────────────
    const isImage = !!(message.hasMedia && (message.type === 'image' || message.type === 'sticker'));
    const ctx = { userId, session, message, client, raw, action, step, data, tel, isImage };
    for (const flow of FLOWS) {
        if (!flow || !Array.isArray(flow.STEPS) || !flow.STEPS.includes(step)) continue;
        try {
            const r = await flow.handle(ctx);
            if (r !== undefined) return r;
        } catch (e) {
            log.error('Error en flow ' + step, e);
            try { sessionManager.clearSession(userId); } catch(_) {}
            return t('error_generico') || '😅 Ups, algo salió mal de nuestro lado. Escribe *hola* para volver al menú.';
        }
        break;
    }

    // ── Fallback — ningún estado manejó el mensaje ────────────────
    // Evento "fallback" para analítica/ML — el bot no entendió el mensaje
    try { const _dbFb = require('./db_connection'); _dbFb.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('fallback','whatsapp',?,?)").run((raw||'').slice(0,200), tel); } catch(e){ log.debug('No se pudo registrar evento fallback: ' + e.message); }
    sessionManager.clearSession(userId);
    return menuPrincipal(tel);
}

module.exports = { handleAction, registrarEscalada };
