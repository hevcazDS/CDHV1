// marketing.js — Automatizaciones de marketing (carritos, ofertas, recompra,
// reactivación de dormidos, campañas CRM).
// Extraído de services/stockWatcher.js (refactor sin cambio de comportamiento).
'use strict';
const { db, log, _flagActivo, _valorConfig, _insertCola, _STAGGER_MIN, _STAGGER_MAX } = require('./_shared');

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
    let _off = 0;
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
                '🛒 ¡Oye! Dejaste productos en tu carrito:\n\n' +
                resumen + mas + '\n\n' +
                'Te lo tengo apartado, pero el stock se mueve rápido ⚡\n¿Continuamos? Escribe *hola* para retomarlo.';
        }
        cuerpo += '\n\n💬 Por cierto, ¿qué te detuvo? Responde *precio*, *envío* u *otro* — nos ayuda a mejorar.';

        try {
            _insertCola(tel, _conOferta.length ? 'Oferta por vencer' : 'Carrito abandonado', cuerpo,
                _conOferta.length ? 'oferta_por_vencer' : 'carrito_abandonado_2h', _off);

            db.prepare('UPDATE carritos_abandonados SET notificado=1, notificado_en=datetime("now","localtime") WHERE id=?')
              .run(ca.id);
            _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN);
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
    let _off = 0;
    for (const ca of abandonados) {
        const yaAvisado = db.prepare(`
            SELECT id FROM cola_notificaciones
            WHERE (destinatario = ? OR destinatario LIKE ?) AND asunto='Carrito abandonado 24h'
              AND datetime(creada_en) > datetime('now','-30 days','localtime')
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

            _insertCola(ca.telefono, 'Carrito abandonado 24h', cuerpo, 'carrito_abandonado_24h', _off);
            _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN);
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
    let _off = 0;
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
            _insertCola(ca.telefono, 'Oferta por vencer 24h', cuerpo, 'oferta_por_vencer_24h', _off);
            _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN);
            total++;
        } catch(e) { log.debug('No se pudo encolar oferta por vencer: ' + e.message); }
    }
    if (total > 0) log.info('Alertas oferta por vencer: ' + total);
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
    let _off = 0;
    for (const f of filas) {
        // dedupe: ¿ya se le mandó recompra en 20 días?
        const ya = db.prepare(`SELECT 1 FROM cola_notificaciones WHERE (destinatario=? OR destinatario LIKE ?) AND campana='recompra' AND datetime(creada_en) > datetime('now','-20 days','localtime') LIMIT 1`).get(f.telefono, f.telefono + '@%');
        if (ya) continue;
        const nombre = (f.nombre || '').split(' ')[0];
        const cuerpo = '¡Hola' + (nombre ? ' ' + nombre : '') + '! ¿Ya se te acabó tu *' + f.producto + '*? 🛒\n\nEscribe *hola* y te lo dejo listo para recomprar en un momento.';
        _insertCola(f.telefono, 'Recompra ' + f.producto, cuerpo, 'recompra', _off);
        _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN);
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
    // Máximo una vez al día — evita ráfaga masiva en cada reconexión del bot.
    // La verificación per-cliente (15 días) sigue activa como segunda capa.
    const hoy = new Date().toISOString().slice(0, 10);
    const ultDia = _valorConfig('dormidos_ultimo_dia', '');
    if (ultDia === hoy) return;
    try {
        db.prepare("INSERT INTO configuracion (clave,valor) VALUES ('dormidos_ultimo_dia',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actualizado_en=datetime('now','localtime')").run(hoy);
    } catch(_) {}
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
    let _off = 0;
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
            _insertCola(cli.telefono, 'Cliente dormido', cuerpo, 'reactivacion_dormidos', _off);
            _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN);
            total++;
        } catch (e) { log.debug('No se pudo encolar reactivación de cliente dormido: ' + e.message); }
    }
    if (total > 0) log.info('Clientes dormidos notificados: ' + total);
    return total;
}

// CRM F3: avanza campañas ACTIVAS (lanzadas por gerente+). Solo encola a
// cola_notificaciones — el poller escalonado inmutable del bot hace el envío.
function checkCampanasCRM() {
    try {
        const hay = db.prepare("SELECT COUNT(*) n FROM crm_campanas WHERE estatus='activa'").get()?.n || 0;
        if (!hay) return 0;
        const { avanzarCampanas } = require('../crmCampanas');
        const n = avanzarCampanas(db, _insertCola);
        if (n > 0) log.info('Campañas CRM: ' + n + ' mensajes encolados');
        return n;
    } catch (e) { log.debug('checkCampanasCRM: ' + e.message); return 0; }
}

module.exports = {
    checkCarritosAbandonados, checkCarritosAbandonados24h, checkOfertasPorVencer,
    checkRecompraConsumibles, checkClientesDormidos, checkCampanasCRM,
};
