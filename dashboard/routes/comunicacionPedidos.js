'use strict';
// Notificaciones a clientes, POS asesor (buscar/venta previa), envío masivo,
// repartidor propio, cambio de estatus de pedido, pagos (enviar-link,
// marcar-pagado [CHOKEPOINT de puntos/lealtad], cancelar, regenerar), ticket,
// devoluciones e historial del pedido. Migrado al patrón declarativo del tronco.
//
// Gates: notificar/venta-previa/repartidores(GET)/pedidos(PUT)/pedidos/:id/
// repartidor → operacion; masivo(+preview)/repartidores(POST) → gerente;
// enviar-link/pagos/:id/regenerar → pos||operacion; marcar-pagado y
// pagos/:id/cancelar → pos||operacion||finanzas (cancelar es el espejo inverso
// de marcar-pagado: revierte cobro+inventario+puntos, misma exigencia).
// devoluciones PUT → operacion + PIN CONDICIONAL en el handler (aprobar/resolver).
const kardexService = require('../../services/kardexService');
const autorizacion = require('../autorizacion');
const { rangoDe } = require('../permisos');
const { flagActivo } = require('../../services/configFlags');
const construirModulo = require('./_construirModulo');

// POST /api/notificar — encolar mensaje a un cliente (operacion)
function notificar(req, res, ctx) {
    const { db, json, readBody, validar, mensajeService, NotificarSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body), NotificarSchema, res, '/api/notificar');
            if (!datos) return;
            const { telefono, mensaje, idPedido } = datos;
            let mensajeFinal = mensaje;
            if (mensaje.includes('{nombre}')) {
                const _cli = db.prepare('SELECT nombre FROM clientes WHERE telefono=? LIMIT 1').get(telefono);
                const _n = (_cli?.nombre || '').split(' ')[0];
                const _cap = _n ? _n.charAt(0).toUpperCase() + _n.slice(1).toLowerCase() : 'Cliente';
                mensajeFinal = mensaje.replace(/\{nombre\}/gi, _cap);
            }
            db.prepare(`INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, id_pedido, estatus)
                        VALUES ('whatsapp', ?, 'Notificación manual', ?, ?, 'pendiente')`).run(telefono, mensajeFinal, idPedido || null);
            mensajeService.registrarMensaje(db, telefono, 'asesor', mensajeFinal);
            return json(res, { ok: true, msg: 'Mensaje encolado para envío' });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/pos/buscar-producto?q= — buscador para armar carrito (asesor)
function posBuscarProducto(req, res, ctx, { u }) {
    const { json, searchProducts } = ctx;
    const q = (u.searchParams.get('q') || '').toString();
    if (!q.trim()) return json(res, { ok: false, error: 'Falta q' }, 400);
    const { results } = searchProducts(q, 10);
    return json(res, results);
}

// POST /api/pos/venta-previa — el asesor arma un carrito y se lo manda al cliente (operacion)
function ventaPrevia(req, res, ctx) {
    const { db, json, readBody, validar, agregarAlCarrito, mostrarCarrito, generarFolio, ventaPreviaService, VentaPreviaSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body), VentaPreviaSchema, res, '/api/pos/venta-previa');
            if (!datos) return;
            const { telefono, items } = datos;
            let carrito = [];
            for (const it of items) {
                const producto = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(it.id_producto);
                if (!producto) return json(res, { ok: false, error: `Producto ${it.id_producto} no existe o no está activo` }, 400);
                for (let i = 0; i < it.cantidad; i++) carrito = agregarAlCarrito(carrito, producto).carrito;
            }
            const folio = generarFolio('venta_previa');
            ventaPreviaService.crearVentaPrevia(db, telefono, carrito, folio);
            db.prepare(`INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
                        VALUES ('whatsapp', ?, 'Venta previa', ?, 'pendiente')`).run(telefono, `Tu asesor preparó este pedido para ti 👇\n\n${mostrarCarrito(carrito)}`);
            return json(res, { ok: true, folio, total: carrito.length });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/masivo/preview — audiencia de solo lectura (gerente+)
function masivoPreview(req, res, ctx, { u }) {
    const { json, construirAudienciaMasivo } = ctx;
    try {
        const soloConPedido = u.searchParams.get('soloConPedido') === '1' || u.searchParams.get('soloConPedido') === 'true';
        const sinActividad = u.searchParams.get('sinActividad') === '1' || u.searchParams.get('sinActividad') === 'true';
        const soloTags = (u.searchParams.get('soloTags') || '').split(',').filter(Boolean);
        const limite = parseInt(u.searchParams.get('limite')) || 50;
        const clientes = construirAudienciaMasivo({ soloConPedido, soloTags, sinActividad });
        return json(res, { ok: true, total: clientes.length, clientes: clientes.slice(0, limite) });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// POST /api/masivo — envío masivo escalonado (gerente+)
function masivo(req, res, ctx) {
    const { db, json, readBody, validar, construirAudienciaMasivo, MasivoSchema } = ctx;
    return readBody(req, body => {
        try {
            const _raw = JSON.parse(body);
            const datos = validar(_raw, MasivoSchema, res, '/api/masivo');
            if (!datos) return;
            const { mensaje, soloConPedido, limite, excluirTags, soloTags, sinActividad } = datos;
            const _campana = (String(_raw.codigo_campana || '').trim() || 'promocion_masiva').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
            let clientes = construirAudienciaMasivo({ soloConPedido, excluirTags, soloTags, sinActividad });
            if (limite && limite > 0) clientes = clientes.slice(0, limite);
            let encolados = 0;
            const { enviarEn } = datos;
            let _enviarDespues = null;
            if (enviarEn) {
                const _d = new Date(enviarEn);
                if (isNaN(_d.getTime())) return json(res, { ok: false, error: 'Fecha programada inválida' }, 400);
                if (_d < new Date()) return json(res, { ok: false, error: 'La hora programada ya pasó' }, 400);
                _enviarDespues = _d.toISOString().replace('T', ' ').slice(0, 19);
            }
            let stmt, _conCampana = true;
            try {
                stmt = db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,enviar_despues_de,campana) VALUES ('whatsapp',?,'Promocion masiva',?,?,?,?)");
            } catch (_) {
                _conCampana = false;
                stmt = db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,enviar_despues_de) VALUES ('whatsapp',?,'Promocion masiva',?,?,?)");
            }
            const _baseMs = _enviarDespues ? new Date(_enviarDespues.replace(' ', 'T')).getTime() : Date.now();
            let _accSeg = 0;
            const encolarTodos = db.transaction((lista) => {
                for (const cli of lista) {
                    if (!cli.telefono) continue;
                    const nombre = cli.nombre ? cli.nombre.split(' ')[0] : 'Cliente';
                    const nombreCap = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();
                    const msgP = mensaje.replace(/\{nombre\}/gi, nombreCap);
                    // ESCALONAMIENTO ANTI-BAN — INMUTABLE mientras se use whatsapp-web.js
                    // (número personal, no API oficial). Cada mensaje se separa 15-120s;
                    // NO reducir ni volver configurable: es lo que evita el baneo del
                    // número. Solo se relaja al migrar a la API oficial de Meta (WhatsApp
                    // Business Platform). El bot NUNCA lanza esto solo — lo dispara un
                    // humano (gerente+) desde /api/masivo; queda FUERA del motor de flujo.
                    _accSeg += 15 + Math.random() * 105;
                    const _cuando = new Date(_baseMs + _accSeg * 1000).toISOString().replace('T', ' ').slice(0, 19);
                    if (_conCampana) stmt.run(cli.telefono, msgP, 'programado', _cuando, _campana);
                    else stmt.run(cli.telefono, msgP, 'programado', _cuando);
                    encolados++;
                }
            });
            encolarTodos(clientes);
            const _info = _enviarDespues ? 'Programado para ' + _enviarDespues : 'Enviando ahora';
            return json(res, { ok: true, encolados, total_clientes: clientes.length, programado: !!_enviarDespues, enviar_en: _enviarDespues, info: _info });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Repartidor propio ────────────────────────────────────────────────────────
function repartidoresGet(req, res, ctx) {
    return ctx.json(res, ctx.db.prepare('SELECT id, nombre, telefono, activo FROM repartidores WHERE activo=1 ORDER BY nombre').all());
}
function repartidoresPost(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const nombre = String(d.nombre || '').trim();
            if (!nombre) return json(res, { ok: false, error: 'Falta el nombre' }, 400);
            const r = db.prepare('INSERT INTO repartidores (nombre, telefono) VALUES (?, ?)').run(nombre, String(d.telefono || '').trim() || null);
            return json(res, { ok: true, id: r.lastInsertRowid, nombre });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/pedidos/:id/repartidor — asignar / en camino / entregado
function pedidoRepartidor(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const accion = String(d.accion || '').trim();
            const ped = db.prepare('SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR (p.id_cliente IS NULL AND c.nombre=p.cliente) WHERE p.id_pedido=? LIMIT 1').get(id);
            if (!ped) return json(res, { ok: false, error: 'Pedido no encontrado' }, 404);
            const avisar = (cuerpo) => {
                if (!ped.telefono) return;
                db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Tu pedido',?,'pendiente')").run(ped.telefono, 'Hola ' + (ped.cliente || '') + ' 👋\n\n' + cuerpo);
            };
            if (accion === 'asignar') {
                const nombre = String(d.nombre || '').trim();
                if (!nombre) return json(res, { ok: false, error: 'Falta el nombre del repartidor' }, 400);
                db.prepare("UPDATE pedidos SET metodo_entrega='repartidor', repartidor_nombre=?, repartidor_telefono=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(nombre, String(d.telefono || '').trim() || null, id);
                return json(res, { ok: true, repartidor_nombre: nombre });
            }
            if (accion === 'en_camino') {
                const nombre = ped.repartidor_nombre || String(d.nombre || '').trim();
                db.prepare("UPDATE pedidos SET estatus='enviado', actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(id);
                avisar('🛵 Tu pedido *' + (ped.folio || '') + '* va en camino con nuestro repartidor' + (nombre ? ' *' + nombre + '*' : '') + '. ¡Pronto llega!');
                return json(res, { ok: true, estatus: 'enviado' });
            }
            if (accion === 'entregado') {
                db.prepare("UPDATE pedidos SET estatus='entregado', actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(id);
                avisar('✅ Tu pedido *' + (ped.folio || '') + '* fue entregado. ¡Gracias por tu compra! 🎉');
                return json(res, { ok: true, estatus: 'entregado' });
            }
            return json(res, { ok: false, error: 'Acción inválida' }, 400);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// PUT /api/pedidos/:id — cambiar estatus o datos fiscales (operacion)
function pedidosPut(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const datos = JSON.parse(body);
            if (datos.estatus === undefined && (datos.razon_social !== undefined || datos.rfc !== undefined)) {
                db.prepare("UPDATE pedidos SET razon_social=?, rfc=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(datos.razon_social || null, datos.rfc || null, id);
                return json(res, { ok: true, razon_social: datos.razon_social || null, rfc: datos.rfc || null });
            }
            const { estatus } = datos;
            if (!['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'].includes(estatus)) return json(res, { ok: false, error: 'Estatus inválido' }, 400);
            db.prepare("UPDATE pedidos SET estatus=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(estatus, id);
            const ped = db.prepare('SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR (p.id_cliente IS NULL AND c.nombre=p.cliente) WHERE p.id_pedido=? LIMIT 1').get(id);
            if (ped?.telefono) {
                const msgs = {
                    confirmado: 'Tu pedido ha sido *confirmado* ✅. Lo estamos preparando.',
                    preparando: 'Tu pedido está siendo *preparado* 📦. Pronto lo enviamos.',
                    enviado: 'Tu pedido ya fue *enviado* 🚚. Pronto recibirás tu guía de rastreo.',
                    entregado: 'Tu pedido fue *entregado* ✅. ¡Esperamos que lo disfrutes! 🧸',
                    cancelado: 'Tu pedido ha sido *cancelado*. Si tienes dudas escríbenos.',
                };
                if (msgs[estatus]) db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización pedido',?,'pendiente')").run(ped.telefono, 'Hola ' + (ped.cliente || '') + ' 👋\n\n' + msgs[estatus]);
            }
            return json(res, { ok: true, estatus });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/pagos/:id/enviar-link — genera y envía el link de pago (pos||operacion)
// Usa la pasarela real (Stripe/MP, async) si está configurada; si no, el modo
// demo (link simulado) o el link estático. NO marca pagado (eso es marcar-pagado).
async function pagoEnviarLink(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idP = parseInt(params[0]);
    const pagoLink = require('../../services/pagoLinkService');
    if (!pagoLink.pagoLinkActivo()) return json(res, { ok: false, error: 'Activa el módulo "Link de pago" en Módulos' }, 400);
    const ped = db.prepare('SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente WHERE p.id_pedido=?').get(idP);
    if (!ped) return json(res, { ok: false, error: 'Pedido no encontrado' }, 404);
    const tel = ped.telefono || ped.cliente_telefono;
    if (!tel) return json(res, { ok: false, error: 'El pedido no tiene teléfono de cliente' }, 400);
    try {
        const monto = ped.total || db.prepare("SELECT SUM(monto) m FROM links_pago WHERE id_pedido=?").get(idP)?.m || 0;
        const { url, referencia, demo } = await pagoLink.generarLinkAsync({ idPedido: idP, folio: ped.folio, monto });
        try { db.prepare("INSERT INTO links_pago (id_pedido, url_link, token_externo, monto, moneda, estatus) VALUES (?,?,?,?, 'MXN','generado')").run(idP, url, referencia, monto); } catch (_) {}
        const cuerpo = 'Para pagar tu pedido *' + (ped.folio || '#' + idP) + '* ($' + Number(monto).toFixed(2) + '):\n\n' + url + '\n\nReferencia: *' + referencia + '*';
        db.prepare("INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus) VALUES ('whatsapp', ?, 'Link de pago', ?, 'pendiente')").run(tel, cuerpo);
        try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('link_pago_enviado','whatsapp',?,?)").run(String(Number(monto).toFixed(2)), tel); } catch (_) {}
        return json(res, { ok: true, url, referencia, demo: !!demo });
    } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
}

// POST /api/pagos/:id/marcar-pagado — CHOKEPOINT: registra el cobro, descuenta
// inventario (kardex), asienta la venta/costo y dispara puntos+referidos.
// (pos||operacion||finanzas). Idempotente por links_pago.estatus.
function pagoMarcarPagado(req, res, ctx, { params, ses }) {
    const { db, json, readBody, validar, log, PagoConfirmadoSchema } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), PagoConfirmadoSchema, res, '/api/pagos/marcar-pagado');
            if (!datos) return;
            const { referencia_pago } = datos;
            const lp = db.prepare('SELECT * FROM links_pago WHERE id=?').get(id);
            if (!lp) return json(res, { ok: false, error: 'Link de pago no encontrado' }, 404);
            if (lp.estatus === 'pagado') return json(res, { ok: false, error: 'Este pago ya fue registrado', estatus: 'pagado' }, 409);
            const _esCred = db.prepare('SELECT a_credito FROM pedidos WHERE id_pedido=?').get(lp.id_pedido)?.a_credito == 1;
            // ATÓMICO (REVISION_ARQUITECTURA H1): marcar pagado + descontar
            // inventario + cobrado_por deben ir juntos. Sin la transacción, un
            // crash a media operación dejaba el pago registrado sin descontar
            // stock, y la idempotencia (409) impedía repararlo reintentando.
            // El kardex (venta) es interno; asientos/puntos/notifs quedan FUERA
            // (idempotentes, no deben abortar el cobro si fallan).
            const _invActivo = flagActivo(db, 'inventario_activo', true);
            db.transaction(() => {
                db.prepare("UPDATE links_pago SET estatus='pagado', pagado_en=datetime('now','localtime'), referencia_pago=? WHERE id=? AND estatus!='pagado'").run(referencia_pago, id);
                const items = _esCred ? [] : db.prepare(`
                    SELECT d.id_producto, d.cantidad, d.sucursal_origen, COALESCE(pr.tipo,'fisico') AS tipo
                    FROM pedido_detalle d LEFT JOIN productos pr ON pr.id = d.id_producto WHERE d.id_pedido=?`).all(lp.id_pedido);
                for (const it of items) {
                    if (it.tipo === 'servicio' || !it.sucursal_origen || !_invActivo) continue;
                    if (!require('../../services/recetasService').descontarVenta(db, { id_producto: it.id_producto, cantidad: it.cantidad, sucursal: it.sucursal_origen, motivo: 'Pago pedido ' + lp.id_pedido, usuario: ses.username }))
                        kardexService.movimiento({ id_producto: it.id_producto, sucursal: it.sucursal_origen, tipo: 'venta', delta: -it.cantidad, motivo: 'Pago pedido ' + lp.id_pedido, usuario: ses.username });
                }
                db.prepare('UPDATE pedidos SET cobrado_por=? WHERE id_pedido=?').run(ses.username, lp.id_pedido);
            })();
            const ped = db.prepare("SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR (p.id_cliente IS NULL AND c.nombre=p.cliente) WHERE p.id_pedido=? LIMIT 1").get(lp.id_pedido);
            try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('pago_confirmado','whatsapp',?,?)").run(String(lp.monto || ''), ped?.telefono || null); } catch (_) {}
            try { if (ped?.canal_creacion === 'asesor') db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('recompra_convertida','whatsapp',?,?)").run(String(lp.monto || ''), ped?.telefono || null); } catch (_) {}
            try {
                const _conta = require('../../services/contabilidadService');
                if (_esCred) {
                    _conta.asientoCobroCredito(lp.id_pedido, Number(lp.monto || 0), ped?.metodo_pago);
                    try { require('../../bot/handlers/puntosService').otorgarPuntosPorCompra(lp.id_pedido); } catch (_) {}
                } else {
                    _conta.asientoVenta(lp.id_pedido, Number(lp.monto || 0), ped?.metodo_pago);
                    _conta.asientoCostoVenta(lp.id_pedido);
                }
            } catch (e) { log.debug('Asientos de venta no registrados: ' + e.message); }
            if (ped && /pendiente/i.test(ped.estatus || '')) {
                db.prepare("UPDATE pedidos SET estatus='confirmado', actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(ped.id_pedido);
                if (ped.telefono) {
                    db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización pedido',?,'pendiente')").run(ped.telefono, 'Hola ' + (ped.cliente || '') + ' 👋\n\nRecibimos tu pago ✅. Tu pedido ha sido *confirmado* y lo estamos preparando.');
                }
                try { require('../../bot/handlers/puntosService').otorgarPuntosPorCompra(ped.id_pedido); }
                catch (e) { log.debug('No se pudo procesar otorgamiento de puntos por compra: ' + e.message); }
                // CRM (P0): pago confirmado = trato GANADO. Es el chokepoint de
                // dinero, el lugar correcto para 'ganado' (no al crear el pedido).
                try { if (ped.telefono) require('../../services/crmBot').avanzarEtapa(db, ped.telefono, 'ganado'); } catch (_) {}
                try {
                    const conv = db.prepare("UPDATE carritos_abandonados SET convertido=1 WHERE telefono=? AND convertido=0").run(ped.telefono || '');
                    if (conv.changes > 0) db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('carrito_convertido','whatsapp',?,?)").run(String(ped.total || ''), ped.telefono || null);
                } catch (_) {}
                try { require('../../bot/handlers/referidosService').otorgarPuntosPorPrimeraCompra(ped.id_cliente); }
                catch (e) { log.debug('No se pudo procesar otorgamiento de puntos por referido: ' + e.message); }
            }
            return json(res, { ok: true, id, estatus: 'pagado', referencia_pago });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/pagos/:id/cancelar — cancela el link; si estaba pagado, revierte el
// cobro completo (inventario + puntos). pos||operacion||finanzas (espejo inverso
// de marcar-pagado).
function pagoCancelar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
    const lp = db.prepare('SELECT * FROM links_pago WHERE id=?').get(id);
    if (!lp) return json(res, { ok: false, error: 'Link de pago no encontrado' }, 404);
    if (lp.estatus === 'pagado' && lp.id_pedido) {
        try {
            const r = require('../../services/reversionService').revertirCobro(lp.id_pedido, { cancelarPedido: false });
            if (!r.ok) return json(res, r, 400);
            return json(res, { ok: true, id, estatus: 'cancelado', cobro_revertido: true, puntos_revertidos: r.puntos_revertidos });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    }
    db.prepare("UPDATE links_pago SET estatus='cancelado' WHERE id=?").run(id);
    return json(res, { ok: true, id, estatus: 'cancelado' });
}

// POST /api/pagos/:id/regenerar — revivir un link vencido/cancelado (otras 48h)
function pagoRegenerar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
    const lp = db.prepare('SELECT id FROM links_pago WHERE id=?').get(id);
    if (!lp) return json(res, { ok: false, error: 'Link de pago no encontrado' }, 404);
    const expira = new Date(Date.now() + 48 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    db.prepare("UPDATE links_pago SET estatus='generado', fecha_expiracion=? WHERE id=?").run(expira, id);
    return json(res, { ok: true, id, estatus: 'generado', fecha_expiracion: expira });
}

// GET /api/pedidos/:id/ticket — comprobante (pedido + items + envío + pago)
function pedidoTicket(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idPedido = parseInt(params[0]);
    const ped = db.prepare("SELECT p.*, c.telefono, c.email FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR (p.id_cliente IS NULL AND c.nombre=p.cliente) WHERE p.id_pedido=? LIMIT 1").get(idPedido);
    if (!ped) return json(res, { ok: false, error: 'Pedido no encontrado' }, 404);
    const items = db.prepare("SELECT pd.id_producto, pd.cantidad, pd.precio_unitario, pd.subtotal_linea, pd.sucursal_origen, pr.name FROM pedido_detalle pd LEFT JOIN productos pr ON pr.id = pd.id_producto WHERE pd.id_pedido=?").all(idPedido);
    const envio = db.prepare("SELECT costo_envio, estatus FROM envios WHERE id_pedido=? LIMIT 1").get(idPedido);
    const pago = db.prepare("SELECT monto, estatus, referencia_pago, pagado_en FROM links_pago WHERE id_pedido=? LIMIT 1").get(idPedido);
    return json(res, { pedido: ped, items, envio: envio || null, pago: pago || null });
}

// GET /api/devoluciones
function devolucionesGet(req, res, ctx) {
    const { db, json } = ctx;
    const estatusF = (new URL('http://x' + req.url).searchParams.get('estatus') || '').trim();
    let sql = `
        SELECT d.*, p.folio, p.cliente, c.telefono,
               (SELECT username FROM usuarios u WHERE u.id = d.id_usuario_autoriza) autorizada_por
        FROM devoluciones d
        LEFT JOIN pedidos p ON p.id_pedido = d.id_pedido
        LEFT JOIN clientes c ON c.id = p.id_cliente OR c.nombre = p.cliente`;
    const params = [];
    if (estatusF) { sql += ' WHERE d.estatus = ?'; params.push(estatusF); }
    sql += ' ORDER BY d.creada_en DESC LIMIT 200';
    return json(res, db.prepare(sql).all(...params));
}

// PUT /api/devoluciones/:id — aprobar/rechazar/resolver (PIN condicional al
// aprobar/resolver; repone inventario + asiento). Pide sesión en el handler.
function devolucionesPut(req, res, ctx, { params, ses: _sesDev }) {
    const { db, json, readBody, log } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const { estatus, notas, pin } = JSON.parse(body);
            if (!['solicitada', 'aprobada', 'rechazada', 'resuelta'].includes(estatus)) return json(res, { ok: false, error: 'Estatus inválido' }, 400);
            if (estatus !== 'solicitada') {
                const errPin = autorizacion.exigirAutorizacion(db, _sesDev, pin, rangoDe);
                if (errPin) return json(res, { ok: false, error: errPin, pin_requerido: true }, 403);
            }
            const terminal = estatus !== 'solicitada';
            db.prepare("UPDATE devoluciones SET estatus=?, notas=COALESCE(?,notas)" +
                (terminal ? ", resuelta_en=datetime('now','localtime'), id_usuario_autoriza=(SELECT id FROM usuarios WHERE username=? LIMIT 1)" : "") + " WHERE id=?")
                .run(...(terminal ? [estatus, notas || null, _sesDev.username, id] : [estatus, notas || null, id]));
            const dev = db.prepare(`
                SELECT d.*, p.folio, p.cliente, c.telefono FROM devoluciones d
                LEFT JOIN pedidos p ON p.id_pedido = d.id_pedido
                LEFT JOIN clientes c ON c.id = p.id_cliente OR c.nombre = p.cliente WHERE d.id = ? LIMIT 1`).get(id);
            if (estatus === 'resuelta' && dev?.id_producto && dev?.cantidad) {
                const det = db.prepare('SELECT sucursal_origen FROM pedido_detalle WHERE id_pedido=? AND id_producto=? LIMIT 1').get(dev.id_pedido, dev.id_producto);
                if (det) {
                    const vendida = db.prepare('SELECT COALESCE(SUM(cantidad),0) c FROM pedido_detalle WHERE id_pedido=? AND id_producto=?').get(dev.id_pedido, dev.id_producto).c;
                    const yaDevuelta = db.prepare("SELECT COALESCE(SUM(cantidad),0) c FROM devoluciones WHERE id_pedido=? AND id_producto=? AND estatus='resuelta' AND id!=?").get(dev.id_pedido, dev.id_producto, id).c;
                    const cantReponer = Math.min(dev.cantidad, Math.max(0, vendida - yaDevuelta));
                    if (cantReponer < dev.cantidad) log.warn('Devolución ' + id + ': cantidad ' + dev.cantidad + ' excede lo devolvible (' + Math.max(0, vendida - yaDevuelta) + '); se repone ' + cantReponer);
                    if (cantReponer > 0) {
                        kardexService.movimiento({ id_producto: dev.id_producto, sucursal: det.sucursal_origen, tipo: 'devolucion', delta: cantReponer, motivo: 'Devolución pedido ' + (dev.folio || dev.id_pedido), usuario: _sesDev.username });
                        try { require('../../services/contabilidadService').asientoDevolucion(dev.id_pedido, dev.id_producto, cantReponer); }
                        catch (e) { log.debug('Asiento de devolución no registrado: ' + e.message); }
                    }
                }
            }
            if (dev?.telefono) {
                const msgs = {
                    aprobada: '✅ Tu devolución (pedido *' + (dev.folio || '') + '*) fue *aprobada*. Pronto te contactamos para el reembolso o cambio.',
                    rechazada: '❌ Revisamos tu devolución (pedido *' + (dev.folio || '') + '*) y no pudo ser aprobada' + (notas ? ': ' + notas + '.' : '.') + ' Si tienes dudas, escríbenos.',
                    resuelta: '✅ Tu devolución (pedido *' + (dev.folio || '') + '*) quedó *resuelta*. ¡Gracias por tu paciencia!',
                };
                if (msgs[estatus]) db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización devolución',?,'pendiente')").run(dev.telefono, msgs[estatus]);
            }
            return json(res, { ok: true, estatus });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/pedidos/:id/historial — bitácora operativa del pedido
function pedidoHistorial(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idH = parseInt(params[0]);
    const ped = db.prepare('SELECT * FROM pedidos WHERE id_pedido=?').get(idH);
    if (!ped) return json(res, { ok: false, error: 'Pedido no encontrado' }, 404);
    const folio = ped.folio || ('#' + idH);
    const eventos = [];
    eventos.push({ ts: ped.creado_en, tipo: 'creado', txt: 'Pedido creado (' + (ped.canal_creacion || 'bot') + ')' + (ped.cliente ? ' — ' + ped.cliente : '') });
    for (const pg of db.prepare('SELECT * FROM links_pago WHERE id_pedido=?').all(idH)) {
        eventos.push({ ts: pg.creado_en, tipo: 'pago', txt: 'Link de pago $' + pg.monto + ' (' + pg.estatus + ')' });
        if (pg.pagado_en) eventos.push({ ts: pg.pagado_en, tipo: 'pago', txt: 'PAGADO $' + pg.monto + (ped.cobrado_por ? ' — cobró ' + ped.cobrado_por : '') + (ped.metodo_pago ? ' · ' + ped.metodo_pago : '') });
    }
    for (const m of db.prepare('SELECT * FROM inventario_movimientos WHERE motivo LIKE ? OR motivo LIKE ? ORDER BY id').all('%' + folio + '%', '%pedido ' + idH + '%')) {
        eventos.push({ ts: m.creado_en, tipo: 'kardex', txt: m.tipo + ' en ' + m.sucursal + ': ' + m.cantidad_anterior + '->' + m.cantidad_nueva + (m.creado_por ? ' · ' + m.creado_por : '') });
    }
    if (ped.repartidor_nombre) eventos.push({ ts: ped.creado_en, tipo: 'repartidor', txt: 'Repartidor asignado: ' + ped.repartidor_nombre });
    for (const dv of db.prepare('SELECT * FROM devoluciones WHERE id_pedido=?').all(idH)) {
        eventos.push({ ts: dv.creado_en || ped.creado_en, tipo: 'devolucion', txt: 'Devolución ' + dv.cantidad + 'x producto ' + dv.id_producto + ' (' + dv.estatus + ')' });
    }
    if (ped.cancelado_en) eventos.push({ ts: ped.cancelado_en, tipo: 'cancelado', txt: 'CANCELADO por ' + (ped.cancelado_por || '?') });
    eventos.sort((x, y) => String(x.ts).localeCompare(String(y.ts)));
    return json(res, { ok: true, folio, estatus: ped.estatus, eventos });
}

const RUTAS = [
    { metodo: 'POST', path: '/api/notificar',                              area: 'operacion', handler: notificar },
    { metodo: 'GET',  path: '/api/pos/buscar-producto',                    handler: posBuscarProducto },
    { metodo: 'POST', path: '/api/pos/venta-previa',                       area: 'operacion', handler: ventaPrevia },
    { metodo: 'GET',  path: '/api/masivo/preview',                         roles: ['gerente'], handler: masivoPreview },
    { metodo: 'POST', path: '/api/masivo',                                 roles: ['gerente'], handler: masivo },
    { metodo: 'GET',  path: '/api/repartidores',                           area: 'operacion', handler: repartidoresGet },
    { metodo: 'POST', path: '/api/repartidores',                           roles: ['gerente'], handler: repartidoresPost },
    { metodo: 'POST', path: /^\/api\/pedidos\/(\d+)\/repartidor$/,         area: 'operacion', handler: pedidoRepartidor },
    { metodo: 'PUT',  path: /^\/api\/pedidos\/(\d+)$/,                     area: 'operacion', handler: pedidosPut },
    { metodo: 'POST', path: /^\/api\/pagos\/(\d+)\/enviar-link$/,          areas: ['pos', 'operacion'], handler: pagoEnviarLink },
    { metodo: 'POST', path: /^\/api\/pagos\/(\d+)\/marcar-pagado$/,        areas: ['pos', 'operacion', 'finanzas'], handler: pagoMarcarPagado },
    { metodo: 'POST', path: /^\/api\/pagos\/(\d+)\/cancelar$/,             areas: ['pos', 'operacion', 'finanzas'], handler: pagoCancelar },
    { metodo: 'POST', path: /^\/api\/pagos\/(\d+)\/regenerar$/,            areas: ['pos', 'operacion'], handler: pagoRegenerar },
    { metodo: 'GET',  path: /^\/api\/pedidos\/(\d+)\/ticket$/,             handler: pedidoTicket },
    { metodo: 'GET',  path: '/api/devoluciones',                           handler: devolucionesGet },
    { metodo: 'PUT',  path: /^\/api\/devoluciones\/(\d+)$/,                area: 'operacion', handler: devolucionesPut },
    { metodo: 'GET',  path: /^\/api\/pedidos\/(\d+)\/historial$/,          handler: pedidoHistorial },
];

module.exports = construirModulo(RUTAS);
