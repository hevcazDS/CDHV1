// puntosService.js — Sistema de puntos de lealtad Julio Cepeda Jugueterías
// Reglas:
//   - 1 punto por cada peso comprado (10 puntos por $10), por CUALQUIER
//     pedido pagado/confirmado (ver otorgarPuntosPorCompra) o por el bono
//     de 100 puntos del programa de referidos (ver referidosService.js) —
//     ya NO existe el escaneo de ticket físico en tienda, todo se acredita
//     automáticamente cuando el bot/dashboard confirma el pago.
//   - 2,000 puntos disponibles = 1 cupón de 10% de descuento en la próxima
//     compra (no acumulable, no válido con otras ofertas, un solo uso).
//   - Tope: máximo 4,000 puntos redimidos (= 2 cupones) en cualquier
//     ventana móvil de 30 días por cliente.
//   - Puntos vencen a los 12 meses sin movimiento.
'use strict';

const db      = require('../db_connection');
const log     = require('../logger')('puntosService');
const { registrarErrorDB } = require('../dbErrorLog');

const PUNTOS_POR_PESO      = 1;      // 1 punto = $1
const PUNTOS_REGALO        = 2000;   // puntos necesarios para una recompensa
const PCT_DESCUENTO        = 10;     // % de descuento del cupón de lealtad
const VIGENCIA_REGALO      = 90;     // días de vigencia del cupón
const MAX_PUNTOS_CANJE_30D = 4000;   // tope de puntos redimibles en ventana móvil de 30 días

// Apagador del módulo completo de puntos — mismo patrón que moduloActivo()
// de bot/flows/_config.js: por defecto INACTIVO hasta que se active
// explícitamente desde Módulos en el dashboard (ver GET /api/modulo/:clave,
// que ya trata 'puntos_activo' como default=false). Antes este archivo no
// se gateaba a sí mismo y puntosHandler.js tenía su propia copia con el
// default invertido (activo por defecto) — ese era el conflicto real entre
// lo que mostraba el dashboard y lo que el bot hacía; ahora hay una sola
// fuente de verdad.
function puntosActivo() {
    try {
        const cfg = db.prepare("SELECT valor FROM configuracion WHERE clave='puntos_activo' LIMIT 1").get();
        return !!cfg && (cfg.valor === '1' || cfg.valor === 'true');
    } catch (_) {
        return false;
    }
}

function generarCodigoRegalo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = 'LEAL-';
    for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
}

// ── Emisión de cupones por umbral de puntos ────────────────────────
// Punto de entrada único de minting: se llama después de CUALQUIER
// acreditación de puntos (compra propia vía otorgarPuntosPorCompra, o bono
// de referente vía referidosService.js). Emite 1 cupón de 10% por cada
// 2,000 puntos disponibles que el cliente aún no tenga cubiertos con un
// cupón ya emitido, respetando el tope de MAX_PUNTOS_CANJE_30D puntos
// redimidos en cualquier ventana móvil de 30 días (no calendario).
function revisarYOtorgarCupones(idCliente, telefono) {
    if (!idCliente) return { cuponesNuevos: [], topeAlcanzado: false, esPrimerCupon: false };
    const tel = (telefono || '').replace(/@.*$/, '');

    const saldo = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(idCliente);
    if (!saldo) return { cuponesNuevos: [], topeAlcanzado: false, esPrimerCupon: false };

    const disponibles = (saldo.puntos_ganados || 0) - (saldo.puntos_canjeados || 0);
    const regalosGanados = Math.floor(disponibles / PUNTOS_REGALO);
    const regalosYaGenerados = db.prepare(`
        SELECT COUNT(*) AS n FROM regalos_lealtad WHERE id_cliente=? AND estatus='activo'
    `).get(idCliente)?.n || 0;
    const regalosPosibles = regalosGanados - regalosYaGenerados;
    const esPrimerCupon = regalosYaGenerados === 0;

    if (regalosPosibles <= 0) return { cuponesNuevos: [], topeAlcanzado: false, esPrimerCupon: false };

    // Tope: máximo MAX_PUNTOS_CANJE_30D puntos redimidos (= 2 cupones de
    // 2,000) en cualquier ventana de los últimos 30 días, no por mes
    // calendario.
    const _canjeado30d = db.prepare(`
        SELECT COALESCE(SUM(-puntos),0) AS n FROM movimientos_puntos
        WHERE id_cliente=? AND tipo='canje' AND datetime(creado_en) >= datetime('now','-30 days','localtime')
    `).get(idCliente)?.n || 0;
    const _disponibleVentana        = Math.max(0, MAX_PUNTOS_CANJE_30D - _canjeado30d);
    const _regalosPermitidosVentana = Math.floor(_disponibleVentana / PUNTOS_REGALO);
    const regalosAGenerar = Math.max(0, Math.min(regalosPosibles, _regalosPermitidosVentana));
    const topeAlcanzado   = regalosAGenerar < regalosPosibles;

    // Emite un cupón de forma atómica: lo escribe en `promociones` (donde el
    // checkout lo canjea con aplicarCupon), lo registra en `regalos_lealtad`
    // (historial/dashboard) y descuenta los puntos.
    const _emitirCupon = db.transaction((cupon, hoy, expira) => {
        db.prepare(`
            INSERT INTO promociones (codigo, tipo, valor, id_producto,
                                     fecha_inicio, fecha_fin, usos_max, usos_actual, activa)
            VALUES (?, 'porcentaje', ?, NULL, ?, ?, 1, 0, 1)
        `).run(cupon, PCT_DESCUENTO, hoy, expira);
        db.prepare(`
            INSERT INTO regalos_lealtad (id_cliente, telefono, codigo_cupon, valor, puntos_usados, expira_en)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(idCliente, tel, cupon, PCT_DESCUENTO, PUNTOS_REGALO, expira);
        db.prepare(`
            INSERT INTO movimientos_puntos (id_cliente, telefono, tipo, puntos, concepto)
            VALUES (?, ?, 'canje', ?, ?)
        `).run(idCliente, tel, -PUNTOS_REGALO, 'Canje cupón ' + PCT_DESCUENTO + '% descuento');
        db.prepare(`
            UPDATE puntos_cliente SET puntos_canjeados=puntos_canjeados+? WHERE id_cliente=?
        `).run(PUNTOS_REGALO, idCliente);
    });

    const cuponesNuevos = [];
    for (let i = 0; i < regalosAGenerar; i++) {
        const cupon  = generarCodigoRegalo();
        const hoy    = new Date().toISOString().slice(0, 10);
        const expira = new Date(Date.now() + VIGENCIA_REGALO * 24 * 60 * 60_000)
            .toISOString().slice(0, 10);
        _emitirCupon(cupon, hoy, expira);
        cuponesNuevos.push({ cupon, expira, pct: PCT_DESCUENTO });
    }

    return { cuponesNuevos, topeAlcanzado, esPrimerCupon: esPrimerCupon && cuponesNuevos.length > 0 };
}

// ── Acreditar puntos por una compra ya pagada/confirmada ───────────
// Disparada una sola vez por pedido (pedidos.puntos_acreditados evita
// duplicar si /api/pagos/:id/marcar-pagado se llega a invocar dos veces)
// desde dashboard/routes/comunicacionPedidos.js. Aplica a CUALQUIER pedido
// — no solo al primero, ni solo a clientes referidos — porque ya no existe
// el escaneo de ticket físico como única vía de acreditación.
function otorgarPuntosPorCompra(idPedido) {
    if (!puntosActivo()) return null;
    if (!idPedido) return null;

    const pedido = db.prepare(
        'SELECT id_pedido, id_cliente, total, puntos_acreditados FROM pedidos WHERE id_pedido=?'
    ).get(idPedido);
    if (!pedido || !pedido.id_cliente || pedido.puntos_acreditados) return null;

    const cliente = db.prepare('SELECT id, telefono FROM clientes WHERE id=?').get(pedido.id_cliente);
    if (!cliente) return null;
    const tel    = (cliente.telefono || '').replace(/@.*$/, '');
    const puntos = Math.floor(pedido.total || 0);

    if (puntos <= 0) {
        db.prepare('UPDATE pedidos SET puntos_acreditados=1 WHERE id_pedido=?').run(idPedido);
        return null;
    }

    const _tx = db.transaction(() => {
        const saldo = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(cliente.id);
        if (saldo) {
            db.prepare("UPDATE puntos_cliente SET puntos_ganados=puntos_ganados+?, ultimo_movimiento=datetime('now','localtime') WHERE id_cliente=?").run(puntos, cliente.id);
        } else {
            db.prepare("INSERT INTO puntos_cliente (id_cliente,telefono,puntos_ganados,ultimo_movimiento) VALUES (?,?,?,datetime('now','localtime'))").run(cliente.id, tel, puntos);
        }
        db.prepare("INSERT INTO movimientos_puntos (id_cliente,telefono,tipo,puntos,concepto) VALUES (?,?,'acumulacion',?,?)").run(cliente.id, tel, puntos, 'Compra confirmada (pedido #' + idPedido + ')');
        db.prepare('UPDATE pedidos SET puntos_acreditados=1 WHERE id_pedido=?').run(idPedido);
    });
    _tx();

    const { cuponesNuevos, topeAlcanzado } = revisarYOtorgarCupones(cliente.id, tel);
    const saldoFinal  = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(cliente.id);
    const disponibles = (saldoFinal.puntos_ganados || 0) - (saldoFinal.puntos_canjeados || 0);

    if (tel) {
        let cuerpo = '⭐ ¡Ganaste *' + puntos + ' puntos* por tu compra!\n📊 Saldo disponible: *' + disponibles + ' puntos*.';
        if (cuponesNuevos.length) {
            cuerpo += '\n\n🎉 ¡Tienes ' + cuponesNuevos.length + ' cupón' + (cuponesNuevos.length > 1 ? 'es' : '') + ' de 10% de descuento!\n';
            for (const c of cuponesNuevos) cuerpo += '🏷️ Código: *' + c.cupon + '* — válido hasta ' + c.expira + '\n';
            cuerpo += '_Aplícalo en tu próxima compra. No acumulable ni válido con otras ofertas._';
        }
        if (topeAlcanzado) {
            cuerpo += '\n\n⚠️ Alcanzaste el tope de puntos redimibles en los últimos 30 días. El resto de tu saldo se mantiene disponible.';
        }
        try {
            db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus)
                VALUES ('whatsapp',?,'Puntos por tu compra',?,'pendiente')`
            ).run(tel, cuerpo);
        } catch (e) { log.debug('No se pudo notificar puntos por compra: ' + e.message); registrarErrorDB('puntosService:otorgarPuntosPorCompra', e.message, { idPedido }); }
    }

    return { puntosSumados: puntos, puntosDisp: disponibles, cuponesNuevos, idCliente: cliente.id };
}

// ── Consultar saldo desde el bot ───────────────────────────────────
function consultarSaldo(telefono) {
    const tel = telefono.replace(/@.*$/, '');
    const cli = db.prepare('SELECT id, nombre FROM clientes WHERE telefono LIKE ?').get('%' + tel + '%');
    if (!cli) return null;

    const saldo = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(cli.id);
    if (!saldo) return { puntos: 0, dispFinal: 0, faltan: 2000, regalosActivos: [], nombre: cli.nombre };

    const disp = (saldo.puntos_ganados || 0) - (saldo.puntos_canjeados || 0);
    const faltan = 2000 - (disp % 2000);

    const regalos = db.prepare(`
        SELECT codigo_cupon, valor, expira_en FROM regalos_lealtad
        WHERE id_cliente=? AND estatus='activo' AND expira_en >= date('now','localtime')
        ORDER BY expira_en ASC
    `).all(cli.id);

    return {
        nombre:         cli.nombre || '',
        puntos:         saldo.puntos_ganados || 0,
        canjeados:      saldo.puntos_canjeados || 0,
        disponibles:    disp,
        faltan:         faltan === 2000 ? 0 : faltan,
        regalosActivos: regalos,
    };
}

// ── Check mensual: clientes sin actividad en 30 días con puntos ────
function checkPuntosInactivos() {
    const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60_000)
        .toISOString().replace('T', ' ').slice(0, 19);
    const inactivos = db.prepare(`
        SELECT pc.*, c.nombre
        FROM puntos_cliente pc JOIN clientes c ON c.id = pc.id_cliente
        WHERE (pc.ultimo_movimiento IS NULL OR pc.ultimo_movimiento < ?)
          AND (pc.puntos_ganados - pc.puntos_canjeados) > 0
          AND NOT EXISTS (
              SELECT 1 FROM cola_notificaciones cn
              WHERE cn.destinatario LIKE '%' || REPLACE(pc.telefono,'@lid','') || '%'
                AND cn.asunto = 'Puntos inactivos'
                AND datetime(cn.creada_en) > datetime('now','-29 days','localtime')
          )
    `).all(hace30);

    let total = 0;
    for (const c of inactivos) {
        const disp = c.puntos_ganados - c.puntos_canjeados;
        const faltan = 2000 - (disp % 2000);
        const nombre = (c.nombre || '').split(' ')[0] || 'hola';
        const cuerpo =
            '⭐ ¡' + nombre + '! Tienes *' + disp + ' puntos* acumulados en Julio Cepeda Jugueterías.\n\n' +
            (faltan < 2000
                ? 'Te faltan solo *' + faltan + ' puntos* ($' + faltan + ' en compras) para ganar un *cupón de 10% de descuento* en tu próxima compra. 🏷️\n\n'
                : '') +
            'Recuerda que tus puntos vencen si no los usas en 12 meses.\n\n' +
            '¿Nos visitas pronto? Escribe *hola* para ver nuestro catálogo.';
        try {
            db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus)
                VALUES ('whatsapp',?,'Puntos inactivos',?,'pendiente')`
            ).run(c.telefono, cuerpo);
            total++;
        } catch(e) { log.debug('No se pudo notificar puntos inactivos: ' + e.message); registrarErrorDB('puntosService:inactivos', e.message, { telefono: c.telefono }); }
    }
    if (total > 0) log.info('Recordatorio inactivos', { total });
    return total;
}

module.exports = {
    puntosActivo,
    otorgarPuntosPorCompra,
    revisarYOtorgarCupones,
    consultarSaldo,
    checkPuntosInactivos,
    generarCodigoRegalo,
    PUNTOS_REGALO,
    PCT_DESCUENTO,
    MAX_PUNTOS_CANJE_30D,
};
