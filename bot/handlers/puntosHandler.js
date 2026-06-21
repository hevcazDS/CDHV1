// puntosHandler.js — Manejador de puntos de lealtad para el bot WhatsApp
// Módulo separado: se puede modificar sin tocar actionHandler.js
// El bot lo llama con handle() — si retorna null, el flujo continúa normal
// Si el sistema está desactivado, retorna null siempre (invisible para el cliente)
'use strict';

const db = require('../db_connection');
const log = require('../logger')('puntosHandler');

// Verificar si el sistema de puntos está activo en configuracion
function puntosActivo() {
    try {
        const cfg = db.prepare(
            "SELECT valor FROM configuracion WHERE clave='puntos_activo' LIMIT 1"
        ).get();
        return !cfg || cfg.valor !== '0';
    } catch(_) {
        return false; // si la tabla no existe, el sistema está inactivo
    }
}

// Función principal — retorna string si manejó el mensaje, null si no
function handle(raw, userId, tel, sessionManager, menuPrincipal) {
    // Sistema desactivado → invisible, no interceptar nada
    if (!puntosActivo()) return null;

    const rawTrim = (raw || '').trim();

    // ── Registrar ticket TK-XXXXXXXX ──────────────────────────────
    if (/^TK-[A-Z0-9]{8}$/i.test(rawTrim)) {
        try {
            const puntosService = require('./puntosService');
            const res = puntosService.reclamarTicket(rawTrim, userId);
            if (!res.ok) return '❌ ' + res.error;

            let msg =
                '⭐ *¡Puntos registrados!*\n\n' +
                '+' + res.puntosSumados + ' puntos sumados\n' +
                '📊 Saldo disponible: *' + res.puntosDisp + ' puntos*\n';

            if (res.cuponesNuevos.length) {
                msg +=
                    '\n\n🎉 *¡Ganaste ' +
                    res.cuponesNuevos.length +
                    ' cupón' + (res.cuponesNuevos.length > 1 ? 'es' : '') +
                    ' de 10% de descuento!*\n\n';
                for (const cup of res.cuponesNuevos) {
                    msg += '🏷️ Código: *' + cup.cupon + '*\n';
                    msg += '⏰ Válido hasta: ' + cup.expira + '\n';
                }
                msg += '\n_Aplícalo en tu próxima compra. No acumulable ni válido con otras ofertas._';
            } else {
                msg += '🎯 Te faltan *' + res.faltanParaSig +
                    ' puntos* para tu cupón de 10% de descuento.';
            }
            return msg;
        } catch(e) {
            log.error('Error al reclamar ticket', e);
            return '⚠️ Ocurrió un error al registrar tus puntos. Intenta de nuevo.';
        }
    }

    // ── Consultar saldo de puntos ──────────────────────────────────
    if (/mis puntos|cuantos puntos|saldo puntos|puntos tengo|cu[aá]ntos puntos/i.test(rawTrim)) {
        try {
            const puntosService = require('./puntosService');
            const saldo = puntosService.consultarSaldo(userId);

            if (!saldo || saldo.disponibles === 0) {
                return (
                    '⭐ Aún no tienes puntos acumulados.\n\n' +
                    'Escanea el QR de tu próximo ticket de compra en tienda para empezar. 🎁'
                );
            }

            const disp   = saldo.disponibles;
            const faltan = disp % 2000 === 0 ? 0 : 2000 - (disp % 2000);
            let msg =
                '⭐ *Tus puntos Julio Cepeda:*\n\n' +
                '📊 Disponibles: *' + disp + ' puntos*\n';

            if (faltan > 0) {
                msg += '🎯 Te faltan *' + faltan + ' puntos* ($' + faltan + ' en compras) para tu cupón de 10% de descuento\n';
            } else {
                msg += '🎁 ¡Tienes puntos para canjear un cupón de 10% de descuento!\n';
            }

            if (saldo.regalosActivos && saldo.regalosActivos.length) {
                msg += '\n\n🏷️ *Cupón' +
                    (saldo.regalosActivos.length > 1 ? 'es' : '') +
                    ' disponible' +
                    (saldo.regalosActivos.length > 1 ? 's' : '') + ':*\n';
                for (const r of saldo.regalosActivos) {
                    msg += '· *' + r.codigo_cupon + '* — ' + r.valor +
                        '% de descuento _(vence ' + r.expira_en + ')_\n';
                }
                msg += '\n_Aplícalo en tu próxima compra. No acumulable ni válido con otras ofertas._';
            }
            return msg;
        } catch(e) {
            log.error('Error al consultar saldo', e);
            return '⚠️ No pude consultar tus puntos. Intenta de nuevo.';
        }
    }

    // No era un mensaje de puntos — continuar flujo normal
    return null;
}

module.exports = { handle, puntosActivo };
