'use strict';
// Cola de atención, chat/conversaciones, reanudar-bot, actualización de guía,
// lista de espera, búsquedas, métricas de gerencia y preventas. Migrado al
// patrón declarativo del tronco: los reportes de /api/metricas/* y
// /api/gerente/reportes → gerente; actualizar_guia/crear preventa y los dos PUT
// de atención (cola_atencion/:id, clientes/:id/reanudar-bot) → operacion; las
// lecturas (cola/chat/lista-espera/busquedas/preventas GET) caen al gate global.
const construirModulo = require('./_construirModulo');

// GET /api/cola_atencion?estatus=
function colaAtencionGet(req, res, ctx) {
    const { db, json } = ctx;
    const estatusF = (new URL('http://x' + req.url).searchParams.get('estatus') || 'en_espera').trim();
    const rows = db.prepare(`
        SELECT ca.*, c.nombre AS cliente, c.telefono,
               (SELECT m.contenido FROM mensajes m JOIN conversaciones cv ON cv.id = m.id_conversacion
                WHERE cv.id_cliente = ca.id_cliente AND m.rol = 'cliente'
                ORDER BY m.enviado_en DESC LIMIT 1) AS ultimo_mensaje
        FROM cola_atencion ca LEFT JOIN clientes c ON c.id = ca.id_cliente
        WHERE ca.estatus = ? ORDER BY ca.prioridad ASC, ca.creada_en ASC LIMIT 200`).all(estatusF);
    return json(res, rows);
}

// PUT /api/cola_atencion/:id — el asesor marca atendida/resuelta
function colaAtencionPut(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const { estatus } = JSON.parse(body);
            if (!['en_espera', 'atendida', 'resuelta'].includes(estatus)) return json(res, { ok: false, error: 'Estatus inválido' }, 400);
            const campoFecha = estatus === 'atendida' ? 'atendida_en' : estatus === 'resuelta' ? 'resuelta_en' : null;
            db.prepare('UPDATE cola_atencion SET estatus=?' + (campoFecha ? `, ${campoFecha}=datetime('now','localtime')` : '') + ' WHERE id=?').run(estatus, id);
            return json(res, { ok: true, estatus });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// (GET /api/pedidos/:id/mensajes se BORRÓ 2026-07: redundante con
// /api/clientes/:id/mensajes — sin consumidores, auditoría de cobertura.)

// GET /api/clientes/:id/mensajes — conversación de un cliente
function clienteMensajes(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const rows = db.prepare('SELECT m.rol, m.contenido, m.enviado_en FROM mensajes m JOIN conversaciones cv ON cv.id=m.id_conversacion WHERE cv.id_cliente=? ORDER BY m.enviado_en DESC LIMIT 15').all(parseInt(params[0]));
    return json(res, rows.reverse());
}

// PUT /api/clientes/:id/reanudar-bot — regresa la conversación al flujo del bot
function reanudarBot(req, res, ctx, { params }) {
    const { db, json, readBody, iniciarCapturaDireccion, SESION_S, sessionManagerBot } = ctx;
    const idCli = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const { paso } = JSON.parse(body || '{}');
            if (!['confirmar_direccion', 'generar_pago'].includes(paso)) {
                return json(res, { ok: false, error: 'paso debe ser confirmar_direccion o generar_pago' }, 400);
            }
            const cliente = db.prepare('SELECT id, nombre, telefono FROM clientes WHERE id=?').get(idCli);
            if (!cliente || !cliente.telefono) return json(res, { ok: false, error: 'Cliente no encontrado o sin teléfono' }, 404);
            const idUsuario = cliente.telefono;
            if (paso === 'confirmar_direccion') {
                const mensaje = iniciarCapturaDireccion(idUsuario, idUsuario, {});
                db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Reanudar — confirmar dirección',?,'pendiente')").run(idUsuario, mensaje);
                return json(res, { ok: true, paso: 'confirmar_direccion', mensaje });
            }
            const link = db.prepare(`
                SELECT lp.* FROM links_pago lp JOIN pedidos p ON p.id_pedido = lp.id_pedido
                WHERE p.id_cliente = ? AND lp.estatus IN ('generado','cancelado') ORDER BY lp.id DESC LIMIT 1`).get(idCli);
            if (!link) return json(res, { ok: false, error: 'Este cliente no tiene ningún link de pago pendiente que reenviar' }, 404);
            const expirado = new Date(link.fecha_expiracion) < new Date();
            if (expirado || link.estatus === 'cancelado') {
                const nuevaExpira = new Date(Date.now() + 48 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
                db.prepare("UPDATE links_pago SET estatus='generado', fecha_expiracion=? WHERE id=?").run(nuevaExpira, link.id);
            }
            const mensaje = `💳 Aquí tienes de nuevo tu link de pago:\n${link.url_link}\n\nVálido por 48 horas.`;
            db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Reanudar — link de pago',?,'pendiente')").run(idUsuario, mensaje);
            sessionManagerBot.updateSession(idUsuario, SESION_S.MENU, {});
            return json(res, { ok: true, paso: 'generar_pago', mensaje });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/actualizar_guia — actualizar estatus de guía manualmente (operacion)
function actualizarGuia(req, res, ctx) {
    const { json, readBody, validar, GuiaSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body), GuiaSchema, res, '/api/actualizar_guia');
            if (!datos) return;
            const { numeroGuia, estatus, descripcion, ubicacion } = datos;
            const ok = require('../../services/estafetaService').actualizarEstatusGuia(numeroGuia, estatus, descripcion, ubicacion);
            return json(res, { ok, numeroGuia, estatus });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/lista-espera — agrupada por producto
function listaEspera(req, res, ctx) {
    const { db, json } = ctx;
    const rows = db.prepare(`
        SELECT le.id, le.telefono, le.nombre_cliente, le.cantidad, le.estatus, le.creada_en, le.notificado_en,
               p.name AS producto, p.price, p.stock_tienda, p.stock_cedis
        FROM lista_espera le JOIN productos p ON p.id = le.id_producto
        ORDER BY le.creada_en DESC LIMIT 200`).all();
    const porProducto = {};
    for (const r of rows) {
        if (!porProducto[r.producto]) porProducto[r.producto] = { nombre: r.producto, precio: r.price, stock_tienda: r.stock_tienda, stock_cedis: r.stock_cedis, esperas: [] };
        porProducto[r.producto].esperas.push(r);
    }
    return json(res, { lista: Object.values(porProducto), total: rows.length });
}

// GET /api/busquedas — log de búsquedas (defensivo con `compro`)
function busquedas(req, res, ctx) {
    const { db, json } = ctx;
    let rows;
    try {
        rows = db.prepare(`
            SELECT valor AS busqueda, COUNT(*) AS veces, MAX(registrado_en) AS ultima_vez, SUM(COALESCE(compro,0)) AS compras
            FROM log_eventos WHERE tipo_evento='busqueda' GROUP BY valor ORDER BY veces DESC LIMIT 50`).all();
    } catch (_) {
        rows = db.prepare(`
            SELECT valor AS busqueda, COUNT(*) AS veces, MAX(registrado_en) AS ultima_vez
            FROM log_eventos WHERE tipo_evento='busqueda' GROUP BY valor ORDER BY veces DESC LIMIT 50`).all();
    }
    return json(res, rows);
}

// GET /api/metricas/campanas — conversión por campaña (gerente)
function metricasCampanas(req, res, ctx) {
    const { db, json } = ctx;
    try {
        return json(res, db.prepare(`
            SELECT cn.campana, COUNT(DISTINCT cn.id) AS enviados,
                   COUNT(DISTINCT CASE WHEN p.id_pedido IS NOT NULL THEN cn.id END) AS convertidos
            FROM cola_notificaciones cn
            LEFT JOIN clientes c ON c.telefono = cn.destinatario
            LEFT JOIN pedidos p ON (p.id_cliente = c.id OR p.cliente = c.nombre)
               AND p.creado_en BETWEEN cn.creada_en AND datetime(cn.creada_en, '+7 days')
            WHERE cn.campana IS NOT NULL AND cn.estatus='enviado'
            GROUP BY cn.campana ORDER BY convertidos DESC`).all());
    } catch (_) { return json(res, []); }
}

// GET /api/metricas/canales — atribución por canal_origen (gerente)
function metricasCanales(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const desde = (new URL(req.url, 'http://x').searchParams.get('desde') || '2000-01-01').slice(0, 10);
        const rows = db.prepare(`
            SELECT COALESCE(NULLIF(c.canal_origen,''), 'directo') AS canal,
                   COUNT(DISTINCT c.id) AS clientes, COUNT(DISTINCT p.id_pedido) AS pedidos,
                   ROUND(COALESCE(SUM(lp.monto), 0), 2) AS ingresos
            FROM clientes c
            LEFT JOIN pedidos p ON p.id_cliente = c.id
            LEFT JOIN links_pago lp ON lp.id_pedido = p.id_pedido AND lp.estatus='pagado'
            WHERE date(c.creado_en) >= ? GROUP BY canal ORDER BY ingresos DESC, clientes DESC`).all(desde);
        return json(res, rows.map(r => ({ ...r, ticket_promedio: r.pedidos ? Math.round((r.ingresos / r.pedidos) * 100) / 100 : 0 })));
    } catch (_) { return json(res, []); }
}

// GET /api/metricas/operacion — embudos operativos (gerente)
function metricasOperacion(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const desde = (new URL(req.url, 'http://x').searchParams.get('desde') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).slice(0, 10);
        const ev = db.prepare(`
            SELECT tipo_evento, COUNT(*) n, COALESCE(SUM(CAST(valor AS REAL)), 0) monto
            FROM log_eventos WHERE date(registrado_en) >= ?
              AND tipo_evento IN ('cita_agendada','cita_cumplida','cita_no_asistio','mesa_abierta','mesa_cobrada','link_pago_enviado','pago_confirmado','recompra_convertida','venta_credito')
            GROUP BY tipo_evento`).all(desde);
        const g = {}; ev.forEach(r => { g[r.tipo_evento] = r; });
        const n = (k) => g[k]?.n || 0, m = (k) => Math.round((g[k]?.monto || 0) * 100) / 100;
        const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : null;
        const citasCerradas = n('cita_cumplida') + n('cita_no_asistio');
        return json(res, {
            desde,
            citas: { agendadas: n('cita_agendada'), cumplidas: n('cita_cumplida'), no_asistio: n('cita_no_asistio'), tasa_no_show_pct: pct(n('cita_no_asistio'), citasCerradas) },
            mesas: { abiertas: n('mesa_abierta'), cobradas: n('mesa_cobrada'), venta: m('mesa_cobrada'), ticket_promedio: n('mesa_cobrada') ? Math.round((m('mesa_cobrada') / n('mesa_cobrada')) * 100) / 100 : 0 },
            link_pago: { enviados: n('link_pago_enviado'), pagos_confirmados: n('pago_confirmado'), tasa_pago_pct: pct(n('pago_confirmado'), n('link_pago_enviado')) },
            recompra: { convertidas: n('recompra_convertida'), monto: m('recompra_convertida') },
            credito: { ventas: n('venta_credito'), monto: m('venta_credito') },
        });
    } catch (_) { return json(res, {}); }
}

// GET /api/metricas/salud-bot — eventos del bot (gerente)
function metricasSaludBot(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const desde = (new URL(req.url, 'http://x').searchParams.get('desde') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).slice(0, 10);
        const rows = db.prepare(`
            SELECT tipo_evento, COUNT(*) n, MAX(registrado_en) ultima
            FROM log_eventos WHERE date(registrado_en) >= ? AND tipo_evento IN ('busqueda','producto_visto','frustracion','imagen','fallback')
            GROUP BY tipo_evento`).all(desde);
        const g = {}; rows.forEach(r => { g[r.tipo_evento] = r; });
        const n = (k) => g[k]?.n || 0;
        const busq = n('busqueda');
        return json(res, {
            desde, busquedas: busq, productos_vistos: n('producto_visto'),
            frustraciones: n('frustracion'), imagenes: n('imagen'), fallbacks: n('fallback'),
            fallback_pct: busq ? Math.round((n('fallback') / busq) * 1000) / 10 : null,
            ultima_frustracion: g['frustracion']?.ultima || null,
        });
    } catch (_) { return json(res, {}); }
}

// GET /api/metricas/segmentacion — perfil de cliente (gerente)
function metricasSegmentacion(req, res, ctx) {
    const { db, json } = ctx;
    try {
        return json(res, db.prepare(`
            SELECT COALESCE(NULLIF(c.genero_pref,''),'—') genero, COALESCE(NULLIF(c.edad_pref,''),'—') edad,
                   COALESCE(NULLIF(c.presupuesto_pref,''),'—') presupuesto, COUNT(DISTINCT c.id) clientes,
                   ROUND(AVG(c.lead_score),1) lead_score, COUNT(DISTINCT p.id_pedido) pedidos,
                   ROUND(COALESCE(SUM(lp.monto),0),2) ingresos
            FROM clientes c
            LEFT JOIN pedidos p ON p.id_cliente = c.id
            LEFT JOIN links_pago lp ON lp.id_pedido = p.id_pedido AND lp.estatus='pagado'
            WHERE c.activo=1 GROUP BY genero, edad, presupuesto HAVING clientes > 0
            ORDER BY ingresos DESC, clientes DESC LIMIT 30`).all());
    } catch (_) { return json(res, []); }
}

// GET /api/metricas/abandono-motivos (gerente)
function metricasAbandonoMotivos(req, res, ctx) {
    const { db, json } = ctx;
    try {
        return json(res, db.prepare(`SELECT motivo, COUNT(*) AS n FROM carritos_abandonados WHERE motivo IS NOT NULL GROUP BY motivo ORDER BY n DESC`).all());
    } catch (_) { return json(res, []); }
}

// GET /api/metricas/embudos-abandono (gerente)
function metricasEmbudosAbandono(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const desde = (new URL(req.url, 'http://x').searchParams.get('desde') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).slice(0, 10);
        const terminos = db.prepare(`
            SELECT b.valor AS termino, COUNT(*) AS veces, MAX(ba.registrado_en) AS ultima
            FROM log_eventos ba JOIN log_eventos b ON b.id = CAST(ba.valor AS INTEGER)
            WHERE ba.tipo_evento = 'busqueda_abandonada' AND date(ba.registrado_en) >= ? AND b.valor IS NOT NULL AND b.valor != ''
            GROUP BY b.valor ORDER BY veces DESC, ultima DESC LIMIT 15`).all(desde);
        const sinResultado = db.prepare(`SELECT COUNT(*) c FROM log_eventos WHERE tipo_evento='busqueda_abandonada' AND date(registrado_en) >= ?`).get(desde)?.c || 0;
        const abandonados = db.prepare(`SELECT COUNT(*) c FROM carritos_abandonados WHERE date(COALESCE(convertido_en, abandonado_en)) >= ?`).get(desde)?.c || 0;
        const recuperados = db.prepare(`SELECT COUNT(*) c FROM carritos_abandonados WHERE convertido=1 AND date(COALESCE(convertido_en, abandonado_en)) >= ?`).get(desde)?.c || 0;
        const montoRec = db.prepare(`SELECT COALESCE(SUM(CAST(valor AS REAL)),0) m FROM log_eventos WHERE tipo_evento='carrito_convertido' AND date(registrado_en) >= ?`).get(desde)?.m || 0;
        return json(res, {
            desde,
            busquedas_sin_resultado: { total: sinResultado, terminos },
            carritos: { abandonados, recuperados, monto_recuperado: Math.round(montoRec * 100) / 100, tasa_recuperacion_pct: abandonados > 0 ? Math.round((recuperados / abandonados) * 1000) / 10 : null },
        });
    } catch (_) { return json(res, {}); }
}

// GET /api/gerente/reportes — stock bajo, margen, productos muertos (gerente, lectura)
function gerenteReportes(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const d90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
        const stock_bajo = db.prepare(`
            SELECT p.id, p.name, i.sucursal, i.stock, i.stock_minimo
            FROM inventarios i JOIN productos p ON p.id = i.id_producto
            WHERE i.stock_minimo > 0 AND i.stock <= i.stock_minimo
            ORDER BY (i.stock_minimo - i.stock) DESC, i.stock ASC LIMIT 100`).all();
        const margen = db.prepare(`
            SELECT p.id, p.name, p.price, p.costo,
                   (SELECT COALESCE(SUM(d.cantidad),0) FROM pedido_detalle d
                      JOIN links_pago lp ON lp.id_pedido=d.id_pedido AND lp.estatus='pagado'
                      WHERE d.id_producto=p.id AND date(lp.pagado_en) >= ?) AS vendidos_30d
            FROM productos p WHERE p.activo=1
            ORDER BY (p.costo IS NULL OR p.costo=0) DESC, vendidos_30d DESC, p.name LIMIT 100`).all(d30);
        const muertos = db.prepare(`
            SELECT p.id, p.name, p.price,
                   (SELECT COALESCE(SUM(i.stock),0) FROM inventarios i WHERE i.id_producto=p.id) AS stock
            FROM productos p WHERE p.activo=1
              AND (SELECT COALESCE(SUM(i.stock),0) FROM inventarios i WHERE i.id_producto=p.id) > 0
              AND NOT EXISTS (SELECT 1 FROM pedido_detalle d JOIN links_pago lp ON lp.id_pedido=d.id_pedido AND lp.estatus='pagado' WHERE d.id_producto=p.id AND date(lp.pagado_en) >= ?)
            ORDER BY stock DESC LIMIT 100`).all(d90);
        const margenCalc = margen.map(m => {
            const sinCosto = m.costo == null || m.costo === 0;
            return {
                ...m, sin_costo: sinCosto,
                margen: sinCosto || !(m.price > 0) ? null : Math.round((m.price - m.costo) * 100) / 100,
                margen_pct: sinCosto || !(m.price > 0) ? null : Math.round(((m.price - m.costo) / m.price) * 1000) / 10,
            };
        });
        return json(res, { desde_ventas: d30, desde_muertos: d90, stock_bajo, margen: margenCalc, muertos });
    } catch (_) { return json(res, { stock_bajo: [], margen: [], muertos: [] }); }
}

// GET /api/preventas
function preventasGet(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, db.prepare(`
        SELECT pv.*, pr.name AS nombre_producto, pr.price FROM preventas pv JOIN productos pr ON pr.id = pv.id_producto
        WHERE pv.activa=1 ORDER BY pv.id DESC`).all());
}

// POST /api/preventas — crear preventa (operacion)
function preventasPost(req, res, ctx) {
    const { db, json, readBody, validar, PreventaSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body), PreventaSchema, res, '/api/preventas');
            if (!datos) return;
            const { id_producto, nombre_preventa, fecha_llegada_est, stock_maximo, precio_preventa, porcentaje_anticipo } = datos;
            if (!id_producto || !nombre_preventa || !fecha_llegada_est) return json(res, { ok: false, error: 'Faltan campos obligatorios' }, 400);
            const r = db.prepare(`
                INSERT INTO preventas (id_producto, nombre_preventa, fecha_llegada_est, stock_maximo, precio_preventa, porcentaje_anticipo, activa)
                VALUES (?,?,?,?,?,?,1)`).run(id_producto, nombre_preventa, fecha_llegada_est, stock_maximo || 50, precio_preventa || 0, porcentaje_anticipo || 50);
            return json(res, { ok: true, id: r.lastInsertRowid });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/cola_atencion',                       handler: colaAtencionGet },
    { metodo: 'PUT',  path: /^\/api\/cola_atencion\/(\d+)$/,            area: 'operacion', handler: colaAtencionPut },
    { metodo: 'GET',  path: /^\/api\/clientes\/(\d+)\/mensajes$/,       area: 'operacion', handler: clienteMensajes },
    { metodo: 'PUT',  path: /^\/api\/clientes\/(\d+)\/reanudar-bot$/,   area: 'operacion', handler: reanudarBot },
    { metodo: 'POST', path: '/api/actualizar_guia',                     area: 'operacion', handler: actualizarGuia },
    { metodo: 'GET',  path: '/api/lista-espera',                        handler: listaEspera },
    { metodo: 'GET',  path: '/api/busquedas',                           roles: ['gerente'], handler: busquedas },
    { metodo: 'GET',  path: '/api/metricas/campanas',                   roles: ['gerente'], handler: metricasCampanas },
    { metodo: 'GET',  path: '/api/metricas/canales',                    roles: ['gerente'], handler: metricasCanales },
    { metodo: 'GET',  path: '/api/metricas/operacion',                  roles: ['gerente'], handler: metricasOperacion },
    { metodo: 'GET',  path: '/api/metricas/salud-bot',                  roles: ['gerente'], handler: metricasSaludBot },
    { metodo: 'GET',  path: '/api/metricas/segmentacion',               roles: ['gerente'], handler: metricasSegmentacion },
    { metodo: 'GET',  path: '/api/metricas/abandono-motivos',           roles: ['gerente'], handler: metricasAbandonoMotivos },
    { metodo: 'GET',  path: '/api/metricas/embudos-abandono',           roles: ['gerente'], handler: metricasEmbudosAbandono },
    { metodo: 'GET',  path: '/api/gerente/reportes',                    roles: ['gerente'], handler: gerenteReportes },
    { metodo: 'GET',  path: '/api/preventas',                           handler: preventasGet },
    { metodo: 'POST', path: '/api/preventas',                           area: 'operacion', handler: preventasPost },
];

module.exports = construirModulo(RUTAS);
