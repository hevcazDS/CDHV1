// stockService.js — Motor de stock inteligente
// Estrategias: red nacional, lista espera, preventa, sustitutos, alertas
'use strict';
const db = require('../bot/db_connection');
const log = require('../bot/logger')('stockService');

// ── Mapeo sucursal → días de entrega desde esa plaza ─────────────────────
const DIAS_ENTREGA = {
    'San Luis Potosí':      1,
    'Guanajuato':           2,
    'Jalisco':              2,
    'Michoacan':            2,
    'Estado de Mexico':     3,
    'Nuevo Leon':           3,
    'Puebla':               3,
    'Veracruz':             4,
    'Chihuahua':            4,
    'Durango':              5,
    'Baja California Norte':5,
};
const COSTO_ENVIO_NACIONAL = 149;

// ═══════════════════════════════════════════════════════
//  ESTRATEGIA 1 — Buscar en red nacional
// ═══════════════════════════════════════════════════════
function buscarEnRedNacional(idProducto) {
    const rows = db.prepare(
        `SELECT sucursal, stock FROM inventarios
         WHERE id_producto=? AND stock > 0
         ORDER BY stock DESC`
    ).all(idProducto);

    if (!rows.length) return { disponible: false };

    // Ordenar por días de entrega (más cercano primero)
    const ordenadas = rows
        .map(r => ({
            sucursal:     r.sucursal,
            stock:        r.stock,
            diasEntrega:  DIAS_ENTREGA[r.sucursal] || 5,
            costoEnvio:   COSTO_ENVIO_NACIONAL,
        }))
        .sort((a, b) => a.diasEntrega - b.diasEntrega);

    return { disponible: true, opciones: ordenadas, mejor: ordenadas[0] };
}

// ═══════════════════════════════════════════════════════
//  ESTRATEGIA 2 — Lista de espera
// ═══════════════════════════════════════════════════════
function registrarListaEspera(telefono, idProducto, nombreCliente, cantidad = 1) {
    // Evitar duplicados activos
    const existe = db.prepare(
        `SELECT id FROM lista_espera
         WHERE telefono=? AND id_producto=? AND estatus='activa'`
    ).get(telefono, idProducto);
    if (existe) return { ok: false, razon: 'ya_registrado', id: existe.id };

    const prod = db.prepare('SELECT price FROM productos WHERE id=?').get(idProducto);
    const cli  = db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);

    // Generar folio ESP-
    const serie = db.prepare("SELECT prefijo, ultimo_folio, longitud FROM series_folios WHERE tipo='lista_espera'").get();
    let folio = `ESP-${Date.now()}`;
    if (serie) {
        const n = serie.ultimo_folio + 1;
        db.prepare("UPDATE series_folios SET ultimo_folio=? WHERE tipo='lista_espera'").run(n);
        folio = `${serie.prefijo}${String(n).padStart(serie.longitud, '0')}`;
    }

    const posicion = (db.prepare(
        `SELECT COUNT(*) AS n FROM lista_espera WHERE id_producto=? AND estatus='activa'`
    ).get(idProducto)?.n || 0) + 1;

    db.prepare(`
        INSERT INTO lista_espera
            (id_producto, id_cliente, telefono, nombre_cliente, cantidad,
             precio_al_registrar, estatus, canal, notas)
        VALUES (?, ?, ?, ?, ?, ?, 'activa', 'whatsapp', ?)
    `).run(
        idProducto,
        cli?.id || null,
        telefono,
        nombreCliente || telefono,
        cantidad,
        prod?.price || 0,
        folio
    );

    return { ok: true, folio, posicion };
}

function contarEnEspera(idProducto) {
    return db.prepare(
        `SELECT COUNT(*) AS n FROM lista_espera WHERE id_producto=? AND estatus='activa'`
    ).get(idProducto)?.n || 0;
}

function notificarListaEspera(idProducto) {
    const esperas = db.prepare(
        `SELECT * FROM lista_espera WHERE id_producto=? AND estatus='activa' ORDER BY id`
    ).all(idProducto);
    if (!esperas.length) return [];

    const prod = db.prepare('SELECT name, price FROM productos WHERE id=?').get(idProducto);
    const ahora = new Date();
    const expira = new Date(ahora.getTime() + 48 * 3600_000)
        .toISOString().replace('T', ' ').slice(0, 19);

    const notificados = [];
    for (const e of esperas) {
        const cuerpo =
            `\uD83C\uDF89 \u00a1${e.nombre_cliente || 'Hola'}! Llegaron los *${prod?.name || 'producto'}* que estabas esperando.\n\n` +
            `\uD83D\uDCB0 Precio: *$${Number(prod?.price || 0).toFixed(2)} MXN*\n\n` +
            `\u26A0\uFE0F Tienes *48 horas* para apartar el tuyo.\n\n` +
            `1\uFE0F\u20E3  \uD83D\uDED2 \u00a1Quiero uno ahora!\n` +
            `2\uFE0F\u20E3  \u274C Ya no lo necesito, gracias`;

        try {
            db.prepare(`
                INSERT INTO cola_notificaciones
                    (tipo, destinatario, asunto, cuerpo, id_pedido, estatus)
                VALUES ('whatsapp', ?, ?, ?, NULL, 'pendiente')
            `).run(e.telefono, `Stock disponible: ${prod?.name}`, cuerpo);

            db.prepare(`
                UPDATE lista_espera
                SET estatus='notificado', notificado_en=datetime('now','localtime'),
                    expira_notif_en=?
                WHERE id=?
            `).run(expira, e.id);

            notificados.push(e.telefono);
        } catch (err) {
            log.warn('Error encolando lista_espera', err);
        }
    }
    return notificados;
}

// ═══════════════════════════════════════════════════════
//  ESTRATEGIA 3 — Preventa
// ═══════════════════════════════════════════════════════
function obtenerPreventaActiva(idProducto) {
    return db.prepare(
        `SELECT p.*, pr.name AS nombre_producto, pr.price AS precio_producto
         FROM preventas p JOIN productos pr ON pr.id = p.id_producto
         WHERE p.id_producto=? AND p.activa=1
           AND p.stock_comprometido < p.stock_maximo
         ORDER BY p.id DESC LIMIT 1`
    ).get(idProducto) || null;
}

function registrarPreventa(telefono, idPreventa, nombreCliente, cantidad = 1) {
    const prev = db.prepare('SELECT * FROM preventas WHERE id=? AND activa=1').get(idPreventa);
    if (!prev) return { ok: false, razon: 'preventa_no_encontrada' };
    if (prev.stock_comprometido + cantidad > prev.stock_maximo)
        return { ok: false, razon: 'sin_cupo' };

    const cli = db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);

    // Generar folio PREV-
    const serie = db.prepare("SELECT prefijo, ultimo_folio, longitud FROM series_folios WHERE tipo='preventa'").get();
    let folio = `PREV-${Date.now()}`;
    if (serie) {
        const n = serie.ultimo_folio + 1;
        db.prepare("UPDATE series_folios SET ultimo_folio=? WHERE tipo='preventa'").run(n);
        folio = `${serie.prefijo}${String(n).padStart(serie.longitud, '0')}`;
    }

    const precioTotal   = prev.precio_preventa * cantidad;
    const anticipo      = +(precioTotal * (prev.porcentaje_anticipo / 100)).toFixed(2);
    const saldoPendiente = +(precioTotal - anticipo).toFixed(2);

    db.prepare(`
        INSERT INTO preventa_clientes
            (id_preventa, id_cliente, telefono, nombre_cliente, cantidad,
             precio_total, anticipo_pagado, saldo_pendiente, folio, estatus)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'apartado')
    `).run(idPreventa, cli?.id || null, telefono, nombreCliente || telefono,
           cantidad, precioTotal, saldoPendiente, folio);

    db.prepare('UPDATE preventas SET stock_comprometido=stock_comprometido+? WHERE id=?')
      .run(cantidad, idPreventa);

    // Fecha de llegada legible
    let fechaLlegada = prev.fecha_llegada_est;
    try {
        const d = new Date(prev.fecha_llegada_est);
        fechaLlegada = d.toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long' });
    } catch (_) {}

    return { ok: true, folio, anticipo, saldoPendiente, fechaLlegada, precioTotal };
}

// ═══════════════════════════════════════════════════════
//  ESTRATEGIA 4 — Sustitutos
// ═══════════════════════════════════════════════════════
function buscarSustitutos(idProducto, limite = 3) {
    // Primero: relaciones definidas manualmente
    const definidos = db.prepare(`
        SELECT ps.score, ps.tipo_relacion,
               p.id, p.name, p.cat, p.price, p.url_imagen, p.seo_description,
               p.stock_tienda, p.stock_cedis
        FROM productos_similares ps
        JOIN productos p ON p.id = ps.id_sustituto
        WHERE ps.id_producto=? AND ps.activa=1
          AND p.activo=1 AND (p.stock_tienda > 0 OR p.stock_cedis > 0)
        ORDER BY ps.score DESC, p.price ASC
        LIMIT ?
    `).all(idProducto, limite);

    if (definidos.length >= limite) return definidos;

    // Fallback: misma categoría, precio ±30%, con stock
    return buscarSustitutosAuto(idProducto, 0.30, limite);
}

function buscarSustitutosAuto(idProducto, rango = 0.30, limite = 3) {
    const base = db.prepare('SELECT cat, price FROM productos WHERE id=?').get(idProducto);
    if (!base) return [];
    const minP = base.price * (1 - rango);
    const maxP = base.price * (1 + rango);
    return db.prepare(`
        SELECT id, name, cat, price, url_imagen, seo_description,
               stock_tienda, stock_cedis, 0 AS score
        FROM productos
        WHERE activo=1 AND id != ?
          AND cat=? AND price BETWEEN ? AND ?
          AND (stock_tienda > 0 OR stock_cedis > 0)
        ORDER BY price ASC
        LIMIT ?
    `).all(idProducto, base.cat, minP, maxP, limite);
}

// ═══════════════════════════════════════════════════════
//  ESTRATEGIA 5 — Alertas de reabasto
// ═══════════════════════════════════════════════════════
function registrarAlertaReabasto(telefono, idProducto, nombreCliente) {
    const existe = db.prepare(
        `SELECT id FROM alertas_reabasto
         WHERE telefono=? AND id_producto=? AND estatus='activa'`
    ).get(telefono, idProducto);
    if (existe) return { ok: true, yaExistia: true };

    const cli = db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);
    db.prepare(`
        INSERT INTO alertas_reabasto
            (id_producto, id_cliente, telefono, nombre_cliente, umbral_stock, tipo_alerta, estatus)
        VALUES (?, ?, ?, ?, 1, 'reabasto', 'activa')
    `).run(idProducto, cli?.id || null, telefono, nombreCliente || telefono);

    return { ok: true, yaExistia: false };
}

function verificarAlertas() {
    const alertas = db.prepare(
        `SELECT a.*, p.name AS nombre_producto, p.stock_tienda, p.stock_cedis
         FROM alertas_reabasto a JOIN productos p ON p.id = a.id_producto
         WHERE a.estatus='activa'`
    ).all();

    let disparadas = 0;
    for (const a of alertas) {
        const stockTotal = (a.stock_tienda || 0) + (a.stock_cedis || 0);
        if (stockTotal >= a.umbral_stock) {
            const cuerpo =
                `\uD83D\uDD14 \u00a1${a.nombre_cliente || 'Hola'}! El producto que esperabas ya est\u00e1 disponible.\n\n` +
                `\uD83E\uDDF8 *${a.nombre_producto}*\n` +
                `\uD83D\uDCE6 Stock disponible: *${stockTotal} unidades*\n\n` +
                `\u00bfQuieres comprarlo ahora? Escribe *hola* para iniciar.`;

            try {
                db.prepare(`
                    INSERT INTO cola_notificaciones
                        (tipo, destinatario, asunto, cuerpo, estatus)
                    VALUES ('whatsapp', ?, ?, ?, 'pendiente')
                `).run(a.telefono, `Reabasto: ${a.nombre_producto}`, cuerpo);

                db.prepare(`
                    UPDATE alertas_reabasto
                    SET estatus='disparada', disparada_en=datetime('now','localtime')
                    WHERE id=?
                `).run(a.id);
                disparadas++;
            } catch (err) {
                log.warn('Error alerta reabasto', err);
            }
        }
    }
    return disparadas;
}

module.exports = {
    buscarEnRedNacional,
    registrarListaEspera,
    contarEnEspera,
    notificarListaEspera,
    obtenerPreventaActiva,
    registrarPreventa,
    buscarSustitutos,
    buscarSustitutosAuto,
    registrarAlertaReabasto,
    verificarAlertas,
};
