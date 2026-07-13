// mesaFlow — consumo en mesa por WhatsApp (giro restaurante, módulo mesas_activo).
// El cliente abre/retoma su mesa, agrega platillos del menú y pide la cuenta; el
// mesero cobra desde el POS (mesas.js) como siempre. Reusa las tablas mesas/
// mesa_items. Se registra por giro en giroFlows.js y solo se activa con
// mesas_activo ON, así que Julio Cepeda queda byte-idéntico.
'use strict';
const db = require('../db_connection');
const sessionManager = require('../sessionManager');
const { S, getValor, moduloActivo, logEvento } = require('./_shared');
const log = require('../logger')('mesa');

const STEPS = [S.MESA_ABRIR, S.MESA_CONSUMO];

// Menú = productos activos del catálogo (no servicios). Top 9 por nombre.
function _menu() {
    try { return db.prepare("SELECT id, name, price FROM productos WHERE activo=1 AND tipo!='servicio' ORDER BY name LIMIT 9").all(); }
    catch (_) { return []; }
}

function _sucursalDefault() {
    try { return getValor('sucursal_facturacion_default', '') || null; } catch (_) { return null; }
}

function _totalMesa(idMesa) {
    return db.prepare('SELECT COALESCE(SUM(precio*cantidad),0) t FROM mesa_items WHERE id_mesa=?').get(idMesa).t;
}

function _listaMenu(menu) {
    return menu.map((p, i) => `${i + 1}️⃣  ${p.name}${p.price > 0 ? ' — $' + Number(p.price).toFixed(0) : ''}`).join('\n');
}

// Entrada desde el menú (keyword "mesa") — menuFlow delega aquí.
function iniciar(userId, data) {
    sessionManager.updateSession(userId, S.MESA_ABRIR, { ...data });
    return '🍽️ ¡Bienvenido! ¿En qué *número de mesa* estás? Escríbelo (ej: 5).';
}

async function handle(ctx) {
    const { userId, action, raw, step, data, tel } = ctx;
    if (!moduloActivo('mesas_activo')) { sessionManager.updateSession(userId, S.MENU, {}); return null; }

    if (step === S.MESA_ABRIR) {
        const numero = (raw || '').trim().slice(0, 10);
        if (!numero) return 'Escribe el número de tu mesa (ej: 5).';
        const suc = _sucursalDefault();
        // Retomar la mesa abierta con ese número, o abrir una nueva.
        let mesa = db.prepare("SELECT id FROM mesas WHERE numero=? AND estatus='abierta'" + (suc ? ' AND sucursal IS ?' : '')).get(...(suc ? [numero, suc] : [numero]));
        if (!mesa) {
            const id = db.prepare("INSERT INTO mesas (numero, estatus, sucursal) VALUES (?, 'abierta', ?)").run(numero, suc).lastInsertRowid;
            mesa = { id };
            logEvento('mesa_abierta', 'mesa ' + numero, tel);
        }
        const menu = _menu();
        if (!menu.length) { sessionManager.updateSession(userId, S.MENU, {}); return '🍽️ Aún no hay platillos en el menú. Un momento, el mesero te atiende.'; }
        sessionManager.updateSession(userId, S.MESA_CONSUMO, { ...data, mesa_id: mesa.id, mesa_numero: numero, menu });
        return `🪑 *Mesa ${numero}*. Elige un platillo:\n\n${_listaMenu(menu)}\n\n_Escribe el número del platillo, o *cuenta* para pedir tu cuenta._`;
    }

    if (step === S.MESA_CONSUMO) {
        const menu = data.menu || _menu();
        if (action === 'cuenta' || action.includes('cuenta') || action === '0') {
            db.prepare('UPDATE mesa_items SET enviado_cocina=1 WHERE id_mesa=?').run(data.mesa_id);
            const total = _totalMesa(data.mesa_id);
            logEvento('mesa_cuenta', 'mesa ' + data.mesa_numero + ' $' + total.toFixed(2), tel);
            sessionManager.updateSession(userId, S.MENU, {});
            return `🧾 *Cuenta de la mesa ${data.mesa_numero}:* $${total.toFixed(2)} MXN\n\nEl mesero pasará a cobrar. ¡Gracias por tu visita! 🙌`;
        }
        const i = parseInt(action, 10) - 1;
        if (!(i >= 0 && i < menu.length)) return `Escribe el número de un platillo (1–${menu.length}), o *cuenta* para pedir tu cuenta.`;
        const p = menu[i];
        db.prepare('INSERT INTO mesa_items (id_mesa, id_producto, nombre, precio, cantidad) VALUES (?,?,?,?,1)')
          .run(data.mesa_id, p.id, p.name, p.price);
        const total = _totalMesa(data.mesa_id);
        return `✅ *${p.name}* agregado a la mesa ${data.mesa_numero}.\n🍽️ Total actual: *$${total.toFixed(2)} MXN*\n\nOtro platillo (número) o *cuenta* para cerrar.`;
    }

    return null;
}

module.exports = { STEPS, handle, iniciar };
