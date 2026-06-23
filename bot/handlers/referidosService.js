// referidosService.js — Programa de referidos "comparte tu número y gana
// puntos". Vinculación: un cliente NUEVO (primer contacto, sin compra)
// escribe el código de un referente (5 caracteres alfanuméricos, sin
// prefijo) dentro de su primer mensaje — eso solo guarda el vínculo, no
// otorga nada. El código propio y los puntos del referente se otorgan en un
// único disparador: la primera compra finalizada del cliente nuevo (ver
// otorgarPuntosPorPrimeraCompra, llamada desde /api/pagos/:id/marcar-pagado
// en dashboard/server.js). De momento ningún otro evento debe disparar ese
// mensaje/otorgamiento.
// Tope anti-fraude: máx MAX_REFERIDOS_SEMANA referidos exitosos por semana
// por cliente referente — se informa al cliente dentro del mismo mensaje.
// Apagador: configuracion.referidos_activo='0' desactiva toda la campaña
// (vínculo nuevo, mensaje y otorgamiento de puntos) sin tocar código fuente.
'use strict';

const db = require('../db_connection');
const log = require('../logger')('referidosService');
const { registrarErrorDB } = require('../dbErrorLog');
const puntosService = require('./puntosService');

const PUNTOS_REFERIDO        = 100;
const MAX_REFERIDOS_SEMANA   = 3;
const PCT_DESCUENTO_REFERIDO = 10;
// Sin prefijo a propósito (decisión de producto): 5 caracteres del mismo
// charset sin ambigüedad (sin 0,O,I,1) que ya usan los códigos TK-/REF-
// anteriores. \b...\b + verificación exacta contra clientes.codigo_referido
// hace el riesgo de falso positivo con texto normal estadísticamente nulo.
const _RE_CODIGO_REFERIDO  = /\b[A-Z0-9]{5}\b/g;
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
    let codigo = '';
    for (let i = 0; i < 5; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
    return codigo;
}

// ¿El carrito tiene algún artículo en oferta activa (promociones.id_producto)?
// El descuento automático de bienvenida del referido NO aplica en ese caso —
// regla dictada explícitamente: "no aplica con artículos ya en descuento".
function _carritoTieneOfertaActiva(carrito) {
    if (!carrito || !carrito.length) return false;
    const ids = carrito.map(i => i.id).filter(Boolean);
    if (!ids.length) return false;
    try {
        const hoy = new Date().toISOString().slice(0, 10);
        const ph  = ids.map(() => '?').join(',');
        const row = db.prepare(`
            SELECT COUNT(*) AS n FROM promociones
            WHERE activa = 1 AND id_producto IN (${ph})
              AND (fecha_inicio IS NULL OR fecha_inicio <= ?)
              AND (fecha_fin IS NULL OR fecha_fin >= ?)
        `).get(...ids, hoy, hoy);
        return (row?.n || 0) > 0;
    } catch (_) { return false; }
}

// Descuento automático del 10% en la PRIMERA compra de un cliente referido —
// no requiere capturar ningún código en el checkout, ya se vinculó desde su
// primer mensaje (ver procesarReferidoSiAplica). Un solo uso por cliente
// (clientes.descuento_referido_usado), no aplica si el carrito ya tiene
// algún artículo en oferta activa. Quien llama es responsable de no invocar
// esto si ya hay un cupón manual aplicado (no se combinan descuentos).
function calcularDescuentoReferido(telefono, carrito) {
    if (!referidosActivo()) return { aplica: false, descuento: 0 };
    if (!telefono || !carrito || !carrito.length) return { aplica: false, descuento: 0 };
    const tel = telefono.replace(/@.*$/, '');
    const cliente = db.prepare(
        'SELECT id, referido_por_id, descuento_referido_usado FROM clientes WHERE telefono=?'
    ).get(tel);
    if (!cliente || !cliente.referido_por_id || cliente.descuento_referido_usado) {
        return { aplica: false, descuento: 0 };
    }
    if (_carritoTieneOfertaActiva(carrito)) return { aplica: false, descuento: 0, motivo: 'oferta_activa' };

    const subtotal  = carrito.reduce((s, i) => s + (i.price || 0) * (i.cantidad || 1), 0);
    const descuento = parseFloat((subtotal * (PCT_DESCUENTO_REFERIDO / 100)).toFixed(2));
    return { aplica: true, descuento, idCliente: cliente.id };
}

function marcarDescuentoReferidoUsado(idCliente) {
    if (!idCliente) return;
    try { db.prepare('UPDATE clientes SET descuento_referido_usado=1 WHERE id=?').run(idCliente); }
    catch (e) { log.debug('No se pudo marcar descuento de referido usado: ' + e.message); }
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
    // Sin prefijo, el texto puede traer varios tokens de 5 caracteres — se
    // revisan todos y se usa el primero que exista como código real.
    const candidatos = textoPrimerMensaje.toUpperCase().match(_RE_CODIGO_REFERIDO);
    if (!candidatos) return null;

    const cliente = db.prepare('SELECT referido_por_id FROM clientes WHERE id=?').get(idClienteNuevo);
    if (!cliente || cliente.referido_por_id) return null; // ya vinculado, no se reasigna

    for (const codigo of candidatos) {
        const referente = db.prepare('SELECT id FROM clientes WHERE codigo_referido=?').get(codigo);
        if (!referente || referente.id === idClienteNuevo) continue;
        db.prepare('UPDATE clientes SET referido_por_id=? WHERE id=?').run(referente.id, idClienteNuevo);
        return { ok: true, idReferente: referente.id };
    }
    return null;
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
    // Nota: los puntos propios de este cliente por SU compra (1 punto/peso)
    // ya los acredita puntosService.otorgarPuntosPorCompra para CUALQUIER
    // pedido, no solo el primero ni solo el de un referido — este bloque
    // ya no duplica esa acreditación.

    const yaRegistrado = db.prepare('SELECT id FROM referidos WHERE id_referido=?').get(idCliente);
    if (yaRegistrado) return { ok: true, idCliente, otorgoPuntosReferente: false };

    const referente = db.prepare('SELECT id, telefono FROM clientes WHERE id=?').get(cliente.referido_por_id);
    if (!referente) return { ok: true, idCliente, otorgoPuntosReferente: false };

    // El bono del referente ES puntos -- si el módulo de puntos está
    // desactivado desde Módulos en el dashboard, no hay nada que acreditar.
    if (!puntosService.puntosActivo()) return { ok: true, idCliente, otorgoPuntosReferente: false };

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

    // El bono puede empujar al referente sobre el umbral de 2,000 puntos —
    // ya no depende de que escanee un ticket en tienda para que se le
    // emita el cupón de 10%, se revisa aquí mismo.
    const { cuponesNuevos, topeAlcanzado } = puntosService.revisarYOtorgarCupones(referente.id, telReferente);
    const saldoFinalReferente = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(referente.id);
    const dispReferente = (saldoFinalReferente?.puntos_ganados || 0) - (saldoFinalReferente?.puntos_canjeados || 0);

    let _msgReferente = '🎉 ¡Tu código de referido funcionó! La persona que invitaste completó su primera compra.\n\n+' + PUNTOS_REFERIDO + ' puntos sumados a tu cuenta.\n📊 Saldo total: *' + dispReferente + ' puntos*.';
    if (cuponesNuevos.length) {
        _msgReferente += '\n\n🎉 ¡Tienes ' + cuponesNuevos.length + ' cupón' + (cuponesNuevos.length > 1 ? 'es' : '') + ' de 10% de descuento!\n';
        for (const c of cuponesNuevos) _msgReferente += '🏷️ Código: *' + c.cupon + '* — válido hasta ' + c.expira + '\n';
        _msgReferente += '_Aplícalo en tu próxima compra. No acumulable ni válido con otras ofertas._';
    } else {
        _msgReferente += ' Escribe *mis puntos* para ver el detalle. ⭐';
    }
    if (topeAlcanzado) _msgReferente += '\n\n⚠️ Alcanzaste el tope de puntos redimibles en los últimos 30 días. El resto de tu saldo se mantiene disponible.';

    try {
        db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus)
            VALUES ('whatsapp',?,'Puntos por referido',?,'pendiente')`
        ).run(telReferente, _msgReferente);
    } catch (e) { log.debug('No se pudo notificar puntos por referido: ' + e.message); registrarErrorDB('referidosService:puntosReferente', e.message, { idReferente: referente.id }); }

    return { ok: true, idCliente, otorgoPuntosReferente: true, idReferente: referente.id };
}

// Texto mostrado desde el menú del bot (opción "Términos y condiciones" del
// submenú de referidos, ver bot/flows/menuFlow.js) — incorpora las reglas
// dictadas: 1 punto/peso por cualquier compra, 2,000 puntos = 10% descuento,
// tope de 4,000 puntos redimidos en cualquier ventana de 30 días, "no aplica
// con artículos ya en descuento", solo válido en este canal, y máximo 300
// puntos/semana por compartir (3 referidos × 100 puntos).
const TERMINOS_REFERIDOS =
`📜 *Términos y condiciones — Programa de Puntos y Referidos*

⭐ *Acumulación de puntos*
· Ganas 1 punto por cada $1 MXN en cualquier compra confirmada — ya no es necesario escanear ningún ticket, se acredita solo.
· Al juntar 2,000 puntos disponibles obtienes un cupón de 10% de descuento en tu próxima compra (un solo uso, válido 90 días).
· Tope: puedes redimir un máximo de 4,000 puntos (2 cupones) en cualquier periodo de 30 días.
· El cupón de lealtad no aplica con artículos que ya estén en oferta, ni es acumulable con otras promociones.
· Los puntos vencen si tu cuenta no tiene movimiento en 12 meses.
· Válido únicamente en este canal de WhatsApp con Julio Cepeda Jugueterías.

🤝 *Programa de referidos*
· Comparte tu código con un amigo o familiar.
· Cuando esa persona te mencione en su primer mensaje y complete su primera compra, ganas *100 puntos*.
· Máximo 3 referidos exitosos por semana (300 puntos/semana).
· La persona referida obtiene *10% de descuento* en su primera compra (no aplica si su carrito ya tiene artículos en oferta) y también gana sus puntos normales por esa compra.
· Tu código es personal e intransferible; no se permite usarlo para ti mismo.

Julio Cepeda Jugueterías puede modificar estos términos en cualquier momento; los cambios aplican a partir de su publicación. Para dudas, escribe *asesor*.`;

module.exports = {
    asegurarCodigoReferido,
    procesarReferidoSiAplica,
    otorgarPuntosPorPrimeraCompra,
    calcularDescuentoReferido,
    marcarDescuentoReferidoUsado,
    referidosActivo,
    PUNTOS_REFERIDO,
    MAX_REFERIDOS_SEMANA,
    PCT_DESCUENTO_REFERIDO,
    TERMINOS_REFERIDOS,
};
