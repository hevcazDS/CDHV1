// ═══════════════════════════════════════════════════════
//  clientes.js — alta/actualización de cliente y dirección guardada.
//  Extraído mecánicamente de bot/flows/_shared.js, sin cambio de lógica.
// ═══════════════════════════════════════════════════════
const { db, sessionManager, S } = require('./_base');

function upsertCliente(telefono, nombre = null) {
    let c = db.prepare('SELECT * FROM clientes WHERE telefono=?').get(telefono);
    if (!c) {
        db.prepare(`INSERT INTO clientes (nombre,telefono,canal_origen,activo) VALUES (?,?,'whatsapp',1)`).run(nombre, telefono);
        c = db.prepare('SELECT * FROM clientes WHERE telefono=?').get(telefono);
    } else if (nombre) {
        db.prepare(`UPDATE clientes SET nombre=?, ultima_actividad=datetime('now','localtime') WHERE id=?`).run(nombre, c.id);
        c.nombre = nombre;
    }
    return c;
}

// Última dirección guardada de un cliente (direcciones_envio se inserta en
// cada pedido con envío, siempre es_default=1, sin chequeo de unicidad — la
// más reciente por id es la mejor aproximación a "su dirección actual").
function buscarDireccionGuardada(telefono) {
    try {
        return db.prepare(`
            SELECT c.nombre AS nombre, d.calle, d.colonia, d.ciudad, d.estado, d.cp, d.referencia
            FROM direcciones_envio d
            JOIN clientes c ON c.id = d.id_cliente
            WHERE c.telefono = ?
            ORDER BY d.id DESC LIMIT 1
        `).get(telefono) || null;
    } catch (_) { return null; }
}

// Punto de entrada único para iniciar la captura de dirección de envío. Si
// el cliente ya tiene una dirección guardada, ofrece reusarla (vía
// S.CONFIRM_DIR_GUARDADA) en vez de volver a pedir nombre/calle/colonia/
// ciudad/referencia desde cero — centraliza lo que antes eran 5 sitios
// duplicados en orderFlow.js que iban directo a S.ASK_NOMBRE.
function iniciarCapturaDireccion(userId, tel, dataBase) {
    const guardada = buscarDireccionGuardada(tel);
    if (guardada && guardada.calle) {
        sessionManager.updateSession(userId, S.CONFIRM_DIR_GUARDADA, { ...dataBase, direccionGuardada: guardada });
        return (
            `📍 Tenemos esta dirección guardada de tu última compra:\n\n` +
            `${guardada.nombre || ''}\n${guardada.calle}, ${guardada.colonia}\n` +
            `${guardada.ciudad}${guardada.estado ? ', ' + guardada.estado : ''}\n` +
            (guardada.referencia ? `Ref: ${guardada.referencia}\n` : '') +
            `\n1️⃣  ✅ Usar esta dirección\n2️⃣  ✏️ Usar otra dirección`
        );
    }
    sessionManager.updateSession(userId, S.ASK_NOMBRE, dataBase);
    return `¿Cuál es tu *nombre completo*?`;
}

module.exports = {
    upsertCliente,
    buscarDireccionGuardada,
    iniciarCapturaDireccion,
};
