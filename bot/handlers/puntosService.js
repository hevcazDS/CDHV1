// puntosService.js — Sistema de puntos de lealtad Julio Cepeda Jugueterías
// Reglas:
//   - 1 punto por cada peso comprado (10 puntos por $10)
//   - 2,000 puntos disponibles = 1 cupón de 10% de descuento en la próxima compra
//     (no acumulable, no válido con otras ofertas, un solo uso)
//   - Ventana de reclamo: 2 horas desde que se generó el ticket
//   - Límite anti-fraude: máx 2 tickets/día y 2 tickets/semana por cliente
//   - Puntos vencen a los 12 meses sin movimiento
'use strict';

const db      = require('../db_connection');
const crypto  = require('crypto');
const log     = require('../logger')('puntosService');
const { registrarErrorDB } = require('../dbErrorLog');

const PUNTOS_POR_PESO   = 1;      // 1 punto = $1
const PUNTOS_REGALO     = 2000;   // puntos necesarios para una recompensa
const PCT_DESCUENTO     = 10;     // % de descuento del cupón de lealtad
const VIGENCIA_REGALO   = 90;     // días de vigencia del cupón
const VENTANA_RECLAMO_H = 2;      // horas para reclamar el ticket
const MAX_TICKETS_DIA   = 2;
const MAX_TICKETS_SEMANA = 2;

// ── Generar código QR único para un ticket ─────────────────────────
function generarCodigoQR() {
    // TK-XXXXXXXX — 8 chars alfanuméricos mayúsculas
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0,O,I,1 para evitar confusión
    let codigo = 'TK-';
    for (let i = 0; i < 8; i++) {
        codigo += chars[Math.floor(Math.random() * chars.length)];
    }
    return codigo;
}

// ── Preparar ticket para reclamo (llamar desde POS al cerrar venta) ─
function prepararTicket(idTicket, total, telefonoCliente) {
    const puntos         = Math.floor(total * PUNTOS_POR_PESO);
    const expira         = new Date(Date.now() + VENTANA_RECLAMO_H * 60 * 60_000);
    const expiraISO      = expira.toISOString().replace('T', ' ').slice(0, 19);

    // Intentar generar código único (máx 5 intentos)
    let codigo = null;
    for (let i = 0; i < 5; i++) {
        const c = generarCodigoQR();
        const existe = db.prepare('SELECT id FROM tickets_venta WHERE codigo_qr=?').get(c);
        if (!existe) { codigo = c; break; }
    }
    if (!codigo) return { ok: false, error: 'No se pudo generar código único' };

    db.prepare(`
        UPDATE tickets_venta SET
            codigo_qr         = ?,
            telefono_cliente  = ?,
            puntos_otorgados  = ?,
            puntos_reclamados = 0,
            expira_reclamo_en = ?
        WHERE id = ?
    `).run(codigo, telefonoCliente || null, puntos, expiraISO, idTicket);

    return { ok: true, codigo, puntos, expira: expiraISO };
}

// ── Validar y reclamar ticket desde WhatsApp ───────────────────────
function reclamarTicket(codigoRaw, telefono) {
    const codigo = (codigoRaw || '').trim().toUpperCase();
    if (!codigo.startsWith('TK-') || codigo.length !== 11)
        return { ok: false, error: 'Formato de código inválido. Debe ser TK-XXXXXXXX' };

    // 1. Buscar ticket
    const ticket = db.prepare(`
        SELECT tv.*, c.id AS id_cliente_reg, c.nombre
        FROM tickets_venta tv
        LEFT JOIN clientes c ON c.telefono = tv.telefono_cliente
           OR c.telefono LIKE '%' || REPLACE(REPLACE(tv.telefono_cliente,'@c.us',''),'@lid','') || '%'
        WHERE tv.codigo_qr = ?
        LIMIT 1
    `).get(codigo);

    if (!ticket) return { ok: false, error: 'Código no encontrado. Verifica que lo escribiste bien.' };

    // 2. ¿Ya fue reclamado?
    if (ticket.puntos_reclamados) return { ok: false, error: 'Este ticket ya fue registrado anteriormente.' };

    // 3. ¿Está dentro de la ventana de 2 horas?
    if (ticket.expira_reclamo_en) {
        const expira = new Date(ticket.expira_reclamo_en.replace(' ', 'T'));
        if (new Date() > expira)
            return { ok: false, error: 'Este ticket ya expiró. Los tickets solo pueden registrarse dentro de las 2 horas siguientes a la compra.' };
    }

    // 4. Verificar límites anti-fraude
    const tel = telefono.replace(/@.*$/, '');
    const hoy = new Date().toISOString().slice(0, 10);
    const inicioSemana = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);

    const ticketsHoy = db.prepare(`
        SELECT COUNT(*) AS n FROM movimientos_puntos
        WHERE telefono LIKE ? AND tipo='acumulacion'
          AND id_ticket IS NOT NULL
          AND DATE(creado_en) = ?
    `).get('%' + tel + '%', hoy)?.n || 0;

    if (ticketsHoy >= MAX_TICKETS_DIA)
        return { ok: false, error: 'Alcanzaste el límite de ' + MAX_TICKETS_DIA + ' tickets por día. Intenta mañana.' };

    const ticketsSemana = db.prepare(`
        SELECT COUNT(*) AS n FROM movimientos_puntos
        WHERE telefono LIKE ? AND tipo='acumulacion'
          AND id_ticket IS NOT NULL
          AND DATE(creado_en) >= ?
    `).get('%' + tel + '%', inicioSemana)?.n || 0;

    if (ticketsSemana >= MAX_TICKETS_SEMANA)
        return { ok: false, error: 'Alcanzaste el límite de ' + MAX_TICKETS_SEMANA + ' tickets por semana.' };

    // 5. Buscar o crear cliente
    let idCliente = ticket.id_cliente_reg;
    if (!idCliente) {
        // Cliente nuevo — registrar con el teléfono
        const insert = db.prepare(`
            INSERT INTO clientes (nombre, telefono, creado_en)
            VALUES ('Cliente ' || ?, ?, datetime('now','localtime'))
        `).run(tel, tel);
        idCliente = insert.lastInsertRowid;
    }

    const puntos = ticket.puntos_otorgados || 0;

    // 6-8. Operación atómica: actualizar puntos + movimiento + marcar ticket
    const _txPuntos = db.transaction(() => {
        const saldo = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(idCliente);
        if (saldo) {
            db.prepare("UPDATE puntos_cliente SET puntos_ganados=puntos_ganados+?, ultimo_movimiento=datetime('now','localtime') WHERE id_cliente=?").run(puntos, idCliente);
        } else {
            db.prepare("INSERT INTO puntos_cliente (id_cliente,telefono,puntos_ganados,ultimo_movimiento) VALUES (?,?,?,datetime('now','localtime'))").run(idCliente, tel, puntos);
        }
        db.prepare("INSERT INTO movimientos_puntos (id_cliente,telefono,tipo,puntos,concepto,id_ticket) VALUES (?,?,'acumulacion',?,?,?)").run(idCliente, tel, puntos, 'Compra en tienda $' + Number(ticket.total||0).toFixed(0), ticket.id);
        db.prepare("UPDATE tickets_venta SET puntos_reclamados=1, reclamado_en=datetime('now','localtime') WHERE id=?").run(ticket.id);
    });
    _txPuntos();

    // 9. Verificar si ganó regalo(s)
    const saldoActual = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(idCliente);
    const disponibles = (saldoActual.puntos_ganados || 0) - (saldoActual.puntos_canjeados || 0);
    const regalosGanados = Math.floor(disponibles / PUNTOS_REGALO);
    const regalosYaGenerados = db.prepare(`
        SELECT COUNT(*) AS n FROM regalos_lealtad WHERE id_cliente=? AND estatus='activo'
    `).get(idCliente)?.n || 0;
    const regalosAGenerar = regalosGanados - regalosYaGenerados;
    // Antes de generar nada — si nunca había tenido un cupón, este es su primero
    // (usado por puntosHandler.js para invitar a compartir el código de referido).
    const esPrimerCupon = regalosYaGenerados === 0;

    const cuponesNuevos = [];
    // Emite un cupón de forma atómica: lo escribe en `promociones` (donde el
    // checkout lo canjea con aplicarCupon), lo registra en `regalos_lealtad`
    // (historial/dashboard) y descuenta los puntos.
    const _emitirCupon = db.transaction((cupon, hoy, expira) => {
        // 1) Código canjeable — tipo porcentaje, 10%, un solo uso (no acumulable),
        //    id_producto NULL = aplica al total del pedido.
        db.prepare(`
            INSERT INTO promociones (codigo, tipo, valor, id_producto,
                                     fecha_inicio, fecha_fin, usos_max, usos_actual, activa)
            VALUES (?, 'porcentaje', ?, NULL, ?, ?, 1, 0, 1)
        `).run(cupon, PCT_DESCUENTO, hoy, expira);
        // 2) Historial de lealtad — `valor` ahora guarda el porcentaje
        db.prepare(`
            INSERT INTO regalos_lealtad (id_cliente, telefono, codigo_cupon, valor, puntos_usados, expira_en)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(idCliente, tel, cupon, PCT_DESCUENTO, PUNTOS_REGALO, expira);
        // 3) Canje de puntos
        db.prepare(`
            INSERT INTO movimientos_puntos (id_cliente, telefono, tipo, puntos, concepto)
            VALUES (?, ?, 'canje', ?, ?)
        `).run(idCliente, tel, -PUNTOS_REGALO, 'Canje cupón ' + PCT_DESCUENTO + '% descuento');
        db.prepare(`
            UPDATE puntos_cliente SET puntos_canjeados=puntos_canjeados+? WHERE id_cliente=?
        `).run(PUNTOS_REGALO, idCliente);
    });

    for (let i = 0; i < regalosAGenerar; i++) {
        const cupon  = generarCodigoRegalo();
        const hoy    = new Date().toISOString().slice(0, 10);
        const expira = new Date(Date.now() + VIGENCIA_REGALO * 24 * 60 * 60_000)
            .toISOString().slice(0, 10);
        _emitirCupon(cupon, hoy, expira);
        cuponesNuevos.push({ cupon, expira, pct: PCT_DESCUENTO });
    }

    // 10. Calcular nuevo saldo
    const saldoFinal   = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(idCliente);
    const dispFinal    = (saldoFinal.puntos_ganados || 0) - (saldoFinal.puntos_canjeados || 0);
    const faltanParaSig = PUNTOS_REGALO - (dispFinal % PUNTOS_REGALO);

    return {
        ok:            true,
        puntosSumados: puntos,
        puntosDisp:    dispFinal,
        faltanParaSig,
        cuponesNuevos,
        esPrimerCupon: esPrimerCupon && cuponesNuevos.length > 0,
        idCliente,
        nombre:        ticket.nombre || '',
    };
}

function generarCodigoRegalo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = 'LEAL-';
    for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
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
            '\u2B50 \u00a1' + nombre + '! Tienes *' + disp + ' puntos* acumulados en Julio Cepeda Jugueter\u00edas.\n\n' +
            (faltan < 2000
                ? 'Te faltan solo *' + faltan + ' puntos* ($' + faltan + ' en compras) para ganar un *cupón de 10% de descuento* en tu próxima compra. \uD83C\uDFF7\uFE0F\n\n'
                : '') +
            'Recuerda que tus puntos vencen si no los usas en 12 meses.\n\n' +
            '\u00bfNos visitas pronto? Escribe *hola* para ver nuestro cat\u00e1logo.';
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

module.exports = { prepararTicket, reclamarTicket, consultarSaldo, checkPuntosInactivos, generarCodigoQR };
