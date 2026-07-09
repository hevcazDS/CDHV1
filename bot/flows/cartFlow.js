// flows/cartFlow.js — Estados: SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON
// Cada flow es independiente: un error aquí se captura en el router
// y NO tumba el resto del bot. Frases con sistema de tonos via t().
'use strict';
const shared = require('./_shared');
const {
    enHorario,
    msgHorarioAsesor,
    calcularFlete,
    generarFolio,
    boostStock,
    limpiarQuery,
    searchProducts,
    wizardSearch,
    buscarCobertura,
    stockEnSucursal,
    stockGlobal,
    agregarAlCarrito,
    totalCarrito,
    aplicarCupon,
    validarStockMultiple,
    partirCarrito,
    formatParticion,
    resumenEscenariosMixtos,
    formatCarrito,
    upsertCliente,
    insertarLinkPago,
    insertarPedidoConCarrito,
    grabarPedidoPickup,
    grabarPedidoEnvio,
    grabarPedidoSplit,
    grabarPedidoPickupUnificado,
    formatProducts,
    menuPrincipal,
    tagCliente,
    quitarTag,
    registrarEscalada,
    puntosHandler,
    log,
    sessionManager,
    estafeta,
    emailSvc,
    db,
    stockService,
    S,
    HORARIO,
    HORARIO_ASESOR,
    _RE_DEVOLUCION,
    UMBRAL_ENVIO_GRA,
    COSTO_ENVIO_STD,
    MAX_MISMO_PROD,
    _STOPWORDS,
    _MessageMedia,
    t,
    moduloActivo,
    mostrarCarrito,
    bloquePago,
    vocab,
    debePreguntarMetodoPago,
    pagoMetodosActivos,
    menuPago,
    instruccionPago,
    registrarMetodoPago,
} = shared;

const STEPS = [S.SHOW_CART, S.CONFIRM_ORDER, S.OFERTAS, S.CUPON, S.PAGO_METODO, S.PAGO_COMPROBANTE];

async function handle(ctx) {
    const { userId, session, message, client, raw, action, step, data, tel } = ctx;

    if (step === S.SHOW_CART) {
        const carrito = data.carrito || [];
        if (!carrito.length) {
            sessionManager.updateSession(userId, S.SEARCHING, {});
            return `Tu carrito está vacío. ¿Qué ${vocab().item} buscas? 🔍`;
        }

        if (action === '1' || action.includes('seguir') || action.includes('buscar')) {
            sessionManager.updateSession(userId, S.SEARCHING, { ...data });
            return `🔍 ¿Qué otro ${vocab().item} buscas?`;
        }
        if (action === '2' || action.includes('pagar') || action.includes('continuar')) {
            const _sub = totalCarrito(carrito);
            shared.logEvento('checkout_iniciado', _sub.toFixed(2), tel);
            sessionManager.updateSession(userId, S.ASK_CP, { ...data });
            // Ventas: anclar el subtotal ANTES de pedir el CP (menos fricción).
            return `🛒 Tu subtotal es *$${_sub.toFixed(2)} MXN*.

📮 Dime tu *código postal* para calcular el envío y darte el total exacto:`;
        }
        if (action === '3' || action.includes('vaciar') || action.includes('limpiar')) {
            sessionManager.updateSession(userId, S.SEARCHING, { ...data, carrito: [] });
            return `🗑️ Carrito vaciado. ¿Qué ${vocab().item} buscas? 🔍`;
        }

        // Fix 2: eliminar producto individual — "quitar 1" o "eliminar 2"
        const _quitarMatch = raw.match(/(?:quitar|eliminar|borrar|sacar|remover)\s+(\d+)/i);
        if (_quitarMatch) {
            const _idx = parseInt(_quitarMatch[1]) - 1;
            if (_idx >= 0 && _idx < carrito.length) {
                const _nombre = carrito[_idx].name;
                const _newCarrito = carrito.filter((_, i) => i !== _idx);
                sessionManager.updateSession(userId, S.SHOW_CART, { ...data, carrito: _newCarrito });
                if (!_newCarrito.length) {
                    sessionManager.updateSession(userId, S.SEARCHING, { ...data, carrito: [] });
                    return `🗑️ *${_nombre}* eliminado. Tu carrito quedó vacío.\n¿Qué ${vocab().item} buscas? 🔍`;
                }
                return `🗑️ *${_nombre}* eliminado del carrito.\n\n` + mostrarCarrito(_newCarrito);
            }
        }

        // Cambiar cantidad — "cambiar 1 a 2" o "2 unidades del 1"
        const _cantMatch = raw.match(/(?:cambiar|poner|quiero)\s+(?:el\s+)?(\d+)\s+(?:a\s+|en\s+)?(\d+)\s*(?:unidad|pieza|pz)?/i)
                        || raw.match(/(\d+)\s+(?:unidad|pieza|pz|unidades|piezas)\s+(?:del?\s+)?(\d+)/i);
        if (_cantMatch) {
            const _pos  = parseInt(_cantMatch[1]) - 1; // número del producto en lista
            const _cant = parseInt(_cantMatch[2]);
            if (_pos >= 0 && _pos < carrito.length && _cant >= 1 && _cant <= MAX_MISMO_PROD) {
                const _newC = [...carrito];
                _newC[_pos] = { ..._newC[_pos], cantidad: _cant };
                sessionManager.updateSession(userId, S.SHOW_CART, { ...data, carrito: _newC });
                return `✅ Actualizado: *${_newC[_pos].name}* — ${_cant} unidad${_cant > 1 ? 'es' : ''}.\n\n` + mostrarCarrito(_newC);
            }
            if (_cant > MAX_MISMO_PROD) return `⚠️ Máximo *${MAX_MISMO_PROD} unidades* por producto. Escribe un asesor para pedidos mayoristas.`;
        }

        // Mostrar carrito con instrucciones
        return mostrarCarrito(carrito) + '\n\n_Escribe *quitar 1* para eliminar un producto, o *cambiar 1 a 2* para ajustar cantidad._';
    }

    // ── ASK_CP ──────────────────────────────────────────

    if (step === S.CONFIRM_ORDER) {
        if (['1','si','sí','confirmar','confirmo'].includes(action)) {
            // Validar stock en el momento de confirmar — puede haber cambiado desde ASK_CP
            const _carrito = data.carrito || [];
            const _sinStock = [];
            for (const item of _carrito) {
                if (!item.id) continue;
                const _prod = db.prepare('SELECT name, stock_tienda, stock_cedis FROM productos WHERE id=?').get(item.id);
                const _stockTotal = (_prod?.stock_tienda || 0) + (_prod?.stock_cedis || 0);
                if (_stockTotal < (item.cantidad || 1)) {
                    _sinStock.push(_prod?.name || item.name);
                }
            }
            if (_sinStock.length > 0) {
                sessionManager.clearSession(userId);
                return (
                    '\u26A0\uFE0F *Lo sentimos* \u2014 mientras procesabas tu pedido, se agot\u00F3 el stock de:\n\n' +
                    _sinStock.map(n => '\u00B7 ' + n).join('\n') + '\n\n' +
                    'Por favor inicia una nueva b\u00FAsqueda. Escribe *hola* para continuar. \uD83E\uDDF8'
                );
            }
            const resultado = grabarPedidoEnvio(data, tel);
            shared.logEvento('orden_confirmada', resultado.folio, tel); // embudo (CRO)
            tagCliente(tel, 'pedido_pendiente');
            const _eprevPeds = db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE id_cliente=(SELECT id FROM clientes WHERE telefono=? LIMIT 1) OR cliente=?").get(tel, data.nombre||tel);
            if ((_eprevPeds?.n||0) >= 1) tagCliente(tel, 'cliente_recurrente');

            const _descuentoCupon    = resultado.descuentoCupon || 0;
            const _descuentoReferido = resultado.descuentoReferido || 0;

            const _resumen = (
                `✅ *¡Pedido confirmado!* 🎉\n\n` +
                `📋 *Folio:* ${resultado.folio}\n\n` +
                `${formatCarrito(data.carrito || [], resultado.costoEnv)}` +
                (_descuentoCupon > 0 ? `\n🏷️ Cupón *${data.cupon}*: -$${_descuentoCupon.toFixed(2)} MXN` : '') +
                (_descuentoReferido > 0 ? `\n🎁 Descuento de bienvenida (referido) -10%: -$${_descuentoReferido.toFixed(2)} MXN` : '') +
                (_descuentoCupon > 0 || _descuentoReferido > 0 ? `\n💵 *Total final: $${resultado.total.toFixed(2)} MXN*` : '') + `\n\n` +
                `🚚 Enviamos a: ${data.calle}, ${data.colonia}, ${data.ciudad}\n` +
                (resultado.guia
                    ? `📦 Guía: *${resultado.guia.numeroGuia}*\n` +
                      `📅 Entrega estimada: *${resultado.guia.fechaEntregaHuman}*\n\n`
                    : '\n')
            );

            // Pago multi-método modular: si el negocio lo activó y hay 2+ formas,
            // el cliente ELIGE cómo pagar (efectivo/tarjeta a la entrega/etc.).
            if (debePreguntarMetodoPago()) {
                const _metodos = pagoMetodosActivos();
                sessionManager.updateSession(userId, S.PAGO_METODO, {
                    _pagoPedidos: [{ folio: resultado.folio, linkUrl: resultado.linkUrl }],
                    _pagoMetodos: _metodos,
                });
                return _resumen + menuPago(_metodos);
            }
            sessionManager.clearSession(userId);
            return _resumen +
                bloquePago(resultado.linkUrl, `💳 *Paga aquí _(link válido 48 hrs)_:*\n${resultado.linkUrl}`) + `\n\n` +
                `¡Gracias por tu compra! ${vocab().emoji} Escribe *hola* si necesitas algo más.`;
        }
        if (action === '2') {
            sessionManager.updateSession(userId, S.ASK_NOMBRE, { ...data });
            return `✏️ ¿Cuál es tu *nombre completo*?`;
        }
        if (action === '3' || action.includes('cupon') || action.includes('cupón') || action.includes('descuento')) {
            if (data.idPromo) {
                return '🏷️ Ya tienes el cupón *' + (data.cupon || '') + '* aplicado a este pedido — solo se permite uno por compra.\n\n' +
                    '1️⃣  ✅ Confirmar y pagar\n2️⃣  ✏️ Corregir dirección\n4️⃣  ❌ Cancelar';
            }
            sessionManager.updateSession(userId, S.CUPON, { ...data });
            return '🏷️ Escribe tu *código de descuento*:';
        }
        if (action === '4') {
            sessionManager.clearSession(userId);
            return t('cancelado') || `❌ Pedido cancelado. Escribe *hola* cuando quieras volver. 🧸`;
        }
        return `Responde con 1, 2, 3 o 4.`;
    }

    // ── ADD_MORE (legacy — redirige a SEARCHING con carrito) ─

    if (step === S.OFERTAS) {
        const _ofertas = data.ofertas || [];
        const _idx = parseInt(action, 10) - 1;

        // El cliente eligió un número válido
        if (!isNaN(_idx) && _idx >= 0 && _idx < _ofertas.length) {
            const _o = _ofertas[_idx];
            const _prod = db.prepare('SELECT * FROM productos WHERE id=? LIMIT 1').get(_o.id);
            if (_prod) {
                // Precio de oferta aplicado al producto
                const _prodOferta = {
                    ..._prod,
                    price:            _o.precio_oferta,
                    _precioOriginal:  _prod.price,
                    _descuento:       _o.valor,
                    _fechaVence:      _o.fecha_fin,
                    _esOferta:        true,
                };
                const desc = _prod.seo_description || _prod.description || '';
                const infoCarr = (data.carrito||[]).length > 0
                    ? '\n🛒 _' + data.carrito.length + ' en carrito · $' + totalCarrito(data.carrito).toFixed(2) + ' MXN_'
                    : '';

                // Mandar a VIEW_PRODUCT con el producto YA seleccionado (viewing seteado)
                sessionManager.updateSession(userId, S.VIEW_PRODUCT, {
                    carrito:  data.carrito || [],
                    products: [_prodOferta],
                    source:   'oferta',
                    viewing:  _prodOferta,
                });

                // Enviar imagen con precio tachado en el caption
                if (_prod.url_imagen && client) {
                    try {
                        const MessageMedia = _MessageMedia; // cacheado al inicio
                        const caption =
                            '🏷️ *OFERTA: ' + _prod.name + '*\n' +
                            '📦 ' + _prod.cat + '\n' +
                            '~~$' + Number(_prod.price).toFixed(2) + '~~ → *$' + Number(_o.precio_oferta).toFixed(2) + ' MXN* (-' + _o.valor + '%)' +
                            (_o.fecha_fin ? '\n⏰ Oferta válida hasta ' + _o.fecha_fin : '') +
                            (desc ? '\n\n📝 ' + desc : '');
                        const media = await MessageMedia.fromUrl(_prod.url_imagen, { unsafeMime: true });
                        await client.sendMessage(userId, media, { caption });
                    } catch(e) { log.warn('Imagen de oferta no disponible', e); }
                }

                return (
                    (!_prod.url_imagen
                        ? '🏷️ *OFERTA: ' + _prod.name + '*\n' +
                          '📦 ' + _prod.cat + '\n' +
                          '~~$' + Number(_prod.price).toFixed(2) + '~~ → *$' + Number(_o.precio_oferta).toFixed(2) + ' MXN* (-' + _o.valor + '%)' +
                          (_o.fecha_fin ? '\n⏰ Hasta ' + _o.fecha_fin : '') +
                          (desc ? '\n\n📝 ' + desc + '\n' : '\n')
                        : '') +
                    infoCarr + (infoCarr ? '\n\n' : '') +
                    '1️⃣  🛒 Agregar y seguir buscando\n' +
                    '2️⃣  ✅ Agregar y pagar\n' +
                    '3️⃣  🔙 Ver otras ofertas\n' +
                    '4️⃣  🏠 Volver al menú'
                );
            }
        }

        // El cliente quiere ver otras ofertas o no eligió número válido
        if (action === '3' || action.includes('otra') || action.includes('más oferta')) {
            sessionManager.updateSession(userId, S.MENU, {});
            return menuPrincipal(tel);
        }

        if (_ofertas.length) {
            const _lista = _ofertas.map((o, i) =>
                (i+1) + '. *' + o.name + '* — ~~$' + Number(o.price).toFixed(2) + '~~ *$' + Number(o.precio_oferta).toFixed(2) + '* (-' + o.valor + '%)'
            ).join('\n');
            return '🏷️ Elige el número de la oferta que te interesa:\n\n' + _lista + '\n\nO escribe *hola* para ver el menú.';
        }
        sessionManager.updateSession(userId, S.MENU, {});
        return menuPrincipal(tel);
    }

    // ── CUPON ─────────────────────────────────────────────

    if (step === S.CUPON) {
        if (['cancelar','cancel','hola','no','salir'].includes(action)) {
            sessionManager.updateSession(userId, S.CONFIRM_ORDER, { ...data });
            const carrito = data.carrito || [];
            const costoEn = calcularFlete(totalCarrito(carrito), data.costoEnvFijo || null);
            return (
                '📋 *Resumen de tu pedido:*\n\n' +
                formatCarrito(carrito, costoEn) + '\n\n' +
                '📍 ' + data.nombre + '\n' +
                data.calle + ', ' + data.colonia + '\n' +
                data.ciudad + ' CP ' + data.cp + '\n\n' +
                '1️⃣  ✅ Confirmar y pagar\n2️⃣  ✏️ Corregir dirección\n3️⃣  🏷️ Tengo un cupón\n4️⃣  ❌ Cancelar'
            );
        }

        const resultado = aplicarCupon(raw, data.carrito || [], null);
        if (!resultado.ok) {
            return '❌ ' + resultado.error + '\n\nEscribe otro código o escribe *cancelar* para volver al resumen.';
        }

        // Cupón válido — guardar en sesión y mostrar resumen actualizado
        const carrito  = data.carrito || [];
        const costoEn  = calcularFlete(totalCarrito(carrito), data.costoEnvFijo || null);
        const totalSinDesc = totalCarrito(carrito) + costoEn;

        // Registrar uso del cupón — guarda atómica (WHERE usos_actual<usos_max) para
        // que dos canjes simultáneos del mismo código de un solo uso no pasen ambos.
        try {
            const _upd = db.prepare(
                'UPDATE promociones SET usos_actual=usos_actual+1 WHERE id=? AND (usos_max=0 OR usos_actual<usos_max)'
            ).run(resultado.promo.id);
            if (_upd.changes === 0) {
                return '❌ Ese cupón ya alcanzó su límite de usos.\n\nEscribe otro código o escribe *cancelar* para volver al resumen.';
            }
            shared.logEvento('cupon_aplicado', raw.trim().toUpperCase(), tel);
        } catch(e) {
            log.debug('No se pudo registrar uso de cupón: ' + e.message);
            return '❌ No se pudo aplicar el cupón, intenta de nuevo.\n\nEscribe otro código o escribe *cancelar* para volver al resumen.';
        }

        sessionManager.updateSession(userId, S.CONFIRM_ORDER, {
            ...data,
            cupon:        raw.trim().toUpperCase(),
            descuentoCupon: resultado.descuento,
            idPromo:      resultado.promo.id,
        });

        return (
            '✅ *¡Cupón aplicado!* 🎉\n\n' +
            '📋 *Resumen actualizado:*\n\n' +
            formatCarrito(carrito, costoEn) + '\n' +
            '🏷️ Cupón *' + raw.trim().toUpperCase() + '*: -$' + resultado.descuento.toFixed(2) + ' MXN (' + resultado.descripcion + ')\n' +
            '━━━━━━━━━━━━━━━━━\n' +
            '💵 *Total final: $' + (totalSinDesc - resultado.descuento).toFixed(2) + ' MXN*\n\n' +
            '📍 ' + data.nombre + '\n' +
            data.calle + ', ' + data.colonia + '\n' +
            data.ciudad + ' CP ' + data.cp + '\n\n' +
            '1️⃣  ✅ Confirmar y pagar\n2️⃣  ✏️ Corregir dirección\n4️⃣  ❌ Cancelar'
        );
    }
    // ── PAGO_METODO — el cliente elige cómo pagar (modular) ───────────────
    if (step === S.PAGO_METODO) {
        const metodos = data._pagoMetodos || [];
        const pedidos = data._pagoPedidos || [];
        const idx = parseInt(action, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= metodos.length) {
            return 'Por favor responde con el número de tu forma de pago.\n\n' + menuPago(metodos);
        }
        const elegido = metodos[idx];
        registrarMetodoPago(pedidos, elegido.nombre);
        // TRANSFERENCIA: pedir la FOTO del comprobante aquí mismo (auditoría
        // multimodal: antes la foto caía al fallback y se perdía)
        if (elegido.nombre === 'transferencia') {
            sessionManager.updateSession(userId, S.PAGO_COMPROBANTE, { _pagoPedidos: pedidos });
            return (
                '✅ *Forma de pago registrada.*\n\n' +
                instruccionPago(elegido, pedidos) + '\n\n' +
                '📸 Cuando hagas la transferencia, *mándame aquí mismo la foto del comprobante* y lo pasamos a validar.\n\n_O escribe *luego* si prefieres enviarlo después._'
            );
        }
        sessionManager.clearSession(userId);
        return (
            '✅ *Forma de pago registrada.*\n\n' +
            instruccionPago(elegido, pedidos) + '\n\n' +
            `¡Gracias por tu compra! ${vocab().emoji} Escribe *hola* si necesitas algo más.`
        );
    }

    // ── PAGO_COMPROBANTE — el cliente manda la foto de su transferencia ──
    if (step === S.PAGO_COMPROBANTE) {
        const isImage = ctx.isImage;
        const pedidos = data._pagoPedidos || [];
        const folios = pedidos.map(pp => pp.folio || ('#' + pp.id)).join(', ');
        if (isImage) {
            // la imagen ya quedó guardada por el pipeline; escalar a validación
            try {
                registrarEscalada(userId, null, 'Comprobante de transferencia recibido — validar pago de ' + folios, tel);
            } catch (e) { log.warn('No se pudo encolar validación de comprobante: ' + e.message); }
            // reenviar el comprobante DIRECTO al WhatsApp del asesor
            try {
                const _op = shared.getValor('operador_telefono', process.env.ASESOR_WHATSAPP);
                if (_op && message?.downloadMedia) {
                    const _media = await message.downloadMedia();
                    if (_media) await client.sendMessage(String(_op).replace(/\D/g, '') + '@c.us', _media,
                        { caption: '🧾 Comprobante de transferencia — ' + folios + ' · cliente ' + tel });
                }
            } catch (e) { log.debug('No se pudo reenviar comprobante: ' + e.message); }
            sessionManager.clearSession(userId);
            return '✅ ¡Recibí tu comprobante! El equipo lo valida y te confirmamos por aquí.\n\n¡Gracias por tu compra! ' + vocab().emoji;
        }
        if (/lueg|despu|más tarde|mas tarde|rato/i.test(raw)) {
            sessionManager.clearSession(userId);
            return 'Va — cuando lo tengas, mándame la foto por aquí y lo validamos. ¡Gracias por tu compra! ' + vocab().emoji;
        }
        return '📸 Mándame la *foto* del comprobante de tu transferencia, o escribe *luego* para enviarla después.';
    }

    return undefined; // estado no manejado por este flow
}

module.exports = { handle, STEPS };
