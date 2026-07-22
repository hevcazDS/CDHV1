// stock.js — Alertas de inventario, lista de espera y CSAT
// Extraído de services/stockWatcher.js (refactor sin cambio de comportamiento).
'use strict';
const { db, log, _flagActivo, _valorConfig, _insertCola, _STAGGER_MIN, _STAGGER_MAX } = require('./_shared');
const stockService = require('../stockService');

// ── 1. Notificar lista de espera cuando llega stock ───────────────────────
function checkListaEspera() {
    if (!_flagActivo('lista_espera_activo')) return;
    const productos = db.prepare(
        `SELECT DISTINCT le.id_producto
         FROM lista_espera le
         JOIN productos p ON p.id = le.id_producto
         WHERE le.estatus='activa'
           AND COALESCE((SELECT SUM(stock) FROM inventarios WHERE id_producto=p.id), COALESCE(p.stock_tienda,0)+COALESCE(p.stock_cedis,0)+COALESCE(p.stock_exhibicion,0)) > 0`
    ).all();

    let total = 0;
    for (const { id_producto } of productos) {
        const notificados = stockService.notificarListaEspera(id_producto);
        total += notificados.length;
        if (notificados.length) {
            log.info(`Lista espera producto ${id_producto}: ${notificados.length} notificados`);
        }
    }
    return total;
}

// ── 2. Limpiar esperas expiradas (48h sin comprar) ───────────────────────
function limpiarExpiradas() {
    const expiradas = db.prepare(`
        UPDATE lista_espera
        SET estatus='expirado'
        WHERE estatus='notificado'
          AND expira_notif_en < datetime('now','localtime')
    `).run();
    if (expiradas.changes > 0) {
        log.info(`Expiradas: ${expiradas.changes} registros`);
    }
    return expiradas.changes;
}

// ── 3. Alertas de reabasto ────────────────────────────────────────────────
function checkAlertas() {
    const n = stockService.verificarAlertas();
    if (n > 0) log.info(`Alertas disparadas: ${n}`);
    return n;
}

// ── 4. Preventas con llegada real — notificar saldo pendiente ─────────────
function checkPreventas() {
    const listas = db.prepare(`
        SELECT pc.*, p.nombre_preventa, pr.name AS nombre_producto
        FROM preventa_clientes pc
        JOIN preventas p ON p.id = pc.id_preventa
        JOIN productos pr ON pr.id = p.id_producto
        WHERE p.fecha_llegada_real IS NOT NULL
          AND pc.notificado_llegada = 0
          AND pc.estatus = 'apartado'
    `).all();

    let total = 0;
    for (const pc of listas) {
        const cuerpo =
            `📦 ¡${pc.nombre_cliente || 'Hola'}! Tu *${pc.nombre_producto}* ya llegó.\n\n` +
            `📋 Folio: *${pc.folio}*\n` +
            `💰 Saldo pendiente: *$${Number(pc.saldo_pendiente).toFixed(2)} MXN*\n\n` +
            `Págalo para que te lo entreguemos. Escribe *hola* para continuar.`;

        try {
            _insertCola(pc.telefono, `Preventa lista: ${pc.nombre_producto}`, cuerpo, 'preventa_llegada');
            db.prepare('UPDATE preventa_clientes SET notificado_llegada=1 WHERE id=?').run(pc.id);
            total++;
        } catch (err) {
            log.warn('Error preventa', err);
        }
    }
    if (total > 0) log.info(`Preventas notificadas: ${total}`);
    return total;
}

// ── 5. CSAT — encuesta 24h después de entrega ────────────────────────────
function checkCSAT() {
    if (!_flagActivo('csat_activo')) return;
    // Guías marcadas como entregadas hace entre 23 y 25 horas sin valoración
    const entregas = db.prepare(`
        SELECT g.id_pedido, p.cliente, p.id_pedido AS pid
        FROM guias_estafeta g
        JOIN pedidos p ON p.id_pedido = g.id_pedido
        WHERE g.estatus_entrega = 'entregada'
          AND g.fecha_entrega_real IS NOT NULL
          AND datetime(g.fecha_entrega_real, '+23 hours') <= datetime('now','localtime')
          AND datetime(g.fecha_entrega_real, '+25 hours') >= datetime('now','localtime')
          AND NOT EXISTS (
              SELECT 1 FROM valoraciones v WHERE v.id_pedido = g.id_pedido
          )
          AND NOT EXISTS (
              SELECT 1 FROM cola_notificaciones cn
              WHERE cn.id_pedido = g.id_pedido AND cn.asunto LIKE 'CSAT%'
          )
    `).all();

    let total = 0;
    let _off = 0;
    for (const e of entregas) {
        const tel = db.prepare(
            `SELECT telefono FROM clientes WHERE nombre=? LIMIT 1`
        ).get(e.cliente)?.telefono;
        if (!tel) continue;

        const cuerpo =
            `🧸 ¡Hola! Tu pedido *${e.pid}* fue entregado.\n\n` +
            `¿Cómo calificarías tu experiencia con nosotros?\n\n` +
            `Responde del *1 al 5* ⭐\n` +
            `_(1 = Muy malo · 5 = Excelente)_`;

        try {
            _insertCola(tel, 'CSAT post-entrega', cuerpo, 'csat_post_entrega', _off);
            _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN);
            total++;
        } catch (err) {
            log.warn('Error CSAT', err);
        }
    }
    if (total > 0) log.info(`CSAT encolados: ${total}`);
    return total;
}

// ── 7. Alerta stock mínimo ───────────────────────────────────────
function checkStockMinimo() {
    const asesorTel = _valorConfig('operador_telefono', process.env.ASESOR_WHATSAPP);
    if (!asesorTel) return 0;
    const criticos = db.prepare(`
        SELECT p.name, i.sucursal, i.stock, i.stock_minimo
        FROM inventarios i JOIN productos p ON p.id = i.id_producto
        WHERE i.stock <= i.stock_minimo AND i.stock_minimo > 0 AND p.activo=1
        ORDER BY i.stock ASC LIMIT 10
    `).all();
    if (!criticos.length) return 0;
    // Solo notificar una vez al día — verificar última notificación
    try {
        const ya = db.prepare(`
            SELECT id FROM cola_notificaciones
            WHERE asunto='Alerta stock minimo'
              AND datetime(creada_en) > datetime('now','-23 hours','localtime')
            LIMIT 1
        `).get();
        if (ya) return 0;
    } catch(e) { log.debug('No se pudo verificar dedup de alerta stock mínimo: ' + e.message); }
    const resumen = criticos.map(r =>
        '· ' + r.name.slice(0,40) + ' — ' + r.sucursal + ': ' + r.stock + ' (mín ' + r.stock_minimo + ')'
    ).join('\n');
    try {
        _insertCola(asesorTel, 'Alerta: stock mínimo',
            '⚠️ *ALERTA STOCK MÍNIMO*\n\nProductos por agotarse:\n\n' + resumen + '\n\nRevisar inventario urgente.',
            'alerta_stock_minimo'
        );
        log.info('Alerta stock mínimo: ' + criticos.length + ' productos');
    } catch(e) { log.debug('No se pudo encolar alerta stock mínimo: ' + e.message); }
    return criticos.length;
}

module.exports = {
    checkListaEspera, limpiarExpiradas, checkAlertas, checkPreventas, checkCSAT, checkStockMinimo,
};
