'use strict';
const kardexService = require('../../services/kardexService');
const autorizacion = require('../autorizacion');
const { rangoDe } = require('../permisos');
// Extraído mecánicamente de dashboard/server.js (líneas 574-891 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function comunicacionPedidosRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/notificar' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), NotificarSchema, res, p);
                if (!datos) return;
                const { telefono, mensaje, idPedido } = datos;

                // Capitalizar nombre del cliente si usa {nombre}
                let mensajeFinal = mensaje;
                if (mensaje.includes('{nombre}')) {
                    const _cli = db.prepare('SELECT nombre FROM clientes WHERE telefono=? LIMIT 1').get(telefono);
                    const _n = (_cli?.nombre||'').split(' ')[0];
                    const _cap = _n ? _n.charAt(0).toUpperCase() + _n.slice(1).toLowerCase() : 'Cliente';
                    mensajeFinal = mensaje.replace(/\{nombre\}/gi, _cap);
                }

                // Registrar en cola_notificaciones para que el bot lo envíe
                db.prepare(`
                    INSERT INTO cola_notificaciones
                        (tipo, destinatario, asunto, cuerpo, id_pedido, estatus)
                    VALUES ('whatsapp', ?, 'Notificación manual', ?, ?, 'pendiente')
                `).run(telefono, mensajeFinal, idPedido || null);

                mensajeService.registrarMensaje(db, telefono, 'asesor', mensajeFinal);

                return json(res, { ok:true, msg:'Mensaje encolado para envío' });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/pos/buscar-producto?q=... — para que el asesor arme un carrito (POS)
    // reusando el mismo buscador/scoring que ya usa el bot, en vez de duplicarlo.
    if (p === '/api/pos/buscar-producto' && req.method === 'GET') {
        const q = (u.searchParams.get('q') || '').toString();
        if (!q.trim()) return json(res, { ok:false, error:'Falta q' }, 400);
        const { results } = searchProducts(q, 10);
        return json(res, results);
    }

    // POST /api/pos/venta-previa — el asesor cierra una "venta previa": arma el
    // carrito, se guarda y se le manda al cliente por WhatsApp para que la
    // confirme. Al responder, el bot lo mete directo a SHOW_CART y sigue el
    // flujo normal de carrito/envío/pago — no se reimplementa esa lógica aquí.
    if (p === '/api/pos/venta-previa' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), VentaPreviaSchema, res, p);
                if (!datos) return;
                const { telefono, items } = datos;

                let carrito = [];
                for (const it of items) {
                    const producto = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(it.id_producto);
                    if (!producto) return json(res, { ok:false, error:`Producto ${it.id_producto} no existe o no está activo` }, 400);
                    for (let i = 0; i < it.cantidad; i++) {
                        carrito = agregarAlCarrito(carrito, producto).carrito;
                    }
                }

                const folio = generarFolio('venta_previa');
                ventaPreviaService.crearVentaPrevia(db, telefono, carrito, folio);

                db.prepare(`
                    INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
                    VALUES ('whatsapp', ?, 'Venta previa', ?, 'pendiente')
                `).run(telefono, `Tu asesor preparó este pedido para ti 👇\n\n${mostrarCarrito(carrito)}`);

                return json(res, { ok:true, folio, total: carrito.length });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/masivo/preview — misma audiencia que calculará el envío real,
    // de solo lectura, para que el admin vea antes de disparar.
    if (p === '/api/masivo/preview' && req.method === 'GET') {
        try {
            const soloConPedido = u.searchParams.get('soloConPedido') === '1' || u.searchParams.get('soloConPedido') === 'true';
            const sinActividad  = u.searchParams.get('sinActividad') === '1' || u.searchParams.get('sinActividad') === 'true';
            const soloTags      = (u.searchParams.get('soloTags') || '').split(',').filter(Boolean);
            const limite        = parseInt(u.searchParams.get('limite')) || 50;
            const clientes = construirAudienciaMasivo({ soloConPedido, soloTags, sinActividad });
            return json(res, { ok:true, total: clientes.length, clientes: clientes.slice(0, limite) });
        } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
    }

    // POST /api/masivo — envío masivo de WhatsApp a clientes registrados
    if (p === '/api/masivo' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), MasivoSchema, res, p);
                if (!datos) return;
                const { mensaje, soloConPedido, limite, excluirTags, soloTags, sinActividad } = datos;

                let clientes = construirAudienciaMasivo({ soloConPedido, excluirTags, soloTags, sinActividad });
                if (limite && limite > 0) clientes = clientes.slice(0, limite);

                // El destinatario es el campo telefono que contiene el userId de WhatsApp (@lid o @c.us)
                let encolados = 0;
                const { enviarEn } = datos;
                // Validar y normalizar la fecha programada
                let _enviarDespues = null;
                if (enviarEn) {
                    const _d = new Date(enviarEn);
                    if (isNaN(_d.getTime())) return json(res, { ok:false, error:'Fecha programada inválida' }, 400);
                    if (_d < new Date()) return json(res, { ok:false, error:'La hora programada ya pasó' }, 400);
                    // Formato SQLite: YYYY-MM-DD HH:MM:SS
                    _enviarDespues = _d.toISOString().replace('T',' ').slice(0,19);
                }

                const _estatus = _enviarDespues ? 'programado' : 'pendiente';
                // campana: tag fijo para poder medir conversión de envíos masivos en
                // /api/metricas/campanas — si la columna todavía no existe en
                // producción, cae al INSERT sin ella y el envío sigue funcionando igual.
                let stmt;
                try {
                    stmt = db.prepare(
                        "INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,enviar_despues_de,campana) VALUES ('whatsapp',?,'Promocion masiva',?,?,?,'promocion_masiva')"
                    );
                } catch (_) {
                    stmt = db.prepare(
                        "INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,enviar_despues_de) VALUES ('whatsapp',?,'Promocion masiva',?,?,?)"
                    );
                }
                const encolarTodos = db.transaction((lista) => {
                    for (const cli of lista) {
                        if (!cli.telefono) continue;
                        const nombre = cli.nombre ? cli.nombre.split(' ')[0] : 'Cliente';
                        const nombreCap = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();
                        const msgP = mensaje.replace(/\{nombre\}/gi, nombreCap);
                        stmt.run(cli.telefono, msgP, _estatus, _enviarDespues);
                        encolados++;
                    }
                });
                encolarTodos(clientes);

                const _info = _enviarDespues
                    ? 'Programado para ' + _enviarDespues
                    : 'Enviando ahora';
                return json(res, { ok:true, encolados, total_clientes: clientes.length, programado: !!_enviarDespues, enviar_en: _enviarDespues, info: _info });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // ── Repartidor propio (Bloque 2) ──────────────────────────────────────
    // El repartidor NO es un usuario ni tiene WhatsApp: es un dato del pedido.
    // El aviso al cliente lo manda el ÚNICO WhatsApp del negocio (el bot, vía
    // cola_notificaciones) cuando el operador cambia el estado aquí.
    if (p === '/api/repartidores' && req.method === 'GET') {
        return json(res, db.prepare('SELECT id, nombre, telefono, activo FROM repartidores WHERE activo=1 ORDER BY nombre').all());
    }
    if (p === '/api/repartidores' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const nombre = String(d.nombre || '').trim();
                if (!nombre) return json(res, { ok:false, error:'Falta el nombre' }, 400);
                const r = db.prepare('INSERT INTO repartidores (nombre, telefono) VALUES (?, ?)').run(nombre, String(d.telefono||'').trim() || null);
                return json(res, { ok:true, id: r.lastInsertRowid, nombre });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/pedidos/:id/repartidor — asignar / marcar en camino / entregado
    // Body: { accion: 'asignar'|'en_camino'|'entregado', nombre?, telefono? }
    if (req.method === 'POST' && /^\/api\/pedidos\/\d+\/repartidor$/.test(p)) {
        const id = parseInt(p.split('/')[3]);
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const accion = String(d.accion || '').trim();
                const ped = db.prepare('SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR (p.id_cliente IS NULL AND c.nombre=p.cliente) WHERE p.id_pedido=? LIMIT 1').get(id);
                if (!ped) return json(res, { ok:false, error:'Pedido no encontrado' }, 404);

                const avisar = (cuerpo) => {
                    if (!ped.telefono) return;
                    db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Tu pedido',?,'pendiente')")
                      .run(ped.telefono, 'Hola ' + (ped.cliente||'') + ' 👋\n\n' + cuerpo);
                };

                if (accion === 'asignar') {
                    const nombre = String(d.nombre || '').trim();
                    if (!nombre) return json(res, { ok:false, error:'Falta el nombre del repartidor' }, 400);
                    db.prepare("UPDATE pedidos SET metodo_entrega='repartidor', repartidor_nombre=?, repartidor_telefono=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?")
                      .run(nombre, String(d.telefono||'').trim() || null, id);
                    return json(res, { ok:true, repartidor_nombre: nombre });
                }
                if (accion === 'en_camino') {
                    const nombre = ped.repartidor_nombre || String(d.nombre || '').trim();
                    db.prepare("UPDATE pedidos SET estatus='enviado', actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(id);
                    avisar('🛵 Tu pedido *' + (ped.folio||'') + '* va en camino con nuestro repartidor' + (nombre ? ' *' + nombre + '*' : '') + '. ¡Pronto llega!');
                    return json(res, { ok:true, estatus:'enviado' });
                }
                if (accion === 'entregado') {
                    db.prepare("UPDATE pedidos SET estatus='entregado', actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(id);
                    avisar('✅ Tu pedido *' + (ped.folio||'') + '* fue entregado. ¡Gracias por tu compra! 🎉');
                    return json(res, { ok:true, estatus:'entregado' });
                }
                return json(res, { ok:false, error:'Acción inválida' }, 400);
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // PUT /api/pedidos/:id — cambiar estatus de un pedido, o (Fase 3,
    // facturación) actualizar razon_social/rfc sin tocar el estatus -- el
    // modal "Ver ticket" de Pedidos.jsx manda solo esos dos campos.
    if (req.method === 'PUT' && p.startsWith('/api/pedidos/')) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = JSON.parse(body);
                if (datos.estatus === undefined && (datos.razon_social !== undefined || datos.rfc !== undefined)) {
                    db.prepare("UPDATE pedidos SET razon_social=?, rfc=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?")
                        .run(datos.razon_social || null, datos.rfc || null, id);
                    return json(res, { ok:true, razon_social: datos.razon_social || null, rfc: datos.rfc || null });
                }
                const { estatus } = datos;
                const validos = ['pendiente','confirmado','preparando','enviado','entregado','cancelado'];
                if (!validos.includes(estatus)) return json(res, { ok:false, error:'Estatus inválido' }, 400);
                db.prepare("UPDATE pedidos SET estatus=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(estatus, id);
                // Notificar al cliente si tiene teléfono
                // id_cliente no estaba poblado en pedidos viejos — c.nombre=p.cliente es el join que sí funciona siempre.
                const ped = db.prepare('SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR (p.id_cliente IS NULL AND c.nombre=p.cliente) WHERE p.id_pedido=? LIMIT 1').get(id);
                if (ped?.telefono) {
                    const msgs = {
                        confirmado:  'Tu pedido ha sido *confirmado* ✅. Lo estamos preparando.',
                        preparando:  'Tu pedido está siendo *preparado* 📦. Pronto lo enviamos.',
                        enviado:     'Tu pedido ya fue *enviado* 🚚. Pronto recibirás tu guía de rastreo.',
                        entregado:   'Tu pedido fue *entregado* ✅. ¡Esperamos que lo disfrutes! 🧸',
                        cancelado:   'Tu pedido ha sido *cancelado*. Si tienes dudas escríbenos.',
                    };
                    if (msgs[estatus]) {
                        db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización pedido',?,'pendiente')")
                          .run(ped.telefono, 'Hola ' + (ped.cliente||'') + ' 👋\n\n' + msgs[estatus]);
                    }
                }
                return json(res, { ok:true, estatus });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/pagos/:id/marcar-pagado — cobro recibido fuera de PayPal
    // (efectivo, transferencia, etc). Antes de esto no había NINGÚN código
    // que moviera un links_pago de 'generado' a 'pagado'.
    if (req.method === 'POST' && p.match(/^\/api\/pagos\/\d+\/marcar-pagado$/)) {
        const id = parseInt(p.split('/')[3]);
        const _sesPago = requireSession(req, res);
        if (!_sesPago) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), PagoConfirmadoSchema, res, p);
                if (!datos) return;
                const { referencia_pago } = datos;

                const lp = db.prepare('SELECT * FROM links_pago WHERE id=?').get(id);
                if (!lp) return json(res, { ok:false, error:'Link de pago no encontrado' }, 404);
                db.prepare("UPDATE links_pago SET estatus='pagado', pagado_en=datetime('now','localtime'), referencia_pago=? WHERE id=?").run(referencia_pago, id);

                // Pago confirmado: descontar inventario con KARDEX (los
                // productos tipo 'servicio' no llevan stock)
                const items = db.prepare(`
                    SELECT d.id_producto, d.cantidad, d.sucursal_origen, COALESCE(pr.tipo,'fisico') AS tipo
                    FROM pedido_detalle d LEFT JOIN productos pr ON pr.id = d.id_producto
                    WHERE d.id_pedido=?`).all(lp.id_pedido);
                for (const it of items) {
                    if (it.tipo === 'servicio' || !it.sucursal_origen) continue;
                    kardexService.movimiento({ id_producto: it.id_producto, sucursal: it.sucursal_origen, tipo: 'venta', delta: -it.cantidad, motivo: 'Pago pedido ' + lp.id_pedido, usuario: _sesPago.username });
                }
                db.prepare('UPDATE pedidos SET cobrado_por=? WHERE id_pedido=?').run(_sesPago.username, lp.id_pedido);

                // Si el pedido seguía 'Pendiente', avanzarlo a 'confirmado' — ya hay dinero.
                const ped = db.prepare("SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR (p.id_cliente IS NULL AND c.nombre=p.cliente) WHERE p.id_pedido=? LIMIT 1").get(lp.id_pedido);
                // Evento de funnel: cierre real de la venta
                try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('pago_confirmado','whatsapp',?,?)").run(String(lp.monto || ''), ped?.telefono || null); } catch (_) {}
                // Asientos contables automáticos (módulo contabilidad_activo)
                try {
                    const _conta = require('../../services/contabilidadService');
                    _conta.asientoVenta(lp.id_pedido, Number(lp.monto || 0), ped?.metodo_pago);
                    _conta.asientoCostoVenta(lp.id_pedido);
                } catch (e) { log.debug('Asientos de venta no registrados: ' + e.message); }
                if (ped && /pendiente/i.test(ped.estatus || '')) {
                    db.prepare("UPDATE pedidos SET estatus='confirmado', actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(ped.id_pedido);
                    if (ped.telefono) {
                        db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización pedido',?,'pendiente')")
                          .run(ped.telefono, 'Hola ' + (ped.cliente||'') + ' 👋\n\nRecibimos tu pago ✅. Tu pedido ha sido *confirmado* y lo estamos preparando.');
                    }
                    // Único disparador de puntos por compra — ya no depende de escanear
                    // ningún ticket físico, aplica a cualquier pedido pagado/confirmado.
                    try { require('../bot/handlers/puntosService').otorgarPuntosPorCompra(ped.id_pedido); }
                    catch (e) { log.debug('No se pudo procesar otorgamiento de puntos por compra: ' + e.message); }
                    // Único disparador del programa de referidos: primera compra finalizada.
                    try { require('../bot/handlers/referidosService').otorgarPuntosPorPrimeraCompra(ped.id_cliente); }
                    catch (e) { log.debug('No se pudo procesar otorgamiento de puntos por referido: ' + e.message); }
                }
                return json(res, { ok:true, id, estatus:'pagado', referencia_pago });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/pagos/:id/cancelar — cancelar un link de pago. Si YA estaba
    // pagado, deshace el cobro completo (repone inventario, resta puntos) y
    // el pedido regresa a Pendiente.
    if (req.method === 'POST' && p.match(/^\/api\/pagos\/\d+\/cancelar$/)) {
        const id = parseInt(p.split('/')[3]);
        const lp = db.prepare('SELECT * FROM links_pago WHERE id=?').get(id);
        if (!lp) return json(res, { ok:false, error:'Link de pago no encontrado' }, 404);
        if (lp.estatus === 'pagado' && lp.id_pedido) {
            try {
                const r = require('../../services/reversionService').revertirCobro(lp.id_pedido, { cancelarPedido: false });
                if (!r.ok) return json(res, r, 400);
                return json(res, { ok:true, id, estatus:'cancelado', cobro_revertido:true, puntos_revertidos:r.puntos_revertidos });
            } catch (e) { return json(res, { ok:false, error:e.message }, 400); }
        }
        db.prepare("UPDATE links_pago SET estatus='cancelado' WHERE id=?").run(id);
        return json(res, { ok:true, id, estatus:'cancelado' });
    }

    // POST /api/pagos/:id/regenerar — revivir un link vencido/cancelado dándole
    // otras 48h (mismo plazo que insertarLinkPago usa al crearlo).
    if (req.method === 'POST' && p.match(/^\/api\/pagos\/\d+\/regenerar$/)) {
        const id = parseInt(p.split('/')[3]);
        const lp = db.prepare('SELECT id FROM links_pago WHERE id=?').get(id);
        if (!lp) return json(res, { ok:false, error:'Link de pago no encontrado' }, 404);
        const expira = new Date(Date.now() + 48*3600*1000).toISOString().replace('T',' ').substring(0,19);
        db.prepare("UPDATE links_pago SET estatus='generado', fecha_expiracion=? WHERE id=?").run(expira, id);
        return json(res, { ok:true, id, estatus:'generado', fecha_expiracion:expira });
    }

    // GET /api/pedidos/:id/ticket — comprobante de compra: pedido + productos
    // + envío + pago, todo junto (no es una tabla nueva, solo un join de lectura).
    if (req.method === 'GET' && p.match(/^\/api\/pedidos\/\d+\/ticket$/)) {
        const idPedido = parseInt(p.split('/')[3]);
        const ped = db.prepare(
            "SELECT p.*, c.telefono, c.email FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR (p.id_cliente IS NULL AND c.nombre=p.cliente) WHERE p.id_pedido=? LIMIT 1"
        ).get(idPedido);
        if (!ped) return json(res, { ok:false, error:'Pedido no encontrado' }, 404);
        const items = db.prepare(
            "SELECT pd.id_producto, pd.cantidad, pd.precio_unitario, pd.subtotal_linea, pd.sucursal_origen, pr.name FROM pedido_detalle pd LEFT JOIN productos pr ON pr.id = pd.id_producto WHERE pd.id_pedido=?"
        ).all(idPedido);
        const envio = db.prepare("SELECT costo_envio, estatus FROM envios WHERE id_pedido=? LIMIT 1").get(idPedido);
        const pago  = db.prepare("SELECT monto, estatus, referencia_pago, pagado_en FROM links_pago WHERE id_pedido=? LIMIT 1").get(idPedido);
        return json(res, { pedido: ped, items, envio: envio || null, pago: pago || null });
    }

    // GET /api/devoluciones — antes esta tabla no se veía desde ningún lado
    // del dashboard; el asesor solo se entera por el WhatsApp de la cola.
    if (p === '/api/devoluciones' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const estatusF = (_u.searchParams.get('estatus') || '').trim();
        let sql = `
            SELECT d.*, p.folio, p.cliente, c.telefono
            FROM devoluciones d
            LEFT JOIN pedidos p  ON p.id_pedido = d.id_pedido
            LEFT JOIN clientes c ON c.id = p.id_cliente OR c.nombre = p.cliente
        `;
        const params = [];
        if (estatusF) { sql += ' WHERE d.estatus = ?'; params.push(estatusF); }
        sql += ' ORDER BY d.creada_en DESC LIMIT 200';
        return json(res, db.prepare(sql).all(...params));
    }

    // PUT /api/devoluciones/:id — aprobar/rechazar/resolver y avisar al cliente
    if (req.method === 'PUT' && p.match(/^\/api\/devoluciones\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        const _sesDev = requireSession(req, res);
        if (!_sesDev) return;
        return readBody(req, body => {
            try {
                const { estatus, notas, pin } = JSON.parse(body);
                const validos = ['solicitada','aprobada','rechazada','resuelta'];
                if (!validos.includes(estatus)) return json(res, { ok:false, error:'Estatus inválido' }, 400);
                // Resolver/aprobar una devolución mueve dinero e inventario:
                // administrador+ directo, roles POS con PIN de autorización
                if (estatus !== 'solicitada') {
                    const errPin = autorizacion.exigirAutorizacion(db, _sesDev, pin, rangoDe);
                    if (errPin) return json(res, { ok:false, error: errPin, pin_requerido: true }, 403);
                }
                const terminal = estatus !== 'solicitada';
                db.prepare(
                    "UPDATE devoluciones SET estatus=?, notas=COALESCE(?,notas)" +
                    (terminal ? ", resuelta_en=datetime('now','localtime')" : "") +
                    " WHERE id=?"
                ).run(estatus, notas || null, id);

                const dev = db.prepare(`
                    SELECT d.*, p.folio, p.cliente, c.telefono
                    FROM devoluciones d
                    LEFT JOIN pedidos p  ON p.id_pedido = d.id_pedido
                    LEFT JOIN clientes c ON c.id = p.id_cliente OR c.nombre = p.cliente
                    WHERE d.id = ? LIMIT 1
                `).get(id);

                // Devolución resuelta: regresar la pieza al inventario real
                // (inverso del descuento que hace marcar-pagado).
                if (estatus === 'resuelta' && dev?.id_producto && dev?.cantidad) {
                    const det = db.prepare(
                        'SELECT sucursal_origen FROM pedido_detalle WHERE id_pedido=? AND id_producto=? LIMIT 1'
                    ).get(dev.id_pedido, dev.id_producto);
                    if (det) {
                        kardexService.movimiento({ id_producto: dev.id_producto, sucursal: det.sucursal_origen, tipo: 'devolucion', delta: dev.cantidad, motivo: 'Devolución pedido ' + (dev.folio || dev.id_pedido), usuario: _sesDev.username });
                        try { require('../../services/contabilidadService').asientoDevolucion(dev.id_pedido, dev.id_producto, dev.cantidad); }
                        catch (e) { log.debug('Asiento de devolución no registrado: ' + e.message); }
                    }
                }

                if (dev?.telefono) {
                    const msgs = {
                        aprobada:  '✅ Tu devolución (pedido *' + (dev.folio||'') + '*) fue *aprobada*. Pronto te contactamos para el reembolso o cambio.',
                        rechazada: '❌ Revisamos tu devolución (pedido *' + (dev.folio||'') + '*) y no pudo ser aprobada' + (notas ? ': ' + notas : '.') + ' Si tienes dudas, escríbenos.',
                        resuelta:  '✅ Tu devolución (pedido *' + (dev.folio||'') + '*) quedó *resuelta*. ¡Gracias por tu paciencia!',
                    };
                    if (msgs[estatus]) {
                        db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización devolución',?,'pendiente')")
                          .run(dev.telefono, msgs[estatus]);
                    }
                }
                return json(res, { ok:true, estatus });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/cola_atencion — antes solo se veía el conteo (/api/stats);
    // el asesor no tenía forma de ver QUIÉN espera ni por qué desde el dashboard.
    return next();
};
