'use strict';
// Check-in / asistencia (gym P1): registra cada visita del cliente al gimnasio/
// estudio (control de acceso simple, sin torniquete). Front desk = área 'operacion'.
// Ver migración 0083. Distinto de citas (una reserva) — esto es la entrada real.
const construirModulo = require('./_construirModulo');

// POST /api/asistencias { telefono?|id_cliente?|nombre? } — registra un check-in
// del día. Resuelve el cliente por teléfono/id; guarda nombre para el mostrador.
function checkin(req, res, ctx, { ses }) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, d => {
        let cli = null;
        try {
            if (d.id_cliente) cli = db.prepare('SELECT id, nombre, telefono FROM clientes WHERE id=?').get(Number(d.id_cliente));
            else if (d.telefono) cli = db.prepare('SELECT id, nombre, telefono FROM clientes WHERE telefono=?').get(String(d.telefono).replace(/\D/g, ''));
        } catch (_) {}
        const nombre = (cli && cli.nombre) || String(d.nombre || '').trim().slice(0, 80) || 'Visitante';
        const tel = (cli && cli.telefono) || (d.telefono ? String(d.telefono).replace(/\D/g, '') : null);
        const id = db.prepare('INSERT INTO asistencias (id_cliente, telefono, nombre, registrado_por) VALUES (?,?,?,?)')
            .run(cli ? cli.id : null, tel, nombre, ses?.username || null).lastInsertRowid;
        // visitas del mes de ese cliente (motiva/mide uso de la membresía)
        let visitasMes = 1;
        try {
            if (cli) visitasMes = db.prepare("SELECT COUNT(*) n FROM asistencias WHERE id_cliente=? AND strftime('%Y-%m',fecha)=strftime('%Y-%m','now','localtime')").get(cli.id).n;
        } catch (_) {}
        return json(res, { ok: true, id, nombre, visitas_mes: visitasMes });
    });
}

// GET /api/asistencias?fecha=YYYY-MM-DD — visitas del día (default hoy) + total.
function listar(req, res, ctx, { u }) {
    const { db, json } = ctx;
    // default hoy en HORA LOCAL (la columna fecha se llena con date('now','localtime')):
    // usar UTC aquí dejaba la bandeja del día en 0 tras las 18:00 en México.
    const fecha = (u.searchParams.get('fecha') || db.prepare("SELECT date('now','localtime') d").get().d).slice(0, 10);
    const rows = db.prepare('SELECT id, nombre, telefono, hora, id_cliente FROM asistencias WHERE fecha=? ORDER BY id DESC LIMIT 300').all(fecha);
    return json(res, { fecha, total: rows.length, asistencias: rows });
}

const RUTAS = [
    { metodo: 'POST', path: '/api/asistencias', area: 'operacion', handler: checkin },
    { metodo: 'GET',  path: '/api/asistencias', area: 'operacion', handler: listar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/asistencias' });
module.exports._test = { checkin, listar };
