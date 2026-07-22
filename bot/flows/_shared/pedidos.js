// ═══════════════════════════════════════════════════════
//  pedidos.js — grabado de pedido (link de pago + inserción de
//  cabecera/detalle + las 4 rutas grabarPedido*). Extraído mecánicamente
//  de bot/flows/_shared.js, sin cambio de lógica. Depende de carrito.js
//  (totalCarrito) y clientes.js (upsertCliente) además del núcleo (_base).
// ═══════════════════════════════════════════════════════
const { db, moduloActivo, log, estafeta, emailSvc, mensajeService, referidosService, generarFolio, calcularFlete } = require('./_base');
const { totalCarrito } = require('./carrito');
const { upsertCliente } = require('./clientes');

// ═══════════════════════════════════════════════════════
//  GRABADO DE PEDIDO — soporta carrito múltiple
// ═══════════════════════════════════════════════════════
function insertarLinkPago(pedidoRowid, monto, folio) {
    const token   = `PP-${folio}-${Date.now()}`;
    let linkUrl;
    if (moduloActivo('pago_real_activo')) {
        linkUrl = _crearLinkPagoReal(pedidoRowid, monto, folio, token);
    } else if (moduloActivo('pago_link_activo')) {
        // Link de pago del negocio (su Clip/MP/gateway) — punto único
        try { linkUrl = require('../../../services/pagoLinkService').generarLink({ idPedido: pedidoRowid, folio, monto }).url; }
        catch (_) { linkUrl = `https://www.paypal.com/checkoutnow?token=${token}`; }
    } else {
        linkUrl = `https://www.paypal.com/checkoutnow?token=${token}`;
    }
    const expira  = new Date(Date.now() + 48*3600*1000).toISOString().replace('T',' ').substring(0,19);
    db.prepare(`
        INSERT INTO links_pago (id_pedido, id_metodo, url_link, token_externo, monto, moneda, estatus, fecha_expiracion)
        VALUES (?, 4, ?, ?, ?, 'MXN', 'generado', ?)
    `).run(pedidoRowid, linkUrl, token, monto, expira);
    return linkUrl;
}

// Fase 2 (futura): conectar con Conekta/OpenPay/Mercado Pago una vez existan
// credenciales reales. Hasta entonces, encender pago_real_activo solo falla
// alto en vez de cobrar simulado como si fuera dinero real.
function _crearLinkPagoReal(pedidoRowid, monto, folio, token) {
    throw new Error('pago_real_activo está activo pero no hay integración de pago real configurada todavía');
}

/**
 * Inserta cabecera del pedido + detalle por cada item del carrito.
 * Retorna { pedidoRowid, subtotal }
 */
const _insertarPedidoConCarritoTx = db.transaction((clienteNombre, carrito, ciudadEnvio, estatus, sucursalOrigen, folio, idCliente, canalCreacion) => {
    // Primer producto como referencia para la cabecera (compatibilidad con esquema actual)
    const prodRef = carrito[0];
    const cantRef = carrito[0].cantidad;

    const info = db.prepare(`
        INSERT INTO pedidos (cliente, id_cliente, id_producto, ciudad_envio, cantidad, estatus, folio, canal_creacion, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(clienteNombre, idCliente || null, prodRef.id, ciudadEnvio, cantRef, estatus, folio || null, canalCreacion || 'bot');

    const pedidoRowid = info.lastInsertRowid;
    let subtotal = 0;

    // Insertar línea por cada item del carrito
    let stmtDetalle;
    try {
        // Incluye costo_unitario (migración 0061): congela el costo del producto
        // al momento del pedido para que el COGS del período no dependa de una
        // entrada de mercancía posterior. Si la columna no existe, cae al stmtViejo.
        stmtDetalle = db.prepare(`
            INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal_linea, sucursal_origen, costo_unitario, id_variante, variante)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
    } catch (_) { stmtDetalle = null; } // BD sin migración 0061/0027
    const stmtViejo = db.prepare(`
        INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal_linea, sucursal_origen)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const costoDe = db.prepare('SELECT costo FROM productos WHERE id=?');
    for (const item of carrito) {
        const lineTotal = item.price * item.cantidad;
        const costo = item.id ? (costoDe.get(item.id)?.costo ?? null) : null; // servicios/texto libre → null
        if (stmtDetalle) stmtDetalle.run(pedidoRowid, item.id, item.cantidad, item.price, lineTotal, sucursalOrigen || '', costo, item.id_variante || null, item.variante || null);
        else stmtViejo.run(pedidoRowid, item.id, item.cantidad, item.price, lineTotal, sucursalOrigen || '');
        subtotal += lineTotal;
    }

    return { pedidoRowid, subtotal };
});

/**
 * Inserta cabecera del pedido + detalle por cada item del carrito.
 * Retorna { pedidoRowid, subtotal }
 */
function insertarPedidoConCarrito(clienteNombre, carrito, ciudadEnvio, estatus, sucursalOrigen, folio, idCliente, canalCreacion) {
    return _insertarPedidoConCarritoTx(clienteNombre, carrito, ciudadEnvio, estatus, sucursalOrigen, folio, idCliente, canalCreacion);
}

// ── Helpers de deduplicación de grabarPedido* ───────────────────────────
// Bloques que se repetían byte-por-byte en las 4 rutas de grabado de pedido
// (pickup / envío / split / pickup-unificado). Cada uno es una extracción
// mecánica de un fragmento idéntico — no cambian el orden ni la lógica de
// cada función llamante, solo evitan repetir el texto.
function _calcRefInfo(telefono, carrito, descuentoManual) {
    // Descuento automático de bienvenida del referido (10%, un solo uso) —
    // no se combina con un cupón manual ya aplicado.
    return descuentoManual ? { aplica: false, descuento: 0 } : referidosService.calcularDescuentoReferido(telefono, carrito);
}
function _actualizarTotalesPedido(pedidoRowid, subtotalBruto, descuento, total) {
    db.prepare('UPDATE pedidos SET subtotal=?, descuento=?, total=? WHERE id_pedido=?').run(subtotalBruto, descuento, total, pedidoRowid);
}
function _actualizarCpPedido(pedidoRowid, cp) {
    if (!cp) return;
    try { db.prepare('UPDATE pedidos SET cp=? WHERE id_pedido=?').run(cp, pedidoRowid); }
    catch(e) { log.debug('No se pudo guardar CP en pedido: ' + e.message); }
}
function _generarCodigoRetiro() {
    return `RET-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
}
function _insertarReservaPickup(pedidoRowid, idPunto, limiteMs, codigo) {
    if (!idPunto) return;
    const limite = new Date(Date.now() + limiteMs).toISOString().replace('T',' ').substring(0,19);
    db.prepare(`INSERT INTO reservas_pickup (id_pedido, id_punto, estatus, fecha_limite, codigo_retiro) VALUES (?,?,'apartado',?,?)`)
      .run(pedidoRowid, idPunto, limite, codigo);
}

// Base compartida por grabarPedidoPickup / grabarPedidoPickupUnificado — las
// dos únicas de las 4 rutas cuyo esqueleto es idéntico (mismo orden de
// escritura en BD, mismo shape de retorno). grabarPedidoEnvio y
// grabarPedidoSplit divergen demasiado (flete/dirección/guía Estafeta en
// Envio; dos sub-pedidos con descuento repartido en Split) como para forzar
// la misma base sin arriesgar un cambio de comportamiento — quedan aparte,
// pero reusan los helpers de arriba donde su fragmento es idéntico.
function _grabarPedidoPickupBase(data, telefono, opts) {
    const { estatus, limiteMs, enviarEmail, buildCarrito } = opts;
    const cliente = upsertCliente(telefono, data.nombre || null);
    const carrito = buildCarrito(data);
    const folio   = generarFolio('pedido');
    const subtotalBruto = totalCarrito(carrito);

    const _refInfo = _calcRefInfo(telefono, carrito, data.descuentoCupon);
    const descuentoReferido = _refInfo.aplica ? _refInfo.descuento : 0;
    const subtotal = subtotalBruto - descuentoReferido;

    const { pedidoRowid } = insertarPedidoConCarrito(
        cliente.nombre || telefono, carrito, data.ciudad_cob || '', estatus, data.estado_cob, folio, cliente.id,
        data.origenVentaPrevia ? 'asesor' : 'bot'
    );
    _actualizarTotalesPedido(pedidoRowid, subtotalBruto, descuentoReferido, subtotal);
    _actualizarCpPedido(pedidoRowid, data.cp);
    const linkUrl = insertarLinkPago(pedidoRowid, subtotal, folio);
    if (_refInfo.aplica) referidosService.marcarDescuentoReferidoUsado(_refInfo.idCliente);

    const codigo = _generarCodigoRetiro();
    _insertarReservaPickup(pedidoRowid, data.idPunto, limiteMs, codigo);

    if (enviarEmail) {
        // Notificar por correo (async)
        const productosEmailPu = carrito.map(i => ({ nombre:i.name, cantidad:i.cantidad, precio:i.price }));
        emailSvc.notificarPedido({
            folio, idPedido: pedidoRowid,
            cliente: cliente.nombre || telefono,
            total: subtotal, subtotal: subtotalBruto, costoEnv: 0, metodo: 'pickup',
            tipoEntrega: 'pickup',
            codigoRetiro: codigo,
            productos: productosEmailPu,
            linkPago: linkUrl,
            fechaCreacion: new Date().toLocaleString('es-MX'),
        }).catch(e => log.warn('Error email', e));
    }

    mensajeService.marcarOutcome(db, telefono, 'venta');
    return { folio, total: subtotal, linkUrl, codigo, descuentoReferido };
}

function grabarPedidoPickup(data, telefono) {
    return _grabarPedidoPickupBase(data, telefono, {
        estatus: 'Pick Up Pendiente',
        limiteMs: 72 * 3600 * 1000,
        enviarEmail: true,
        buildCarrito: (d) => d.carrito && d.carrito.length ? d.carrito : [{ ...d.selectedProduct, cantidad: 1 }],
    });
}

// Anticipo de cita = un PEDIDO normal de una línea (el servicio) cuyo total es el
// anticipo, por la MISMA ruta de dinero (insertarPedidoConCarrito + insertarLinkPago)
// que converge en marcar-pagado. NO descuenta inventario (es un servicio). Reusa el
// patrón del apartado de preventas. Ver DISENO_MOTOR_FLUJO.md §E.1.
function grabarPedidoAnticipoCita(data, telefono) {
    const folio   = generarFolio('pedido');
    const cliente = upsertCliente(telefono, data.nombre || null);
    const carrito = data.carrito;                       // [{ id: servicio, name, price: anticipo, cantidad: 1 }]
    const total   = data.total;                         // = anticipo
    const { pedidoRowid } = insertarPedidoConCarrito(
        cliente.nombre || telefono, carrito, '', 'Anticipo Pendiente', '', folio, cliente.id, 'bot'
    );
    db.prepare('UPDATE pedidos SET subtotal=?, total=? WHERE id_pedido=?').run(total, total, pedidoRowid);
    const linkUrl = insertarLinkPago(pedidoRowid, total, folio);
    return { pedidoRowid, folio, linkUrl };
}

function grabarPedidoEnvio(data, telefono) {
    const folio   = generarFolio('pedido');
    const cliente = upsertCliente(telefono, data.nombre);
    const carrito = data.carrito && data.carrito.length ? data.carrito : [{ ...data.selectedProduct, cantidad: 1 }];
    const subtotal  = totalCarrito(carrito);
    const costoEnv  = calcularFlete(subtotal, data.costoEnvFijo || null);
    // El cupón (si se aplicó en el flujo CUPON de cartFlow.js) debe descontarse
    // aquí mismo: este `total` es el que se cobra en el link de pago real.
    const descuentoCupon = data.descuentoCupon || 0;
    const _refInfo = _calcRefInfo(telefono, carrito, descuentoCupon);
    const descuentoReferido = _refInfo.aplica ? _refInfo.descuento : 0;
    const descuento = descuentoCupon + descuentoReferido;
    const total     = subtotal + costoEnv - descuento;
    if (_refInfo.aplica) referidosService.marcarDescuentoReferidoUsado(_refInfo.idCliente);

    db.prepare(`
        INSERT INTO direcciones_envio (id_cliente, alias, calle, colonia, ciudad, estado, cp, referencia, es_default)
        VALUES (?, 'WhatsApp', ?, ?, ?, ?, ?, ?, 1)
    `).run(cliente.id, data.calle, data.colonia, data.ciudad, data.estado_cob, data.cp, data.referencia || '');

    const { pedidoRowid } = insertarPedidoConCarrito(
        data.nombre, carrito, data.ciudad || data.ciudad_cob, 'Pendiente', data.estado_cob, folio, cliente.id,
        data.origenVentaPrevia ? 'asesor' : 'bot'
    );
    _actualizarTotalesPedido(pedidoRowid, subtotal, descuento, total);
    _actualizarCpPedido(pedidoRowid, data.cp);
    // Método de entrega a domicilio: paquetería (con guía Estafeta) o
    // repartidor propio (entrega local, SIN guía). Default 'paqueteria' deja
    // a Julio Cepeda igual que siempre.
    const _metodoEntrega = data.metodoEntrega === 'repartidor' ? 'repartidor' : 'paqueteria';
    try { db.prepare('UPDATE pedidos SET metodo_entrega=? WHERE id_pedido=?').run(_metodoEntrega, pedidoRowid); } catch(e) { log.debug('No se pudo guardar metodo_entrega: ' + e.message); }
    const linkUrl = insertarLinkPago(pedidoRowid, total, folio);

    // Crear guía simulada de Estafeta — solo para paquetería. El repartidor
    // propio es entrega local, no genera guía.
    let guiaData = null;
    if (_metodoEntrega === 'repartidor') {
        mensajeService.marcarOutcome(db, telefono, 'venta');
        return { folio, total, linkUrl, costoEnv, subtotal, guia: null, descuentoCupon, descuentoReferido, metodoEntrega: 'repartidor' };
    }
    try {
        const idEnvioRow = db.prepare(
            'INSERT INTO envios (id_pedido, id_paqueteria, costo_envio, estatus) VALUES (?,1,?,?)'
        ).run(pedidoRowid, costoEnv, 'pendiente');
        guiaData = estafeta.crearGuia({
            idPedido:    pedidoRowid,
            idEnvio:     idEnvioRow.lastInsertRowid,
            destNombre:  data.nombre || cliente.nombre,
            destCalle:   data.calle || '',
            destColonia: data.colonia || '',
            destCiudad:  data.ciudad || data.ciudad_cob || '',
            destEstado:  data.estado_cob || '',
            destCp:      data.cp || '',
            destTelefono: telefono,
            contenido:   (carrito[0]?.name || 'Juguete').slice(0, 50),
        });
    } catch(e) { log.warn('Error creando guía estafeta', e); }

    // Notificar por correo (async, no bloquea)
    const productosEmail = carrito.map(i => ({ nombre:i.name, cantidad:i.cantidad, precio:i.price }));
    emailSvc.notificarPedido({
        folio, idPedido: pedidoRowid,
        cliente: data.nombre || cliente.nombre,
        total, subtotal, costoEnv, metodo: 'envio',
        tipoEntrega: 'envio',
        ciudad: data.ciudad || data.ciudad_cob || '',
        estado: data.estado_cob || '',
        calle: data.calle || '', colonia: data.colonia || '', cp: data.cp || '',
        productos: productosEmail,
        linkPago: linkUrl,
        guia: guiaData,
        fechaCreacion: new Date().toLocaleString('es-MX'),
    }).catch(e => log.warn('Error email', e));

    mensajeService.marcarOutcome(db, telefono, 'venta');
    return { folio, total, linkUrl, costoEnv, subtotal, guia: guiaData, descuentoCupon, descuentoReferido };
}

// ═══════════════════════════════════════════════════════
//  GRABADO PEDIDO SPLIT (pickup + envío independientes)
// ═══════════════════════════════════════════════════════

/**
 * Graba dos pedidos independientes: uno pickup y uno de envío.
 * Retorna { pedidoPickup, pedidoEnvio } con sus respectivos folios, totales y links.
 */
function grabarPedidoSplit(data, telefono) {
    const cliente      = upsertCliente(telefono, data.nombre || null);
    const carritoPickup = data.carritoPickup || [];
    const carritoEnvio  = data.carritoEnvio  || [];
    const resultados    = {};

    // Descuento automático de bienvenida del referido — se evalúa sobre el
    // carrito combinado (para la regla de "no aplica con artículos en
    // oferta") y, si aplica, se carga completo a un solo sub-pedido (el de
    // envío si existe, si no al de pickup) para no fraccionar un 10% entre
    // dos folios distintos.
    const _refInfo = _calcRefInfo(telefono, [...carritoPickup, ...carritoEnvio], data.descuentoCupon);
    const _descAEnvio  = _refInfo.aplica && carritoEnvio.length > 0;
    const _descAPickup = _refInfo.aplica && !_descAEnvio && carritoPickup.length > 0;

    // ── Pedido Pickup ────────────────────────────────
    if (carritoPickup.length) {
        const folio    = generarFolio('pedido');
        const subtotalBruto = totalCarrito(carritoPickup);
        const descuentoReferido = _descAPickup ? _refInfo.descuento : 0;
        const subtotal = subtotalBruto - descuentoReferido;
        const { pedidoRowid } = insertarPedidoConCarrito(
            cliente.nombre || telefono, carritoPickup, data.ciudad_cob || '', 'Pick Up Pendiente', data.estado_cob, folio, cliente.id,
            data.origenVentaPrevia ? 'asesor' : 'bot'
        );
        _actualizarTotalesPedido(pedidoRowid, subtotalBruto, descuentoReferido, subtotal);
        _actualizarCpPedido(pedidoRowid, data.cp);
        const linkUrl = insertarLinkPago(pedidoRowid, subtotal, folio);
        const codigo  = _generarCodigoRetiro();
        _insertarReservaPickup(pedidoRowid, data.idPunto, 72 * 3600 * 1000, codigo);
        resultados.pedidoPickup = { folio, total: subtotal, linkUrl, codigo, descuentoReferido };
    }

    // ── Pedido Envío ─────────────────────────────────
    if (carritoEnvio.length) {
        const folio    = generarFolio('pedido');
        const subtotalBruto = totalCarrito(carritoEnvio);
        const costoEnv = calcularFlete(subtotalBruto, data.costoEnvFijo || null);
        const descuentoReferido = _descAEnvio ? _refInfo.descuento : 0;
        const total    = subtotalBruto + costoEnv - descuentoReferido;

        // Dirección (solo se inserta una vez, reutilizable)
        if (data.calle) {
            try {
                db.prepare(`
                    INSERT INTO direcciones_envio (id_cliente, alias, calle, colonia, ciudad, estado, cp, referencia, es_default)
                    VALUES (?, 'WhatsApp', ?, ?, ?, ?, ?, ?, 1)
                `).run(cliente.id, data.calle, data.colonia, data.ciudad, data.estado_cob, data.cp, data.referencia || '');
            } catch(e) { /* dirección ya puede existir */ }
        }

        const { pedidoRowid } = insertarPedidoConCarrito(
            data.nombre || cliente.nombre, carritoEnvio, data.ciudad || data.ciudad_cob, 'Pendiente', data.estado_cob, folio, cliente.id,
            data.origenVentaPrevia ? 'asesor' : 'bot'
        );
        _actualizarTotalesPedido(pedidoRowid, subtotalBruto, descuentoReferido, total);
        const linkUrl = insertarLinkPago(pedidoRowid, total, folio);
        resultados.pedidoEnvio = { folio, total, linkUrl, costoEnv, subtotal: subtotalBruto, descuentoReferido };
    }

    if (_refInfo.aplica && (resultados.pedidoPickup || resultados.pedidoEnvio)) {
        referidosService.marcarDescuentoReferidoUsado(_refInfo.idCliente);
    }
    if (resultados.pedidoPickup || resultados.pedidoEnvio) mensajeService.marcarOutcome(db, telefono, 'venta');
    return resultados;
}

/**
 * Graba UN pedido de pickup unificado con TODOS los items,
 * incluyendo los que normalmente irían a envío (cliente eligió esperar en sucursal).
 */
function grabarPedidoPickupUnificado(data, telefono) {
    // 14 días de plazo (vs 72h en pickup normal): el cliente eligió esperar
    // en sucursal a que lleguen los artículos de almacén, no es un retiro
    // inmediato. Sin notificación por correo (histórico: solo grabarPedidoPickup
    // la envía).
    return _grabarPedidoPickupBase(data, telefono, {
        estatus: 'Pick Up Pendiente — Espera artículos de almacén',
        limiteMs: 14 * 24 * 3600 * 1000,
        enviarEmail: false,
        buildCarrito: (d) => [...(d.carritoPickup || []), ...(d.carritoEnvio || [])],
    });
}

module.exports = {
    insertarLinkPago,
    insertarPedidoConCarrito,
    grabarPedidoPickup,
    grabarPedidoEnvio,
    grabarPedidoAnticipoCita,
    grabarPedidoSplit,
    grabarPedidoPickupUnificado,
};
