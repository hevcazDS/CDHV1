// ventaPreviaService.js
// "Venta previa": un asesor arma un carrito desde el dashboard (POS) para
// un cliente, se le manda por WhatsApp y, cuando el cliente responde, el
// bot lo mete directo al flujo normal de carrito (SHOW_CART) para que
// confirme, eligiera recolección/envío y se genere el link de pago igual
// que si lo hubiera armado él mismo. Recibe `db` por parámetro (no lo
// requiere internamente) por la misma razón que mensajeService.js: lo usan
// tanto el dashboard como el bot, y un require interno rompería el mock de
// DB de tests/test_bot.js.

'use strict';

function _ensureTabla(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ventas_previas (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            telefono     TEXT NOT NULL,
            folio        TEXT,
            carrito_json TEXT NOT NULL,
            estatus      TEXT NOT NULL DEFAULT 'pendiente',
            creada_en    TEXT DEFAULT (datetime('now','localtime')),
            consumida_en TEXT
        )
    `);
}

function crearVentaPrevia(db, telefono, carrito, folio) {
    _ensureTabla(db);
    const info = db.prepare(
        `INSERT INTO ventas_previas (telefono, folio, carrito_json, estatus) VALUES (?,?,?,'pendiente')`
    ).run(telefono, folio || null, JSON.stringify(carrito));
    return info.lastInsertRowid;
}

// Solo la más reciente — si un asesor manda dos antes de que el cliente
// responda, la última gana (las anteriores quedan pendientes pero no se
// vuelven a usar una vez consumida la primera que encuentre el cliente).
function obtenerPendiente(db, telefono) {
    _ensureTabla(db);
    return db.prepare(
        `SELECT * FROM ventas_previas WHERE telefono=? AND estatus='pendiente' ORDER BY creada_en DESC LIMIT 1`
    ).get(telefono);
}

function marcarConsumida(db, id) {
    _ensureTabla(db);
    db.prepare(
        `UPDATE ventas_previas SET estatus='consumida', consumida_en=datetime('now','localtime') WHERE id=?`
    ).run(id);
}

module.exports = { crearVentaPrevia, obtenerPendiente, marcarConsumida };
