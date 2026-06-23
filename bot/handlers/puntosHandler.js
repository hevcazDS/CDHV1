// puntosHandler.js — Manejador de puntos de lealtad para el bot WhatsApp
// Módulo separado: se puede modificar sin tocar actionHandler.js
// El bot lo llama con handle() — si retorna null, el flujo continúa normal
// Si el sistema está desactivado, retorna null siempre (invisible para el cliente)
// Ya no intercepta códigos de ticket físico (TK-XXXXXXXX) — los puntos se
// acreditan automáticamente por compra o por referido (ver
// puntosService.otorgarPuntosPorCompra y referidosService.js); este módulo
// solo atiende la consulta de saldo "mis puntos".
'use strict';

const log = require('../logger')('puntosHandler');
const puntosService = require('./puntosService');

// Único punto de verdad del flag — antes este archivo tenía su propia copia
// con el default invertido (activo si nunca se tocaba la clave) mientras
// que el dashboard (GET /api/modulo/:clave) y puntosService.js ya trataban
// 'puntos_activo' como inactivo por defecto. Delegar aquí elimina ese
// conflicto.
function puntosActivo() {
    return puntosService.puntosActivo();
}

// Función principal — retorna string si manejó el mensaje, null si no
function handle(raw, userId, tel, sessionManager, menuPrincipal) {
    // Sistema desactivado → invisible, no interceptar nada
    if (!puntosActivo()) return null;

    const rawTrim = (raw || '').trim();

    // ── Consultar saldo de puntos ──────────────────────────────────
    if (/mis puntos|cuantos puntos|saldo puntos|puntos tengo|cu[aá]ntos puntos/i.test(rawTrim)) {
        try {
            const saldo = puntosService.consultarSaldo(userId);

            if (!saldo || saldo.disponibles === 0) {
                return (
                    '⭐ Aún no tienes puntos acumulados.\n\n' +
                    'Gana puntos automáticamente con cada compra, o invita a un amigo con tu código de referido. 🎁'
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
