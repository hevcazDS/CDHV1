// stockWatcher.js — Vigilante periódico de inventario
// Solo escribe en cola_notificaciones — NUNCA llama a WhatsApp directamente
'use strict';
const fs          = require('fs');
const path        = require('path');
const db          = require('../bot/db_connection');
const log         = require('../bot/logger')('stockWatcher');
const stockService = require('./stockService');

// Lee flags de módulos del dashboard (tabla configuracion)
function _flagActivo(clave) {
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        if (!r) return clave !== 'puntos_activo';
        return r.valor === '1' || r.valor === 'true';
    } catch(_) { return true; }
}

// Lee un valor de texto de `configuracion` (no flag on/off) -- usado para
// ajustes que prime puede sobreescribir desde el dashboard sin tocar .env,
// como el teléfono del operador (antes solo ASESOR_WHATSAPP).
function _valorConfig(clave, fallback) {
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        return (r && r.valor) ? r.valor : fallback;
    } catch(_) { return fallback; }
}

// Inserta en cola_notificaciones con un tag de `campana` para poder medir
// conversión real por campaña (ver /api/metricas/campanas) — si la columna
// todavía no existe en producción, cae al INSERT sin ella y el envío de
// WhatsApp sigue funcionando igual.
// Solo campañas de marketing respetan el opt-out; transaccionales salen siempre
const _CAMPANAS_MARKETING = new Set([
    'recompra',
    'carrito_abandonado_2h', 'carrito_abandonado_24h',
    'oferta_por_vencer', 'oferta_por_vencer_24h',
    'reactivacion_dormidos',
]);
function _optOutMarketing(tel) {
    try {
        return !!db.prepare('SELECT 1 FROM clientes WHERE telefono=? AND marketing_opt_out=1').get(tel);
    } catch (_) { return false; }
}

function _insertCola(tel, asunto, cuerpo, campana) {
    if (_CAMPANAS_MARKETING.has(campana) && _optOutMarketing(tel)) return;
    try {
        db.prepare(`
            INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus, campana)
            VALUES ('whatsapp', ?, ?, ?, 'pendiente', ?)
        `).run(tel, asunto, cuerpo, campana);
    } catch (_) {
        db.prepare(`
            INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
            VALUES ('whatsapp', ?, ?, ?, 'pendiente')
        `).run(tel, asunto, cuerpo);
    }
}

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
            `\uD83D\uDCE6 \u00a1${pc.nombre_cliente || 'Hola'}! Tu *${pc.nombre_producto}* ya lleg\u00f3.\n\n` +
            `\uD83D\uDCCB Folio: *${pc.folio}*\n` +
            `\uD83D\uDCB0 Saldo pendiente: *$${Number(pc.saldo_pendiente).toFixed(2)} MXN*\n\n` +
            `P\u00e1galo para que te lo entreguemos. Escribe *hola* para continuar.`;

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
    for (const e of entregas) {
        const tel = db.prepare(
            `SELECT telefono FROM clientes WHERE nombre=? LIMIT 1`
        ).get(e.cliente)?.telefono;
        if (!tel) continue;

        const cuerpo =
            `\uD83E\uDDF8 \u00a1Hola! Tu pedido *${e.pid}* fue entregado.\n\n` +
            `\u00bfC\u00f3mo calificar\u00edas tu experiencia con nosotros?\n\n` +
            `Responde del *1 al 5* \u2b50\n` +
            `_(1 = Muy malo · 5 = Excelente)_`;

        try {
            _insertCola(tel, 'CSAT post-entrega', cuerpo, 'csat_post_entrega');
            total++;
        } catch (err) {
            log.warn('Error CSAT', err);
        }
    }
    if (total > 0) log.info(`CSAT encolados: ${total}`);
    return total;
}

// ── 6. Carritos abandonados — notificar a las 2h ─────────────────────────
function checkCarritosAbandonados() {
    if (!_flagActivo('carritos_activo')) return;
    const abandonados = db.prepare(`
        SELECT * FROM carritos_abandonados
        WHERE notificado = 0
          AND convertido = 0
          AND datetime(abandonado_en, '+2 hours') <= datetime('now','localtime')
    `).all();

    let total = 0;
    for (const ca of abandonados) {
        let items = [];
        try { items = JSON.parse(ca.carrito_json); } catch (_) { continue; }
        if (!items.length) continue;

        const resumen = items.slice(0, 2).map(i => '· ' + i.name).join('\n');
        const mas     = items.length > 2 ? '\n· ...y ' + (items.length - 2) + ' más' : '';
        const tel     = ca.telefono;

        // Verificar si algún producto del carrito tiene oferta próxima a vencer
        const _hoy = new Date().toISOString().slice(0, 10);
        const _manana = new Date(Date.now() + 48*60*60_000).toISOString().slice(0, 10);
        const _conOferta = items.filter(i => i._esOferta && i._fechaVence && i._fechaVence <= _manana);

        let cuerpo;
        if (_conOferta.length) {
            // Mensaje urgente — oferta por vencer
            cuerpo =
                '⚠️ *¡Tu oferta está por vencer!*\n\n' +
                _conOferta.map(i =>
                    '🏷️ *' + i.name + '*\n' +
                    '~~$' + Number(i._precioOriginal).toFixed(2) + '~~ → *$' + Number(i.price).toFixed(2) + ' MXN* (-' + i._descuento + '%)\n' +
                    '⏰ Vence el ' + i._fechaVence
                ).join('\n\n') +
                '\n\n¡Aparta tu precio antes de que se acabe! Escribe *hola* para continuar.';
        } else {
            cuerpo =
                '\uD83D\uDED2 \u00a1Oye! Dejaste productos en tu carrito:\n\n' +
                resumen + mas + '\n\n' +
                'Te lo tengo apartado, pero el stock se mueve r\u00e1pido \u26a1\n\u00bfContinuamos? Escribe *hola* para retomarlo.';
        }
        cuerpo += '\n\n\uD83D\uDCAC Por cierto, \u00bfqu\u00E9 te detuvo? Responde *precio*, *env\u00EDo* u *otro* \u2014 nos ayuda a mejorar.';

        try {
            _insertCola(tel, _conOferta.length ? 'Oferta por vencer' : 'Carrito abandonado', cuerpo,
                _conOferta.length ? 'oferta_por_vencer' : 'carrito_abandonado_2h');

            db.prepare('UPDATE carritos_abandonados SET notificado=1, notificado_en=datetime("now","localtime") WHERE id=?')
              .run(ca.id);
            total++;
        } catch (err) {
            log.warn('Error carrito abandonado', err);
        }
    }
    if (total > 0) log.info('Carritos abandonados notificados: ' + total);
    return total;
}

// ── 6b. Carrito abandonado 24h — incentivo de 5% para cerrar la venta ────
// ponytail: ventana fija 24-48h y cupón fijo de 5%/48h; ajustar si se quiere
// probar otro % o plazo.
function checkCarritosAbandonados24h() {
    if (!_flagActivo('carritos_activo')) return;
    const abandonados = db.prepare(`
        SELECT * FROM carritos_abandonados
        WHERE convertido = 0
          AND datetime(abandonado_en, '+24 hours') <= datetime('now','localtime')
          AND datetime(abandonado_en, '+48 hours') >  datetime('now','localtime')
    `).all();

    let total = 0;
    for (const ca of abandonados) {
        const yaAvisado = db.prepare(`
            SELECT id FROM cola_notificaciones
            WHERE (destinatario = ? OR destinatario LIKE ?) AND asunto='Carrito abandonado 24h'
        `).get(ca.telefono, ca.telefono + '@%');
        if (yaAvisado) continue;

        let items = [];
        try { items = JSON.parse(ca.carrito_json); } catch (_) { continue; }
        if (!items.length) continue;

        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let codigo = 'VUELVE-';
        for (let i = 0; i < 5; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
        const hoy    = new Date().toISOString().slice(0, 10);
        const expira = new Date(Date.now() + 48 * 60 * 60_000).toISOString().slice(0, 10);

        // Descuento variable por lead_score — clientes más valiosos reciben
        // mejor incentivo en lugar del 5% fijo para todos.
        let descuento = 5;
        try {
            const cli = db.prepare('SELECT lead_score FROM clientes WHERE telefono=? LIMIT 1').get(ca.telefono);
            const score = cli?.lead_score || 0;
            if (score >= 50) descuento = 15;
            else if (score >= 20) descuento = 10;
        } catch (e) { log.debug('No se pudo leer lead_score para descuento: ' + e.message); }

        try {
            db.prepare(`
                INSERT INTO promociones (codigo, tipo, valor, id_producto, fecha_inicio, fecha_fin, usos_max, usos_actual, activa)
                VALUES (?, 'porcentaje', ?, NULL, ?, ?, 1, 0, 1)
            `).run(codigo, descuento, hoy, expira);

            const resumen = items.slice(0, 2).map(i => '· ' + i.name).join('\n');
            const mas     = items.length > 2 ? '\n· ...y ' + (items.length - 2) + ' más' : '';
            const cuerpo =
                '🎁 ¿Sigues pensándolo? Va un *' + descuento + '% de descuento* para que termines tu compra:\n\n' +
                resumen + mas + '\n\n' +
                '🏷️ Código: *' + codigo + '*\n' +
                '⏰ Válido 48 horas — escribe *hola* para continuar. _No acumulable con otras promos._' +
                '\n\n💬 Por cierto, ¿qué te detuvo? Responde *precio*, *envío* u *otro* — nos ayuda a mejorar.';

            _insertCola(ca.telefono, 'Carrito abandonado 24h', cuerpo, 'carrito_abandonado_24h');
            total++;
        } catch (err) {
            log.warn('Error carrito 24h', err);
        }
    }
    if (total > 0) log.info('Carritos 24h con cupón: ' + total);
    return total;
}

// ── Check adicional: oferta por vencer en 24h ─────────────────────
function checkOfertasPorVencer() {
    if (!_flagActivo('ofertas_activo')) return;
    const manana = new Date(Date.now() + 24*60*60_000).toISOString().slice(0, 10);
    // Buscar carritos NO convertidos con items de oferta que vencen mañana
    const carritos = db.prepare(`
        SELECT * FROM carritos_abandonados
        WHERE convertido = 0
          AND carrito_json LIKE '%_esOferta%'
          AND carrito_json LIKE '%' || ? || '%'
    `).all(manana);

    let total = 0;
    for (const ca of carritos) {
        let items = [];
        try { items = JSON.parse(ca.carrito_json); } catch(_) { continue; }
        const vencen = items.filter(i => i._esOferta && i._fechaVence === manana);
        if (!vencen.length) continue;

        // Verificar si ya notificamos de oferta por vencer
        const yaAvisado = db.prepare(`
            SELECT id FROM cola_notificaciones
            WHERE (destinatario = ? OR destinatario LIKE ?) AND asunto='Oferta por vencer 24h'
              AND datetime(creada_en) > datetime('now','-23 hours','localtime')
        `).get(ca.telefono, ca.telefono + '@%');
        if (yaAvisado) continue;

        const cuerpo =
            '🔔 *¡Última oportunidad!*\n\n' +
            'Tienes una oferta que vence *mañana*:\n\n' +
            vencen.map(i =>
                '🏷️ *' + i.name + '*\n' +
                '~~$' + Number(i._precioOriginal).toFixed(2) + '~~ → *$' + Number(i.price).toFixed(2) + ' MXN* (-' + i._descuento + '%)'
            ).join('\n\n') +
            '\n\nEscribe *hola* para finalizar tu compra antes de que se acabe el precio especial.';

        try {
            _insertCola(ca.telefono, 'Oferta por vencer 24h', cuerpo, 'oferta_por_vencer_24h');
            total++;
        } catch(e) { log.debug('No se pudo encolar oferta por vencer: ' + e.message); }
    }
    if (total > 0) log.info('Alertas oferta por vencer: ' + total);
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

// ── 8. Seguimiento 48h post-pedido ────────────────────────────────
// Recordatorio de CITA: un día antes (o el mismo día si se agendó hoy para
// mañana ya pasó el ciclo). Marca recordatorio_enviado para no duplicar.
function checkRecordatoriosCitas() {
    let citas;
    try {
        citas = db.prepare(`
            SELECT id, telefono, nombre, fecha, hora FROM citas
            WHERE estatus IN ('pendiente','confirmada') AND recordatorio_enviado = 0
              AND fecha = date('now','localtime','+1 day')
        `).all();
    } catch (_) { return; } // tabla ausente (BD sin migrar) → silencio
    for (const c of citas) {
        _insertCola(c.telefono, 'Recordatorio cita ' + c.id,
            `📅 ¡Hola${c.nombre ? ' ' + c.nombre.split(' ')[0] : ''}! Te recordamos tu cita de *mañana ${c.fecha.slice(8)}/${c.fecha.slice(5,7)}* a las *${c.hora}*.

Si necesitas cambiarla, responde este mensaje. ¡Te esperamos!`,
            'recordatorio_cita');
        db.prepare('UPDATE citas SET recordatorio_enviado=1 WHERE id=?').run(c.id);
    }
    if (citas.length) log.info(`[stockWatcher] ${citas.length} recordatorio(s) de cita encolados`);
}

function checkSeguimiento48h() {
    const pedidos = db.prepare(`
        SELECT g.id_pedido, p.cliente, c.telefono, c.nombre
        FROM guias_estafeta g
        JOIN pedidos p  ON p.id_pedido = g.id_pedido
        JOIN clientes c ON c.id = p.id_cliente
        WHERE g.estatus_entrega = 'entregada'
          AND g.fecha_entrega_real IS NOT NULL
          AND datetime(g.fecha_entrega_real, '+47 hours') <= datetime('now','localtime')
          AND datetime(g.fecha_entrega_real, '+49 hours') >= datetime('now','localtime')
          AND NOT EXISTS (
              SELECT 1 FROM cola_notificaciones cn
              WHERE cn.asunto LIKE '%seguimiento%' || g.id_pedido || '%'
          )
    `).all();

    let total = 0;
    for (const e of pedidos) {
        if (!e.telefono) continue;
        const nombre = (e.nombre || '').split(' ')[0] || 'hola';
        const cuerpo = '\uD83D\uDCE6 \u00a1' + nombre + '! Tu pedido lleg\u00f3 hace dos d\u00edas.\n\n\u00bfLleg\u00f3 todo bien? \uD83E\uDDF8\n\nSi necesitas algo con gusto te ayudo. Escr\u00edbeme.';
        try {
            _insertCola(e.telefono, 'Seguimiento 48h pedido ' + e.id_pedido, cuerpo, 'seguimiento_48h');
            total++;
        } catch(e) { log.debug('No se pudo encolar seguimiento 48h: ' + e.message); }
    }
    if (total > 0) log.info('Seguimiento 48h: ' + total + ' mensajes');
    return total;
}

// ── 8.5. Quejas/escaladas sin respuesta del asesor en 2h — re-escalar ────
// registrarEscalada() (bot/flows/_shared.js) crea la fila en cola_atencion y
// avisa al asesor una vez; si nadie la atiende, se queda silenciosa. Esto
// vuelve a avisar (marcado URGENTE) y sube la prioridad — una sola vez por
// caso (reescalada_en se marca al re-avisar, así no se repite cada ciclo).
function checkQuejasSinRespuesta() {
    const asesorTel = _valorConfig('operador_telefono', process.env.ASESOR_WHATSAPP);
    if (!asesorTel) return 0;

    const pendientes = db.prepare(`
        SELECT ca.id, ca.motivo_escalada, ca.tipo, ca.caso, c.nombre, c.telefono
        FROM cola_atencion ca
        LEFT JOIN clientes c ON c.id = ca.id_cliente
        WHERE ca.estatus = 'en_espera'
          AND ca.reescalada_en IS NULL
          AND datetime(ca.creada_en, '+2 hours') <= datetime('now','localtime')
    `).all();

    let total = 0;
    for (const q of pendientes) {
        const nombre = (q.nombre || 'Cliente').split(' ')[0];
        const cuerpo =
            '⏰ *Caso sin atender desde hace 2h — dale prioridad*\n\n' +
            'Cliente: ' + nombre + ' (' + (q.telefono || '—') + ')\n' +
            'Motivo: ' + (q.motivo_escalada || q.tipo || 'Solicitud') +
            (q.caso ? '\nCaso: ' + q.caso : '');
        try {
            _insertCola(asesorTel, 'Queja sin atender', cuerpo, 'queja_timeout');
            db.prepare(`
                UPDATE cola_atencion SET prioridad = prioridad + 1, reescalada_en = datetime('now','localtime')
                WHERE id = ?
            `).run(q.id);
            total++;
        } catch (err) {
            log.warn('Error re-escalando queja', err);
        }
    }
    if (total > 0) log.info('Quejas re-escaladas por timeout: ' + total);
    return total;
}

// ── Recompra de consumibles (cliente) — recordar cuando se le acaba ─────
// Busca clientes que compraron un producto tipo 'consumible' hace ~N días
// (config recompra_dias, def 30) y no han vuelto a comprar ESE producto; les
// recuerda recomprarlo. Dedupe: no repetir la campaña al mismo tel en 20 días.
// Gate: módulo recompra_activo.
function checkRecompraConsumibles() {
    if (!_flagActivo('recompra_activo')) return;
    let dias = parseInt(_valorConfig ? _valorConfig('recompra_dias', '30') : '30', 10);
    if (!Number.isFinite(dias) || dias < 1) dias = 30;
    let filas;
    try {
        filas = db.prepare(`
            SELECT c.telefono, c.nombre, pr.name producto, MAX(p.creado_en) ultima
            FROM pedido_detalle d
            JOIN pedidos p ON p.id_pedido = d.id_pedido
            JOIN productos pr ON pr.id = d.id_producto AND pr.tipo = 'consumible'
            JOIN clientes c ON c.id = p.id_cliente
            WHERE c.telefono IS NOT NULL AND c.telefono != ''
              AND COALESCE(c.tags,'') NOT LIKE '%troll%'
            GROUP BY c.telefono, d.id_producto
            HAVING MAX(p.creado_en) <= datetime('now','localtime','-' || ? || ' days')
               AND MAX(p.creado_en) >  datetime('now','localtime','-' || ? || ' days')
        `).all(dias, dias + 7); // ventana de 7 días para no perseguir viejos
    } catch (_) { return; }
    let total = 0;
    for (const f of filas) {
        // dedupe: ¿ya se le mandó recompra en 20 días?
        const ya = db.prepare(`SELECT 1 FROM cola_notificaciones WHERE (destinatario=? OR destinatario LIKE ?) AND campana='recompra' AND datetime(creada_en) > datetime('now','-20 days','localtime') LIMIT 1`).get(f.telefono, f.telefono + '@%');
        if (ya) continue;
        const nombre = (f.nombre || '').split(' ')[0];
        const cuerpo = '¡Hola' + (nombre ? ' ' + nombre : '') + '! ¿Ya se te acabó tu *' + f.producto + '*? 🛒\n\nEscribe *hola* y te lo dejo listo para recomprar en un momento.';
        _insertCola(f.telefono, 'Recompra ' + f.producto, cuerpo, 'recompra');
        total++;
    }
    if (total > 0) log.info('[stockWatcher] ' + total + ' recordatorio(s) de recompra de consumibles');
    return total;
}

// ── 9. Clientes dormidos — reactivación a los 40 días sin compra ────────
// Se espacía de los masivos (cada ~15 días) para no aturdir con publicidad:
// si el cliente ya recibió un masivo o esta misma campaña en los últimos 15
// días, se espera al siguiente ciclo (eso también limita esta campaña a
// como máximo una vez cada 15 días por cliente).
// ponytail: umbrales fijos (40d disparo, 15d anti-choque); ajustar si cambia el ritmo de masivos.
function checkClientesDormidos() {
    if (!_flagActivo('reactivacion_activo')) return;
    const dormidos = db.prepare(`
        SELECT c.id, c.telefono, c.nombre, MAX(p.creado_en) AS ultima_compra
        FROM clientes c
        JOIN pedidos p ON p.id_cliente = c.id
        WHERE c.activo = 1 AND c.telefono IS NOT NULL AND c.telefono != ''
          AND COALESCE(c.tags,'') NOT LIKE '%troll%'
          AND COALESCE(c.tags,'') NOT LIKE '%blacklist%'
        GROUP BY c.id
        HAVING datetime(MAX(p.creado_en), '+40 days') <= datetime('now','localtime')
    `).all();

    let total = 0;
    for (const cli of dormidos) {
        // No chocar con un masivo reciente ni repetir esta campaña antes de 15 días
        const yaPromocionado = db.prepare(`
            SELECT id FROM cola_notificaciones
            WHERE (destinatario = ? OR destinatario LIKE ?)
              AND (asunto = 'Promocion masiva' OR asunto = 'Cliente dormido')
              AND datetime(creada_en) > datetime('now','-15 days','localtime')
        `).get(cli.telefono, cli.telefono + '@%');
        if (yaPromocionado) continue;

        const nombre = (cli.nombre || '').split(' ')[0] || 'Hola';
        const negocio = _valorConfig('nombre_negocio', 'nuestra tienda');
        const cuerpo =
            '¡Hola ' + nombre + '! Te extrañamos en ' + negocio + '.\n\n' +
            'Hay novedades desde tu última visita y un descuento esperándote en tu próxima compra.\n\nEscribe *hola* y te muestro lo nuevo. 🎁';

        try {
            _insertCola(cli.telefono, 'Cliente dormido', cuerpo, 'reactivacion_dormidos');
            total++;
        } catch (e) { log.debug('No se pudo encolar reactivación de cliente dormido: ' + e.message); }
    }
    if (total > 0) log.info('Clientes dormidos notificados: ' + total);
    return total;
}

// ── Lead scoring — recalcula clientes.lead_score para priorización/ML ─────
function actualizarLeadScores() {
    if (!_flagActivo('lead_scoring_activo')) return;
    const clientes = db.prepare(`
        SELECT c.id, c.telefono, COALESCE(c.tags,'') AS tags,
               COUNT(p.id_pedido) AS num_pedidos,
               COALESCE(SUM(p.total),0) AS total_gastado
        FROM clientes c
        LEFT JOIN pedidos p ON p.id_cliente = c.id
        WHERE c.activo = 1
        GROUP BY c.id
    `).all();

    let total = 0;
    for (const cli of clientes) {
        let score = cli.num_pedidos * 10 + Math.floor(cli.total_gastado / 100);
        if (cli.tags.includes('cliente_recurrente')) score += 20;
        if (cli.tags.includes('queja'))              score -= 15;
        if (cli.tags.includes('blacklist'))           score -= 30;
        score = Math.max(0, score);

        try {
            db.prepare('UPDATE clientes SET lead_score=? WHERE id=?').run(score, cli.id);
            total++;
        } catch (e) { log.debug('No se pudo actualizar lead_score: ' + e.message); }
    }
    if (total > 0) log.info('Lead scores actualizados: ' + total);
    return total;
}

// ── Conversión búsqueda→compra — para medir qué fracción de búsquedas
// (incluida búsqueda por foto vía Vision) termina en una venta real. Marca
// `log_eventos.compro=1` si el cliente generó un pedido dentro de los 3 días
// siguientes al evento. Defensivo: si la columna `compro` todavía no existe
// en producción, no hace nada y el resto de stockWatcher sigue igual.
function actualizarComprasDesdeEventos() {
    try {
        const eventos = db.prepare(`
            SELECT id, telefono, registrado_en FROM log_eventos
            WHERE tipo_evento IN ('busqueda','producto_visto','imagen')
              AND telefono IS NOT NULL AND telefono != ''
              AND COALESCE(compro,0) = 0
              AND datetime(registrado_en, '+3 days') <= datetime('now','localtime')
              AND datetime(registrado_en) >= datetime('now','-30 days','localtime')
        `).all();

        let total = 0;
        for (const ev of eventos) {
            const compra = db.prepare(`
                SELECT p.id_pedido FROM pedidos p
                LEFT JOIN clientes c ON c.id = p.id_cliente OR c.nombre = p.cliente
                WHERE c.telefono LIKE ?
                  AND p.creado_en BETWEEN ? AND datetime(?, '+3 days')
                LIMIT 1
            `).get('%' + ev.telefono + '%', ev.registrado_en, ev.registrado_en);
            if (compra) {
                db.prepare('UPDATE log_eventos SET compro=1 WHERE id=?').run(ev.id);
                total++;
            }
        }
        if (total > 0) log.info('log_eventos.compro actualizado: ' + total);
        return total;
    } catch (_) { return 0; }
}

// Aísla cada check para que uno que falle no cancele los siguientes
// en el mismo ciclo (antes todos compartían un único try externo).
function _runCheck(fn, nombre) {
    try { fn(); } catch (e) { log.warn(`Check ${nombre} falló: ` + e.message); }
}

const BACKUP_REGISTRO_PATH = path.join(__dirname, '..', 'scripts', '.backup_registro.json');
const BACKUP_MAX_EDAD_MS   = 36 * 3_600_000; // 36h — el backup de DB corre a las 11:00 todos los días

// El backup de DB (scripts/backup.js) es la única copia fuera del servidor.
// Antes de hoy, si el proceso que lo hospeda no llegaba a las 11:00 (caída,
// reinicio) nadie se enteraba — esto lo detecta y avisa por correo.
// Alerta de eficiencia de adquisición (finanzas P1): si el CAC de los últimos 7
// días sube >20% vs la media de 30 días, avisa al operador — la pauta pierde
// eficiencia antes de que sea pérdida. Requiere gasto de publicidad fechado en
// la cuenta 602 (si no hay, calla). Dedup diario. Ver AUDITORIA_SALUD_NEGOCIO.md §5.
function checkCacIneficiente() {
    const asesorTel = _valorConfig('operador_telefono', process.env.ASESOR_WHATSAPP);
    if (!asesorTel) return 0;
    const mkt = (dias) => {
        try { return db.prepare(`SELECT COALESCE(SUM(dd.debe - dd.haber),0) g FROM asientos a JOIN asientos_detalle dd ON dd.id_asiento=a.id WHERE dd.cuenta='602' AND a.fecha > date('now','localtime','-${dias} days')`).get().g || 0; }
        catch (_) { return 0; }
    };
    const nuevos = (dias) => {
        try { return db.prepare(`SELECT COUNT(*) n FROM clientes WHERE date(creado_en) > date('now','localtime','-${dias} days')`).get().n || 0; }
        catch (_) { return 0; }
    };
    const g7 = mkt(7), n7 = nuevos(7), g30 = mkt(30), n30 = nuevos(30);
    if (!(n7 > 0) || !(g7 > 0) || !(n30 > 0) || !(g30 > 0)) return 0;   // sin datos → callar
    const cac7 = g7 / n7, cac30 = g30 / n30;
    if (cac7 <= cac30 * 1.20) return 0;
    try {
        const ya = db.prepare("SELECT id FROM cola_notificaciones WHERE asunto='Alerta CAC' AND datetime(creada_en) > datetime('now','-23 hours','localtime') LIMIT 1").get();
        if (ya) return 0;
    } catch (_) {}
    const subio = Math.round((cac7 / cac30 - 1) * 100);
    try {
        _insertCola(asesorTel, 'Alerta CAC',
            `⚠️ El costo de adquirir clientes subió ${subio}% esta semana ($${cac7.toFixed(0)} vs $${cac30.toFixed(0)} promedio del mes). Revisa tu pauta/campaña antes de que sea pérdida.`,
            'alerta_cac');
        return 1;
    } catch (e) { log.debug('No se pudo encolar alerta CAC: ' + e.message); return 0; }
}

function checkBackupReciente() {
    let registro;
    try {
        if (!fs.existsSync(BACKUP_REGISTRO_PATH)) { log.warn('Sin registro de backups todavía (.backup_registro.json no existe)'); return; }
        registro = JSON.parse(fs.readFileSync(BACKUP_REGISTRO_PATH, 'utf8'));
    } catch (e) { log.warn('No se pudo leer registro de backups: ' + e.message); return; }

    const ultimo = registro.ultimo_backup_db ? new Date(registro.ultimo_backup_db).getTime() : 0;
    const edadMs = Date.now() - ultimo;
    if (ultimo && edadMs < BACKUP_MAX_EDAD_MS && registro.ultimo_backup_db_ok !== false) return; // todo bien

    const yaAlertadoHoy = db.prepare("SELECT id FROM cola_emails WHERE tipo='alerta_backup' AND date(creada_en)=date('now','localtime') LIMIT 1").get();
    if (yaAlertadoHoy) return;

    const dest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS || process.env.EMAIL_USER;
    if (!dest) { log.error('Backup de DB atrasado/falló y no hay EMAIL_PERSONAL/EMAIL_USER configurado para alertar'); return; }
    log.error('Backup de DB atrasado o falló — último intento: ' + (registro.ultimo_backup_db || 'nunca'));
    try {
        db.prepare("INSERT INTO cola_emails (destinatarios, asunto, html_body, estatus, tipo) VALUES (?, 'Backup de la base de datos atrasado', ?, 'pendiente', 'alerta_backup')")
            .run(JSON.stringify([dest]), '<p>El backup diario de la base de datos no se ha completado en las últimas 36 horas.</p><p>Último intento registrado: ' + (registro.ultimo_backup_db || 'nunca') + '</p>');
    } catch (e) { log.warn('No se pudo encolar alerta de backup: ' + e.message); }
}

// Purga imágenes de clientes viejas, pero SOLO las que ya están confirmadas
// en el registro de backup como enviadas — nunca borra algo que no se sabe
// si ya quedó respaldado fuera del servidor.
const IMG_DIR = path.join(__dirname, '..', 'bot', 'imagenes_clientes');
const IMG_PURGA_EDAD_MS = 30 * 24 * 3_600_000; // 30 días de vida en servidor
function purgarImagenesAntiguas() {
    if (!fs.existsSync(IMG_DIR)) return;
    let registro;
    try { registro = JSON.parse(fs.readFileSync(BACKUP_REGISTRO_PATH, 'utf8')); }
    catch (_) { return; } // sin registro de backup confirmado, no se borra nada
    const yaRespaldadas = new Set(registro.enviados || []);
    const ahora = Date.now();
    let borradas = 0;
    for (const f of fs.readdirSync(IMG_DIR)) {
        if (f.startsWith('.') || !yaRespaldadas.has(f)) continue;
        try {
            const ruta = path.join(IMG_DIR, f);
            if (ahora - fs.statSync(ruta).mtimeMs > IMG_PURGA_EDAD_MS) { fs.unlinkSync(ruta); borradas++; }
        } catch (e) { log.debug('No se pudo purgar ' + f + ': ' + e.message); }
    }
    if (borradas) log.info(`Purgadas ${borradas} imágenes de clientes ya respaldadas (>30 días)`);
}

// ── Recordatorio de link de pago por vencer (cierre asíncrono) ───────────
// El cliente YA hizo su pedido y tiene un link sin pagar a punto de expirar;
// se le recuerda UNA vez en las últimas ~12h de validez. Pasa por la cola
// normal (respeta anti-baneo y "el bot no escribe primero"). Módulo
// recordatorio_pago_activo (default off).
function checkLinksPagoPorVencer() {
    if (db.prepare("SELECT valor FROM configuracion WHERE clave='recordatorio_pago_activo'").get()?.valor !== '1') return 0;
    const filas = db.prepare(`
        SELECT lp.id, lp.id_pedido, lp.url_link, lp.monto, p.folio, c.telefono, c.nombre
        FROM links_pago lp
        JOIN pedidos p  ON p.id_pedido = lp.id_pedido
        JOIN clientes c ON c.id = p.id_cliente
        WHERE lp.estatus IN ('generado','pendiente')
          AND lp.url_link IS NOT NULL
          AND lp.fecha_expiracion IS NOT NULL
          AND datetime(lp.fecha_expiracion) > datetime('now','localtime')
          AND datetime(lp.fecha_expiracion, '-12 hours') <= datetime('now','localtime')
          AND p.estatus NOT IN ('cancelado','entregado')
          AND NOT EXISTS (
              SELECT 1 FROM cola_notificaciones cn
              WHERE cn.asunto = 'Link de pago por vencer ' || lp.id
                AND cn.estatus IN ('pendiente','enviado')
          )
    `).all();
    let total = 0;
    for (const f of filas) {
        if (!f.telefono || !f.url_link) continue;
        const nombre = (f.nombre || '').split(' ')[0] || 'Hola';
        const cuerpo = '⏰ ' + nombre + ', tu link de pago del pedido *' + (f.folio || f.id_pedido) + '* está por vencer.\n\nSi aún quieres completar tu compra ($' + Number(f.monto || 0).toFixed(2) + '), aquí lo tienes:\n' + f.url_link + '\n\nSi ya pagaste, ignóralo. 🙌';
        try { _insertCola(f.telefono, 'Link de pago por vencer ' + f.id, cuerpo, 'link_pago_por_vencer'); total++; }
        catch (e) { log.debug('No se pudo encolar recordatorio de link: ' + e.message); }
    }
    if (total > 0) log.info('Links de pago por vencer: ' + total + ' recordatorios');
    return total;
}

// ── Vigilancia del reloj del sistema ─────────────────────────────────────
// La app no puede impedir que un admin cambie el reloj del SO, pero SÍ puede
// detectar que retroceda (el vector para evadir el cierre contable / backdatear
// asientos). Guarda el máximo timestamp visto; si el reloj cae >10 min por
// debajo (tolerancia para NTP/DST), lo registra en la bitácora forense y
// alerta a Prime (una vez al día). No baja el máximo, así el retroceso sigue
// marcado hasta que el tiempo real lo alcance.
function checkRelojSistema() {
    const ahora = Date.now();
    const ultimo = parseInt(db.prepare("SELECT valor FROM configuracion WHERE clave='reloj_ultimo_visto'").get()?.valor || '0', 10) || 0;
    if (ultimo && ahora < ultimo - 10 * 60 * 1000) {
        const ya = db.prepare("SELECT id FROM cola_emails WHERE tipo='alerta_reloj' AND date(creada_en)=date('now','localtime') LIMIT 1").get();
        if (!ya) {
            const det = 'de ' + new Date(ultimo).toISOString() + ' a ' + new Date(ahora).toISOString();
            log.error('[reloj] El reloj del sistema RETROCEDIÓ ' + det + ' — posible manipulación de fecha');
            try {
                db.prepare('INSERT INTO configuracion_log (clave, valor_anterior, valor_nuevo, usuario) VALUES (?,?,?,?)')
                  .run('reloj_retrocedido', new Date(ultimo).toISOString(), new Date(ahora).toISOString(), 'sistema');
            } catch (_) {}
            const dest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS || process.env.EMAIL_USER;
            if (dest) {
                try {
                    db.prepare("INSERT INTO cola_emails (destinatarios, asunto, html_body, estatus, tipo) VALUES (?, 'Alerta: el reloj del sistema retrocedió', ?, 'pendiente', 'alerta_reloj')")
                      .run(JSON.stringify([dest]), '<p>El reloj del servidor retrocedió ' + det + '.</p><p>Esto puede indicar una manipulación de la fecha para backdatear operaciones. Verifica el reloj/NTP del servidor.</p>');
                } catch (_) {}
            }
        }
    }
    if (ahora > ultimo) {
        try { db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('reloj_ultimo_visto', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(String(ahora)); } catch (_) {}
    }
    return 0;
}

// ── Recordatorio de fiado vencido ────────────────────────────────────────
// El cliente compró a crédito (fiado) y ya venció el plazo sin pagar. Se le
// manda UN recordatorio de cobranza (cortés) por la cola normal — es su propia
// deuda, no outreach frío. Módulo recordatorio_fiado_activo (default off).
function checkFiadosVencidos() {
    if (db.prepare("SELECT valor FROM configuracion WHERE clave='recordatorio_fiado_activo'").get()?.valor !== '1') return 0;
    const filas = db.prepare(`
        SELECT p.id_pedido, p.folio, lp.monto, c.telefono, c.nombre
        FROM pedidos p
        JOIN links_pago lp ON lp.id_pedido = p.id_pedido AND lp.estatus='generado'
        JOIN clientes c ON c.id = p.id_cliente
        WHERE p.a_credito = 1
          AND p.fiado_vence_en IS NOT NULL
          AND p.fiado_vence_en < date('now','localtime')
          AND c.telefono IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM cola_notificaciones cn
              WHERE cn.asunto = 'Fiado vencido ' || p.id_pedido AND cn.estatus IN ('pendiente','enviado')
          )
    `).all();
    let total = 0;
    for (const f of filas) {
        const nombre = (f.nombre || '').split(' ')[0] || 'Hola';
        const cuerpo = '👋 ' + nombre + ', te recordamos con cariño que tu compra a crédito (pedido *' + (f.folio || f.id_pedido) + '*, $' + Number(f.monto || 0).toFixed(2) + ') ya venció. Cuando gustes pásate a liquidarla. ¡Gracias! 🙏';
        try { _insertCola(f.telefono, 'Fiado vencido ' + f.id_pedido, cuerpo, 'recordatorio_fiado'); total++; }
        catch (e) { log.debug('No se pudo encolar recordatorio de fiado: ' + e.message); }
    }
    if (total > 0) log.info('Fiados vencidos: ' + total + ' recordatorios');
    return total;
}

// F6: cobro recurrente automático de suscripciones. Genera el cargo del período
// (reusa la ruta de dinero sellada vía suscripcionCobro) para las activas vencidas
// y avisa al cliente por la cola. El avance de proximo_cobro (un mes) evita el
// doble cargo en ticks siguientes — no hace falta dedup extra. El cobro real se
// confirma en marcar-pagado, igual que todo.
function checkSuscripcionesVencidas() {
    if (db.prepare("SELECT valor FROM configuracion WHERE clave='suscripcion_activo'").get()?.valor !== '1') return 0;
    const { generarCobrosVencidos } = require('./suscripcionCobro');
    const r = generarCobrosVencidos(db, { username: 'auto' });
    let avisos = 0;
    for (const c of r.cargos) {
        if (!c.telefono) continue;
        const nombre = (c.nombre || '').split(' ')[0] || 'Hola';
        const cuerpo = '📅 ' + nombre + ', se generó el cargo de tu suscripción (*' + c.folio + '*) por $' + Number(c.subtotal).toFixed(2) + '. Te avisamos para que puedas cubrirlo. ¡Gracias! 🙏';
        try { _insertCola(c.telefono, 'Suscripcion cargo ' + c.folio, cuerpo, 'suscripcion'); avisos++; }
        catch (e) { log.debug('No se pudo encolar aviso de suscripción: ' + e.message); }
    }
    if (r.generados > 0) log.info('Suscripciones: ' + r.generados + ' cargos generados, ' + avisos + ' avisos');
    return r.generados;
}

// CRM F3: avanza campañas ACTIVAS (lanzadas por gerente+). Solo encola a
// cola_notificaciones — el poller escalonado inmutable del bot hace el envío.
function checkCampanasCRM() {
    try {
        const hay = db.prepare("SELECT COUNT(*) n FROM crm_campanas WHERE estatus='activa'").get()?.n || 0;
        if (!hay) return 0;
        const { avanzarCampanas } = require('./crmCampanas');
        const n = avanzarCampanas(db, _insertCola);
        if (n > 0) log.info('Campañas CRM: ' + n + ' mensajes encolados');
        return n;
    } catch (e) { log.debug('checkCampanasCRM: ' + e.message); return 0; }
}

async function runAll() {
    try {
        // Solo ejecutar checks costosos si hay datos relevantes
        const _hayEspera  = db.prepare("SELECT COUNT(*) c FROM lista_espera WHERE estatus='activa'").get()?.c > 0;
        const _hayAlerta  = db.prepare("SELECT COUNT(*) c FROM alertas_reabasto WHERE estatus='activa'").get()?.c > 0;
        const _hayPrev    = db.prepare("SELECT COUNT(*) c FROM preventas WHERE activa=1").get()?.c > 0;
        const _hayCarrito = db.prepare("SELECT COUNT(*) c FROM carritos_abandonados WHERE convertido=0").get()?.c > 0;

        if (_hayEspera)  { _runCheck(checkListaEspera, 'checkListaEspera'); _runCheck(limpiarExpiradas, 'limpiarExpiradas'); }
        if (_hayAlerta)  _runCheck(checkAlertas, 'checkAlertas');
        if (_hayPrev)    _runCheck(checkPreventas, 'checkPreventas');
        // CSAT y seguimiento: siempre (dependen de guías, no de cola)
        _runCheck(checkCSAT, 'checkCSAT');
        _runCheck(checkSeguimiento48h, 'checkSeguimiento48h');
        _runCheck(checkRecordatoriosCitas, 'checkRecordatoriosCitas');
        _runCheck(checkQuejasSinRespuesta, 'checkQuejasSinRespuesta');
        if (_hayCarrito) {
            _runCheck(checkCarritosAbandonados, 'checkCarritosAbandonados');
            _runCheck(checkOfertasPorVencer, 'checkOfertasPorVencer');
            _runCheck(checkCarritosAbandonados24h, 'checkCarritosAbandonados24h');
        }
        _runCheck(checkStockMinimo, 'checkStockMinimo');
        _runCheck(checkClientesDormidos, 'checkClientesDormidos');
        _runCheck(checkRecompraConsumibles, 'checkRecompraConsumibles');
        _runCheck(checkLinksPagoPorVencer, 'checkLinksPagoPorVencer');
        _runCheck(checkFiadosVencidos, 'checkFiadosVencidos');
        _runCheck(checkSuscripcionesVencidas, 'checkSuscripcionesVencidas');
        _runCheck(checkCampanasCRM, 'checkCampanasCRM');
        _runCheck(checkBackupReciente, 'checkBackupReciente');
        _runCheck(checkCacIneficiente, 'checkCacIneficiente');
        // Depreciación mensual automática de activos fijos: idempotente por mes
        // (ultima_depreciacion), así corre una sola vez al entrar el mes y no-opea
        // el resto. Sin activos registrados no hace nada. Evita que alguien olvide
        // correrla a mano cada mes.
        _runCheck(() => { try { require('./activosFijosService').depreciarMes(); } catch (_) {} }, 'depreciarActivos');
        _runCheck(checkRelojSistema, 'checkRelojSistema');
        _runCheck(purgarImagenesAntiguas, 'purgarImagenesAntiguas');
        _runCheck(actualizarLeadScores, 'actualizarLeadScores');
        _runCheck(actualizarComprasDesdeEventos, 'actualizarComprasDesdeEventos');
        // Puntos inactivos — corre pero solo notifica si han pasado 30 días
        try {
            const puntosService = require('../bot/handlers/puntosService');
            puntosService.checkPuntosInactivos();
        } catch(e) { log.debug('No se pudo correr checkPuntosInactivos: ' + e.message); }

        // Reporte automático diario — verificar si hay configurado una hora
        try {
            const _cfg = db.prepare("SELECT valor FROM configuracion WHERE clave='reporte_hora' LIMIT 1").get();
            if (_cfg) {
                const _horaConf = db.prepare("SELECT valor FROM configuracion WHERE clave='reporte_hora_valor' LIMIT 1").get()?.valor || '09:00';
                const _destConf = db.prepare("SELECT valor FROM configuracion WHERE clave='reporte_destino' LIMIT 1").get()?.valor || 'whatsapp';
                const _ahora = new Date();
                const _hora  = _ahora.getHours().toString().padStart(2,'0') + ':' + _ahora.getMinutes().toString().padStart(2,'0');
                // Enviar en la ventana de ±1 minuto de la hora configurada
                if (_hora >= _horaConf && _hora <= _horaConf.slice(0,4) + String(parseInt(_horaConf.slice(3))+1).padStart(2,'0')) {
                    // Verificar que no se haya enviado ya hoy — la tabla de
                    // deduplicación depende del destino: whatsapp encola en
                    // cola_notificaciones, email en cola_emails.
                    const _hoy = new Date().toISOString().slice(0,10);
                    const _yaEnviado = _destConf === 'email'
                        ? db.prepare("SELECT id FROM cola_emails WHERE tipo='reporte' AND date(creada_en)=? LIMIT 1").get(_hoy)
                        : db.prepare("SELECT id FROM cola_notificaciones WHERE asunto='Reporte diario' AND date(creada_en)=? LIMIT 1").get(_hoy);
                    if (!_yaEnviado) {
                        // Llamada directa a la lógica compartida (sin HTTP) —
                        // antes se llamaba a /api/reporte con Basic Auth, que
                        // requireSession() del dashboard nunca acepta (solo
                        // lee la cookie jc_session), dejando el reporte
                        // automático roto en silencio.
                        const reporteService = require('./reporteService');
                        const _r = reporteService.enviarReporte(_destConf);
                        if (_r.ok) log.info('Reporte diario enviado a ' + _destConf);
                        else log.warn('Reporte diario no enviado: ' + _r.error);
                    }
                }
            }
        } catch(e) { log.debug('No se pudo procesar reporte automático diario: ' + e.message); }

        // Integridad contable: repara pagos recientes que quedaron sin asiento
        // (crash entre el cobro atómico y el asiento best-effort). Idempotente y
        // fail-closed: no hace nada si contabilidad está apagada. Comité 2026-07.
        try { checkAsientosHuerfanos(); } catch(e) { log.debug('barrido asientos: ' + e.message); }
    } catch (err) {
        log.error('Error en runAll', err);
    }
}

function checkAsientosHuerfanos() {
    const r = require('./contabilidadService').barrerAsientosHuerfanos();
    if (r.reparados) log.warn('Contabilidad: ' + r.reparados + ' asiento(s) de venta re-generados (pago sin asiento)');
}

module.exports = { runAll, checkListaEspera, checkAlertas, checkCSAT, checkCarritosAbandonados, checkOfertasPorVencer, checkCarritosAbandonados24h, checkStockMinimo, checkSeguimiento48h, checkQuejasSinRespuesta, checkClientesDormidos, checkAsientosHuerfanos, actualizarLeadScores, actualizarComprasDesdeEventos };
