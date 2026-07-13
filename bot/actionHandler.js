// Router principal del bot — la lógica de cada grupo de estados vive en
// flows/ (ver DOCUMENTACION_TECNICA.md). Un error en un flow resetea al
// usuario a MENU sin tumbar el bot.
'use strict';

const shared = require('./flows/_shared');
const { safeEqual } = require('./validators');
const ventaPreviaService = require('../services/ventaPreviaService');
const abandonoHandler = require('./handlers/abandonoHandler');
const giroFlows = require('./flows/giroFlows');
const { moduloActivo } = require('./flows/_config');
const llmHandler = (() => { try { return require('./handlers/llmHandler'); } catch(_) { return { handle: async () => null }; } })();
const {
    S, db, sessionManager, log,
    puntosHandler, menuPrincipal, mostrarCarrito, _RE_DEVOLUCION, t,
    registrarEscalada, getValor,
} = shared;

const FLOWS = [
    require('./flows/menuFlow'),
    require('./flows/cartFlow'),
    require('./flows/orderFlow'),
    require('./flows/addressFlow'),
    require('./flows/asesorFlow'),
];

async function handleAction(userId, session, message, client) {
    const raw    = (message.body || '').slice(0, 500).trim();
    const action = raw.toLowerCase().replace(/[^\wáéíóúüñ\s]/gi, '').trim().slice(0, 100);
    let step     = session.paso_actual;
    let data     = session.data || {};
    const tel    = userId.replace(/@.*$/, '').slice(0, 20);

    // Venta previa pendiente (POS): a SHOW_CART para seguir el flujo normal
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

    const _puntosResp = puntosHandler ? puntosHandler.handle(raw, userId, tel, sessionManager, menuPrincipal) : null;
    if (_puntosResp !== null) return _puntosResp;

    // Motivo de abandono: solo MENU y solo free-text (1-4 son comandos del menú)
    if (step === S.MENU) {
        const _abandonoResp = abandonoHandler.handle(raw, tel);
        if (_abandonoResp) return _abandonoResp;
    }

    // Reset betatestor (BETA_RESET_CODE)
    const _BETA_CODE = process.env.BETA_RESET_CODE || '';
    if (_BETA_CODE && safeEqual(raw.trim(), _BETA_CODE)) {
        try {
            const _tel = tel;
            const _cli = db.prepare(
                'SELECT id FROM clientes WHERE telefono=? OR telefono LIKE ? OR telefono LIKE ? LIMIT 1'
            ).get(_tel, _tel + '%', '%' + _tel);

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

    // Privacidad / opt-out de marketing (LFPDPPP) — BAJA solo apaga
    // promociones, los mensajes de pedidos siguen
    if (['baja', 'no molestar'].includes(action)) {
        try { db.prepare('UPDATE clientes SET marketing_opt_out=1 WHERE telefono=?').run(tel); } catch (e) { log.warn('No se pudo registrar BAJA', e); }
        return '✅ Listo, ya no te enviaremos promociones ni ofertas.\n\nSeguirás recibiendo los mensajes de tus pedidos (confirmaciones, envíos). Si cambias de opinión escribe *ALTA*.';
    }
    if (action === 'alta') {
        try { db.prepare('UPDATE clientes SET marketing_opt_out=0 WHERE telefono=?').run(tel); } catch (e) { log.warn('No se pudo registrar ALTA', e); }
        return '🎉 ¡Bienvenido de vuelta! Volverás a recibir nuestras promociones y ofertas.\n\nEscribe *hola* para ver el menú.';
    }
    if (['privacidad', 'aviso de privacidad'].includes(action)) {
        const _negocio = (() => { try { return getValor('nombre_negocio', 'este negocio'); } catch (_) { return 'este negocio'; } })();
        const _urlAviso = (() => { try { return getValor('aviso_privacidad_url', ''); } catch (_) { return ''; } })();
        return '🔒 *Aviso de privacidad*\n\n' +
            _negocio + ' usa tus datos (nombre, teléfono y dirección) únicamente para atender tus pedidos y, si no indicas lo contrario, enviarte promociones.\n\n' +
            'No compartimos tus datos con terceros salvo lo necesario para entregar tu pedido (paquetería). Puedes ejercer tus derechos de acceso, rectificación, cancelación u oposición (ARCO) escribiendo aquí mismo con un asesor.\n\n' +
            '• Escribe *BAJA* para dejar de recibir promociones.\n' +
            '• Escribe *ASESOR* para cualquier solicitud sobre tus datos.' +
            (_urlAviso ? '\n\nAviso completo: ' + _urlAviso : '');
    }

    // Reset global
    if (['hola','inicio','menú','menu','0','salir'].includes(action)) {
        sessionManager.clearSession(userId);
        return menuPrincipal(tel);
    }

    if ((step === S.MENU || step === S.SEARCHING) && _RE_DEVOLUCION.test(raw)) {
        sessionManager.updateSession(userId, S.DEVOLUCION, { paso: 'bienvenida' });
        return (
            '↩️ Entendido, voy a ayudarte con tu devolución.\n\n' +
            '¿Qué pasó con tu producto?\n\n' +
            '1️⃣  Llegó dañado o defectuoso\n' +
            '2️⃣  Producto incorrecto (me llegó otro)\n' +
            '3️⃣  Llegó duplicado / ya lo tenía\n' +
            '4️⃣  No funciona correctamente\n' +
            '5️⃣  Otro motivo'
        );
    }

    if (['carrito','ver carrito','mi carrito'].includes(action) && (data.carrito||[]).length > 0) {
        sessionManager.updateSession(userId, S.SHOW_CART, { ...data, _returnStep: step });
        return mostrarCarrito(data.carrito);
    }

    // Dispatch a flows: universales + los del giro activo
    const isImage = !!(message.hasMedia && (message.type === 'image' || message.type === 'sticker'));
    const ctx = { userId, session, message, client, raw, action, step, data, tel, isImage };
    const _giro = (() => { try { return getValor('giro', 'jugueteria'); } catch(_) { return 'jugueteria'; } })();
    // Motor de flujo configurable: se evalúa el flag POR REQUEST (moduloActivo se
    // refresca cada 60s; cachearlo al require rompería el toggle sin reiniciar).
    // OFF (default) o sin grafo activo → el motor no participa y corre el código de hoy.
    const _motor = (() => { try { return moduloActivo('motor_flujo_activo') ? require('./flows/motor/interprete') : null; } catch(_) { return null; } })();
    const _flowsActivos = [...FLOWS, ...(_motor ? [_motor] : []), ...giroFlows.flowsDeGiro(_giro)];
    for (const flow of _flowsActivos) {
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

    // Hook de LLM antes del fallback (hoy passthrough, ver llmHandler.js)
    try {
        const _llmResp = await llmHandler.handle(raw, ctx);
        if (typeof _llmResp === 'string' && _llmResp) return _llmResp;
    } catch (e) { log.debug('Hook LLM falló (se ignora): ' + e.message); }

    // Fallback: se registra como evento (dataset de "lo que el LLM debería resolver")
    try { const _dbFb = require('./db_connection'); _dbFb.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('fallback','whatsapp',?,?)").run((raw||'').slice(0,200), tel); } catch(e){ log.debug('No se pudo registrar evento fallback: ' + e.message); }
    sessionManager.clearSession(userId);
    return menuPrincipal(tel);
}

module.exports = { handleAction, registrarEscalada };
