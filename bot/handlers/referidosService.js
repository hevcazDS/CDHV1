// referidosService.js — Programa de referidos "comparte tu número y gana
// puntos". Vinculación: un cliente NUEVO (primer contacto, sin compra)
// escribe el código de un referente (formato REF-XXXXXXXX, mismo estilo que
// los tickets TK-XXXXXXXX de puntosService.js) dentro de su primer mensaje —
// eso solo guarda el vínculo, no otorga nada. El código propio y los puntos
// del referente se otorgan en un único disparador: la primera compra
// finalizada del cliente nuevo (ver otorgarPuntosPorPrimeraCompra, llamada
// desde /api/pagos/:id/marcar-pagado en dashboard/server.js). De momento
// ningún otro evento debe disparar ese mensaje/otorgamiento.
// Tope anti-fraude: máx MAX_REFERIDOS_SEMANA referidos exitosos por semana
// por cliente referente — se informa al cliente dentro del mismo mensaje.
// Apagador: configuracion.referidos_activo='0' desactiva toda la campaña
// (vínculo nuevo, mensaje y otorgamiento de puntos) sin tocar código fuente.
'use strict';

const db = require('../db_connection');
const log = require('../logger')('referidosService');
const { registrarErrorDB } = require('../dbErrorLog');

const PUNTOS_REFERIDO      = 100;
const MAX_REFERIDOS_SEMANA = 3;
const _RE_CODIGO_REFERIDO  = /REF-[A-Z0-9]{8}/;
const FINALIZADOS          = ['confirmado', 'preparando', 'enviado', 'entregado'];

// Apagador de campaña — igual patrón que /api/modulo/:clave: activo por
// defecto, falla abierto si la tabla no existe (no es un módulo crítico).
function referidosActivo() {
    try {
        const cfg = db.prepare(
            "SELECT valor FROM configuracion WHERE clave='referidos_activo' LIMIT 1"
        ).get();
        return !cfg || cfg.valor !== '0';
    } catch (_) {
        return true;
    }
}

function _generarCodigo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0,O,I,1 para evitar confusión
    let codigo = 'REF-';
    for (let i = 0; i < 8; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
    return codigo;
}

// Genera y persiste un código de referido único para un cliente que aún no
// tiene uno (máx 5 intentos contra la UNIQUE INDEX). Si ya tiene, lo regresa.
function asegurarCodigoReferido(idCliente) {
    if (!idCliente) return null;
    const cli = db.prepare('SELECT codigo_referido FROM clientes WHERE id=?').get(idCliente);
    if (!cli) return null;
    if (cli.codigo_referido) return cli.codigo_referido;

    for (let i = 0; i < 5; i++) {
        const codigo = _generarCodigo();
        const existe = db.prepare('SELECT id FROM clientes WHERE codigo_referido=?').get(codigo);
        if (!existe) {
            db.prepare('UPDATE clientes SET codigo_referido=? WHERE id=?').run(codigo, idCliente);
            return codigo;
        }
    }
    return null;
}

// Detecta un código de referido en el primer mensaje de un cliente recién
// creado y, si es válido, solo VINCULA la referencia (clientes.referido_por_id).
// No otorga puntos ni manda mensajes aquí — eso ocurre únicamente cuando este
// cliente nuevo complete su primera compra (ver otorgarPuntosPorPrimeraCompra).
// Retorna { ok, idReferente } o null si no aplicó nada.
function procesarReferidoSiAplica(idClienteNuevo, telefonoNuevo, textoPrimerMensaje) {
    if (!referidosActivo()) return null;
    if (!idClienteNuevo || !textoPrimerMensaje) return null;
    const m = textoPrimerMensaje.toUpperCase().match(_RE_CODIGO_REFERIDO);
    if (!m) return null;
    const codigo = m[0];

    const referente = db.prepare('SELECT id FROM clientes WHERE codigo_referido=?').get(codigo);
    if (!referente || referente.id === idClienteNuevo) return null;

    const cliente = db.prepare('SELECT referido_por_id FROM clientes WHERE id=?').get(idClienteNuevo);
    if (!cliente || cliente.referido_por_id) return null; // ya vinculado, no se reasigna

    db.prepare('UPDATE clientes SET referido_por_id=? WHERE id=?').run(referente.id, idClienteNuevo);
    return { ok: true, idReferente: referente.id };
}

// Único disparador real del programa: se llama una vez confirmado el pago de
// un pedido (marcar-pagado). Si esta es la primera compra finalizada del
// cliente, le manda su propio código de referido (avisando el tope semanal),
// y si además llegó referido por alguien y no se le habían otorgado puntos
// todavía a ese referente por él, le acredita PUNTOS_REFERIDO (respetando el
// mismo tope semanal). Idempotente: nFinalizados!==1 evita reprocesar compras
// posteriores, y la fila en `referidos` evita acreditar dos veces al referente.
function otorgarPuntosPorPrimeraCompra(idCliente) {
    if (!referidosActivo()) return null;
    if (!idCliente) return null;

    const cliente = db.prepare('SELECT id, telefono, referido_por_id FROM clientes WHERE id=?').get(idCliente);
    if (!cliente) return null;

    const nFinalizados = db.prepare(`
        SELECT COUNT(*) AS n FROM pedidos
        WHERE id_cliente=? AND estatus IN (${FINALIZADOS.map(() => '?').join(',')})
    `).get(idCliente, ...FINALIZADOS)?.n || 0;
    if (nFinalizados !== 1) return null; // no es la primera compra finalizada de este cliente

    const tel = (cliente.telefono || '').replace(/@.*$/, '');
    const codigoPropio = asegurarCodigoReferido(idCliente);

    if (codigoPropio && tel) {
        try {
            db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus)
                VALUES ('whatsapp',?,'Gracias por tu compra',?,'pendiente')`
            ).run(tel,
                '🎉 ¡Gracias por tu compra! Este es tu código de referido: *' + codigoPropio + '*\n\n' +
                'Compártelo con un amigo. Cuando nos escriba por primera vez mencionándolo y haga su primera compra, ' +
                'te llevas *' + PUNTOS_REFERIDO + ' puntos* extra (máximo ' + MAX_REFERIDOS_SEMANA + ' referidos por semana). ⭐');
        } catch (e) { log.debug('No se pudo notificar código de referido: ' + e.message); registrarErrorDB('referidosService:codigoPropio', e.message, { idCliente }); }
    }

    if (!cliente.referido_por_id) return { ok: true, idCliente, otorgoPuntosReferente: false };

    const yaRegistrado = db.prepare('SELECT id FROM referidos WHERE id_referido=?').get(idCliente);
    if (yaRegistrado) return { ok: true, idCliente, otorgoPuntosReferente: false };

    const referente = db.prepare('SELECT id, telefono FROM clientes WHERE id=?').get(cliente.referido_por_id);
    if (!referente) return { ok: true, idCliente, otorgoPuntosReferente: false };

    const enSemana = db.prepare(`
        SELECT COUNT(*) AS n FROM referidos
        WHERE id_referente=? AND datetime(creado_en) >= datetime('now','-7 days','localtime')
    `).get(referente.id)?.n || 0;
    if (enSemana >= MAX_REFERIDOS_SEMANA) {
        log.warn('Tope semanal alcanzado, no se otorgan puntos', { max: MAX_REFERIDOS_SEMANA, idReferente: referente.id });
        return { ok: true, idCliente, otorgoPuntosReferente: false };
    }

    const telReferente = (referente.telefono || '').replace(/@.*$/, '');
    const telReferido  = tel || null;

    const _tx = db.transaction(() => {
        db.prepare(`
            INSERT INTO referidos (id_referente, id_referido, telefono_referido, puntos_otorgados)
            VALUES (?, ?, ?, ?)
        `).run(referente.id, idCliente, telReferido, PUNTOS_REFERIDO);

        const saldo = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(referente.id);
        if (saldo) {
            db.prepare("UPDATE puntos_cliente SET puntos_ganados=puntos_ganados+?, ultimo_movimiento=datetime('now','localtime') WHERE id_cliente=?").run(PUNTOS_REFERIDO, referente.id);
        } else {
            db.prepare("INSERT INTO puntos_cliente (id_cliente,telefono,puntos_ganados,ultimo_movimiento) VALUES (?,?,?,datetime('now','localtime'))").run(referente.id, telReferente, PUNTOS_REFERIDO);
        }
        db.prepare("INSERT INTO movimientos_puntos (id_cliente,telefono,tipo,puntos,concepto) VALUES (?,?,'acumulacion',?,?)").run(referente.id, telReferente, PUNTOS_REFERIDO, 'Referido: completó su primera compra');
    });
    _tx();

    try {
        db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus)
            VALUES ('whatsapp',?,'Puntos por referido',?,'pendiente')`
        ).run(telReferente,
            '🎉 ¡Tu código de referido funcionó! La persona que invitaste completó su primera compra.\n\n+' + PUNTOS_REFERIDO + ' puntos sumados a tu cuenta. Escribe *mis puntos* para ver tu saldo. ⭐');
    } catch (e) { log.debug('No se pudo notificar puntos por referido: ' + e.message); registrarErrorDB('referidosService:puntosReferente', e.message, { idReferente: referente.id }); }

    return { ok: true, idCliente, otorgoPuntosReferente: true, idReferente: referente.id };
}

module.exports = {
    asegurarCodigoReferido,
    procesarReferidoSiAplica,
    otorgarPuntosPorPrimeraCompra,
    referidosActivo,
    PUNTOS_REFERIDO,
    MAX_REFERIDOS_SEMANA,
};
