'use strict';
// Lookups (categorías/marcas), historial de cola, reporte, reset beta, métricas,
// conversión, ofertas, cupones y promociones. Migrado al patrón declarativo:
// lecturas → gate global; reporte/promociones → gerente; beta/limpiar → prime.
const construirModulo = require('./_construirModulo');

function categorias(req, res, ctx) {
    const { db, json } = ctx;
    try { return json(res, db.prepare('SELECT id, nombre FROM categorias WHERE activa = 1 ORDER BY nombre').all()); }
    catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}
function marcas(req, res, ctx) {
    const { db, json } = ctx;
    try { return json(res, db.prepare("SELECT DISTINCT brand FROM productos WHERE brand IS NOT NULL AND TRIM(brand) != '' ORDER BY brand").all().map(r => r.brand)); }
    catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

function colaHistorial(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, db.prepare(`
        SELECT id, destinatario, asunto, estatus, intentos, creada_en, enviar_despues_de
        FROM cola_notificaciones WHERE estatus IN ('enviado','error','cancelado')
        ORDER BY creada_en DESC LIMIT 50`).all());
}

// POST /api/reporte — genera/envía reporte (WhatsApp o email). Gerente+.
function reporte(req, res, ctx) {
    const { json, readBody, reporteService } = ctx;
    return readBody(req, body => {
        try {
            const { destino } = JSON.parse(body);
            const { status, ...payload } = reporteService.enviarReporte(destino);
            return json(res, payload, status);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/beta/limpiar — reset de un betatester por teléfono. Prime + código.
function betaLimpiar(req, res, ctx) {
    const { db, json, readBody, log, safeEqual } = ctx;
    return readBody(req, body => {
        try {
            const { codigo, telefono } = JSON.parse(body);
            const BETA_CODE = process.env.BETA_RESET_CODE || '';
            if (!BETA_CODE || !safeEqual(codigo, BETA_CODE)) return json(res, { ok: false, error: 'Código incorrecto' }, 403);
            if (!telefono) return json(res, { ok: false, error: 'Falta el teléfono' }, 400);
            const tel = telefono.replace(/[^0-9@.]/g, '');
            const borrado = {};
            borrado.sesion = db.prepare(`DELETE FROM sesiones_bot WHERE id_usuario LIKE ?`).run('%' + tel + '%').changes;
            const cli = db.prepare(`SELECT id FROM clientes WHERE telefono LIKE ?`).get('%' + tel + '%');
            if (cli) {
                borrado.lista_espera = db.prepare(`DELETE FROM lista_espera WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%' + tel + '%').changes;
                borrado.carritos = db.prepare(`DELETE FROM carritos_abandonados WHERE telefono LIKE ?`).run('%' + tel + '%').changes;
                borrado.alertas = db.prepare(`DELETE FROM alertas_reabasto WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%' + tel + '%').changes;
                borrado.valoraciones = db.prepare(`DELETE FROM valoraciones WHERE id_cliente=?`).run(cli.id).changes;
                borrado.cola_notif = db.prepare(`DELETE FROM cola_notificaciones WHERE destinatario LIKE ?`).run('%' + tel + '%').changes;
                borrado.cola_atencion = db.prepare(`DELETE FROM cola_atencion WHERE id_cliente=?`).run(cli.id).changes;
                borrado.preventa_cli = db.prepare(`DELETE FROM preventa_clientes WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%' + tel + '%').changes;
                borrado.cliente = db.prepare(`DELETE FROM clientes WHERE id=?`).run(cli.id).changes;
            }
            log.info('Reset betatestor: ' + JSON.stringify(borrado), { userId: tel });
            return json(res, { ok: true, telefono: tel, borrado });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/metricas — métricas completas del sistema
function metricas(req, res, ctx) {
    const { db, json } = ctx;
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const semana = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const mes = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const _pHoy = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)=?").get(hoy);
    const _pAyer = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)=?").get(ayer);
    const _pSem = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=?").get(semana);
    const _pMes = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=?").get(mes);
    const _pTotal = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos").get();
    const _cHoy = db.prepare("SELECT COUNT(*) n FROM clientes WHERE date(creado_en)=?").get(hoy)?.n || 0;
    const _cSem = db.prepare("SELECT COUNT(*) n FROM clientes WHERE date(creado_en)>=?").get(semana)?.n || 0;
    const _cTotal = db.prepare("SELECT COUNT(*) n FROM clientes WHERE activo=1").get()?.n || 0;
    const _pagPend = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='generado'").get();
    const _pagPag = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado'").get();
    const _csat = db.prepare("SELECT AVG(calificacion) promedio, COUNT(*) n FROM valoraciones").get() || {};
    const _ingHoy = db.prepare("SELECT COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado' AND date(pagado_en)=?").get(hoy)?.t || 0;
    const _ingSem = db.prepare("SELECT COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado' AND date(pagado_en)>=?").get(semana)?.t || 0;
    const _ingMes = db.prepare("SELECT COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado' AND date(pagado_en)>=?").get(mes)?.t || 0;
    const _escHoy = db.prepare("SELECT COUNT(*) n FROM cola_atencion WHERE date(creada_en)=?").get(hoy)?.n || 0;
    const _escSem = db.prepare("SELECT COUNT(*) n FROM cola_atencion WHERE date(creada_en)>=?").get(semana)?.n || 0;
    const _notifHoy = db.prepare("SELECT COUNT(*) n FROM cola_notificaciones WHERE estatus='enviado' AND date(creada_en)=?").get(hoy)?.n || 0;
    const _porEstatus = db.prepare("SELECT estatus, COUNT(*) n FROM pedidos GROUP BY estatus ORDER BY n DESC").all();
    const _porDia = db.prepare("SELECT date(creado_en) AS dia, COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=? GROUP BY dia ORDER BY dia").all(semana);
    const _puntosTotal = db.prepare("SELECT COALESCE(SUM(puntos_ganados),0) n FROM puntos_cliente").get()?.n || 0;
    const _puntosClientes = db.prepare("SELECT COUNT(*) n FROM puntos_cliente WHERE puntos_ganados > 0").get()?.n || 0;
    return json(res, {
        pedidos: { hoy: _pHoy, ayer: _pAyer, semana: _pSem, mes: _pMes, total: _pTotal },
        clientes: { hoy: _cHoy, semana: _cSem, total: _cTotal },
        pagos: { pendientes: _pagPend, pagados: _pagPag },
        ingresos: { hoy: _ingHoy, semana: _ingSem, mes: _ingMes },
        csat: { promedio: _csat.promedio || null, n: _csat.n || 0 },
        escaladas: { hoy: _escHoy, semana: _escSem },
        notificaciones_hoy: _notifHoy,
        por_estatus: _porEstatus, por_dia: _porDia,
        puntos: { total: _puntosTotal, clientes_con_puntos: _puntosClientes },
    });
}

// GET /api/conversion — tasa de conversión
function conversion(req, res, ctx) {
    const { db, json } = ctx;
    const pedidos = db.prepare("SELECT COUNT(*) n FROM pedidos WHERE estatus NOT IN ('cancelado','Cancelado')").get()?.n || 0;
    const clientes = db.prepare("SELECT COUNT(*) n FROM clientes WHERE activo=1").get()?.n || 0;
    const tasa = clientes > 0 ? Number(((pedidos / clientes) * 100).toFixed(1)) : 0;
    const topBusquedas = db.prepare("SELECT valor AS busqueda, COUNT(*) AS veces FROM log_eventos WHERE tipo_evento='busqueda' GROUP BY valor ORDER BY veces DESC LIMIT 10").all();
    const porTono = db.prepare(`
        SELECT COALESCE(tono_bot, 'sin_dato') AS tono, COUNT(*) AS pedidos,
               COALESCE(SUM(total), 0) AS ingresos, COALESCE(AVG(total), 0) AS ticket_promedio
        FROM pedidos WHERE estatus NOT IN ('cancelado','Cancelado') GROUP BY tono ORDER BY pedidos DESC`).all();
    const conversionPorTono = db.prepare(`
        SELECT COALESCE(tono_bot, 'sin_dato') AS tono, COUNT(*) AS total, COALESCE(SUM(compro), 0) AS convertidos
        FROM log_eventos WHERE tipo_evento = 'busqueda' GROUP BY tono ORDER BY total DESC`).all()
        .map(r => ({ ...r, tasa: r.total > 0 ? +((r.convertidos / r.total) * 100).toFixed(1) : 0 }));
    return json(res, { busquedas_total: 0, pedidos_total: pedidos, clientes_total: clientes, tasa_conversion: tasa + '%', top_busquedas: topBusquedas, por_tono: porTono, conversion_por_tono: conversionPorTono });
}

// GET /api/ofertas — ofertas activas, una fila por producto afectado
function ofertas(req, res, ctx) {
    const { db, json } = ctx;
    const hoy = new Date().toISOString().slice(0, 10);
    const promos = db.prepare(`SELECT * FROM promociones WHERE activa = 1 AND (fecha_fin IS NULL OR fecha_fin >= ?)`).all(hoy);
    const out = [];
    for (const pr of promos) {
        let productos;
        if (pr.id_producto) productos = db.prepare('SELECT id, name, price FROM productos WHERE id=? AND activo=1').all(pr.id_producto);
        else if (pr.id_categoria) productos = db.prepare('SELECT id, name, price FROM productos WHERE id_categoria=? AND activo=1 LIMIT 200').all(pr.id_categoria);
        else if (pr.brand) productos = db.prepare('SELECT id, name, price FROM productos WHERE brand=? AND activo=1 LIMIT 200').all(pr.brand);
        else if (pr.edad_min != null || pr.edad_max != null) {
            const min = pr.edad_min ?? 0, max = pr.edad_max ?? 99;
            productos = db.prepare('SELECT id, name, price FROM productos WHERE activo=1 AND edad_min <= ? AND edad_max >= ? LIMIT 200').all(max, min);
        } else productos = db.prepare('SELECT id, name, price FROM productos WHERE activo=1 LIMIT 200').all();
        for (const prod of productos) {
            const precioOferta = pr.tipo === 'monto' ? Math.max(prod.price - pr.valor, 0) : prod.price * (1 - pr.valor / 100.0);
            out.push({
                id: pr.id, codigo: pr.codigo, tipo: pr.tipo, valor: pr.valor, fecha_fin: pr.fecha_fin,
                usos_actual: pr.usos_actual, usos_max: pr.usos_max,
                id_producto: prod.id, nombre: prod.name, precio_original: prod.price,
                precio_oferta: Math.round(precioOferta * 100) / 100,
            });
        }
    }
    out.sort((a, b) => b.valor - a.valor);
    return json(res, out.slice(0, 200));
}

// GET /api/cupon/validar?codigo=X — valida cualquier código de promociones
function cuponValidar(req, res, ctx) {
    const { db, json } = ctx;
    const codigo = (new URL('http://x' + req.url).searchParams.get('codigo') || '').trim();
    if (!codigo) return json(res, { ok: false, error: 'Falta código' }, 400);
    const hoy = new Date().toISOString().slice(0, 10);
    const promo = db.prepare(`
        SELECT * FROM promociones WHERE UPPER(codigo) = UPPER(?) AND activa = 1
          AND (fecha_inicio IS NULL OR fecha_inicio <= ?) AND (fecha_fin IS NULL OR fecha_fin >= ?)
          AND (usos_max = 0 OR usos_actual < usos_max) LIMIT 1`).get(codigo, hoy, hoy);
    if (!promo) return json(res, { ok: false, error: 'Código no válido o expirado' });
    return json(res, { ok: true, codigo: promo.codigo, tipo: promo.tipo, valor: promo.valor, id_producto: promo.id_producto });
}

// (POST /api/cupon/redimir se BORRÓ 2026-07: era el flujo de ticket físico ya
// retirado — el POS valida con /api/cupon/validar y redime inline en /api/pos/venta.)

// GET /api/promociones — vista de gestión (con alcance calculado)
function promocionesGet(req, res, ctx) {
    const { db, json } = ctx;
    const soloActivas = new URL('http://x' + req.url).searchParams.get('activa');
    let sql = `
        SELECT pr.*, p.name AS nombre_producto, c.nombre AS nombre_categoria
        FROM promociones pr
        LEFT JOIN productos p ON p.id = pr.id_producto
        LEFT JOIN categorias c ON c.id = pr.id_categoria`;
    const params = [];
    if (soloActivas !== null) { sql += ' WHERE pr.activa = ?'; params.push(soloActivas === '1' ? 1 : 0); }
    sql += ' ORDER BY pr.creada_en DESC LIMIT 300';
    const rows = db.prepare(sql).all(...params).map(r => {
        let alcance;
        if (r.id_producto) alcance = 'Producto: ' + (r.nombre_producto || r.id_producto);
        else if (r.id_categoria) alcance = 'Categoría: ' + (r.nombre_categoria || r.id_categoria);
        else if (r.brand) alcance = 'Marca: ' + r.brand;
        else if (r.edad_min != null || r.edad_max != null) alcance = 'Edad: ' + (r.edad_min ?? 0) + ' a ' + (r.edad_max ?? 99);
        else alcance = 'Todo el inventario';
        return { ...r, alcance };
    });
    return json(res, rows);
}

// POST /api/promociones — crear cupón manual (gerente+; tope de descuento salvo prime)
function promocionesPost(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body);
            if (!d.codigo || d.tipo !== 'porcentaje' || !d.valor) {
                return json(res, { ok: false, error: 'Faltan codigo o valor, o tipo no es "porcentaje" (el descuento de monto fijo ya no está disponible)' }, 400);
            }
            if (!d.fecha_fin) return json(res, { ok: false, error: 'fecha_fin es obligatoria — toda oferta nueva debe tener vencimiento' }, 400);
            if (ses.rol !== 'prime') {
                const _topeRow = db.prepare("SELECT valor FROM configuracion WHERE clave='tope_descuento_pct' LIMIT 1").get();
                const tope = _topeRow ? Number(_topeRow.valor) : 30;
                if (tope > 0 && Number(d.valor) > tope) {
                    return json(res, { ok: false, error: `El descuento máximo permitido es ${tope}%. Solo el usuario prime puede crear descuentos mayores.` }, 403);
                }
            }
            const info = db.prepare(`
                INSERT INTO promociones (codigo, descripcion, tipo, valor, id_producto, id_categoria,
                                          brand, edad_min, edad_max, creado_por,
                                          activa, fecha_inicio, fecha_fin, usos_max, usos_actual, creada_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, datetime('now','localtime'))`).run(
                String(d.codigo).trim().toUpperCase(), d.descripcion || null, d.tipo, Number(d.valor),
                d.id_producto || null, d.id_categoria || null,
                d.brand || null, d.edad_min ?? null, d.edad_max ?? null, ses.username,
                d.fecha_inicio || null, d.fecha_fin || null, d.usos_max || 0);
            return json(res, { ok: true, id: info.lastInsertRowid });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/promociones/flash — cupón flash ligado a un envío masivo (gerente+)
function promocionesFlash(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body);
            const minutos = Number(d.minutos_validez);
            if (!d.codigo || d.tipo !== 'porcentaje' || !d.valor || !Number.isFinite(minutos) || minutos <= 0) {
                return json(res, { ok: false, error: 'Faltan codigo, valor o minutos_validez (debe ser > 0)' }, 400);
            }
            const usosMax = Number(d.usos_max) || 0;
            if (usosMax < 1) return json(res, { ok: false, error: 'Un cupón flash debe tener un máximo de redenciones (usos_max >= 1)' }, 400);
            if (ses.rol !== 'prime') {
                const _topeRow = db.prepare("SELECT valor FROM configuracion WHERE clave='tope_descuento_pct' LIMIT 1").get();
                const tope = _topeRow ? Number(_topeRow.valor) : 30;
                if (tope > 0 && Number(d.valor) > tope) {
                    return json(res, { ok: false, error: `El descuento máximo permitido es ${tope}%. Solo el usuario prime puede crear descuentos mayores.` }, 403);
                }
            }
            const ahora = new Date();
            const fin = new Date(ahora.getTime() + minutos * 60000);
            const fmtSqlite = (dt) => dt.toISOString().slice(0, 19).replace('T', ' ');
            const info = db.prepare(`
                INSERT INTO promociones (codigo, descripcion, tipo, valor, id_producto, id_categoria,
                                          brand, edad_min, edad_max, creado_por,
                                          activa, fecha_inicio, fecha_fin, usos_max, usos_actual, creada_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, datetime('now','localtime'))`).run(
                String(d.codigo).trim().toUpperCase(), d.descripcion || ('Cupón flash — vence en ' + minutos + ' min'), d.tipo, Number(d.valor),
                d.id_producto || null, d.id_categoria || null,
                d.brand || null, d.edad_min ?? null, d.edad_max ?? null, ses.username,
                fmtSqlite(ahora), fmtSqlite(fin), usosMax);
            return json(res, { ok: true, id: info.lastInsertRowid, codigo: String(d.codigo).trim().toUpperCase(), fecha_fin: fmtSqlite(fin) });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// PUT /api/promociones/:id — activar/desactivar (gerente+)
function promocionesPut(req, res, ctx, { params, ses }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const { activa, motivo_baja } = JSON.parse(body);
            if (activa) {
                db.prepare("UPDATE promociones SET activa=1, motivo_baja=NULL, baja_por=NULL, baja_en=NULL WHERE id=?").run(id);
            } else {
                db.prepare("UPDATE promociones SET activa=0, motivo_baja=?, baja_por=?, baja_en=datetime('now','localtime') WHERE id=?")
                    .run(motivo_baja || null, ses.username, id);
            }
            return json(res, { ok: true, id, activa: !!activa });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/categorias',              handler: categorias },
    { metodo: 'GET',  path: '/api/marcas',                  handler: marcas },
    { metodo: 'GET',  path: '/api/cola/historial',          handler: colaHistorial },
    { metodo: 'POST', path: '/api/reporte',                 roles: ['gerente'], handler: reporte },
    { metodo: 'POST', path: '/api/beta/limpiar',            roles: ['prime'], handler: betaLimpiar },
    { metodo: 'GET',  path: '/api/metricas',                roles: ['gerente'], handler: metricas },
    { metodo: 'GET',  path: '/api/conversion',              roles: ['gerente'], handler: conversion },
    { metodo: 'GET',  path: '/api/ofertas',                 handler: ofertas },
    { metodo: 'GET',  path: '/api/cupon/validar',           handler: cuponValidar },
    { metodo: 'GET',  path: '/api/promociones',             handler: promocionesGet },
    { metodo: 'POST', path: '/api/promociones',             roles: ['gerente'], handler: promocionesPost },
    { metodo: 'POST', path: '/api/promociones/flash',       roles: ['gerente'], handler: promocionesFlash },
    { metodo: 'PUT',  path: /^\/api\/promociones\/(\d+)$/,  roles: ['gerente'], handler: promocionesPut },
];

module.exports = construirModulo(RUTAS);
