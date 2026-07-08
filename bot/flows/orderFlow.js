// flows/orderFlow.js — Estados: ASK_CP, SPLIT_DELIVERY, SPLIT_CONFIRM, DELIVERY, PICKUP_CONFIRM
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
    iniciarCapturaDireccion,
    bloquePago,
    vocab,
    debePreguntarMetodoPago,
    pagoMetodosActivos,
    menuPago,
} = shared;

const STEPS = [S.ASK_CP, S.SPLIT_DELIVERY, S.SPLIT_CONFIRM, S.DELIVERY, S.PICKUP_CONFIRM];

async function handle(ctx) {
    const { userId, session, message, client, raw, action, step, data, tel } = ctx;

    if (step === S.ASK_CP) {
        const cpNum = raw.replace(/\D/g, '').slice(0, 5);
        if (cpNum.length < 5) return `El código postal debe tener 5 dígitos. Ejemplo: *78000*`;

        const carrito = (data.carrito && data.carrito.length)
            ? data.carrito
            : (data.selectedProduct ? [{ ...data.selectedProduct, cantidad:1 }] : []);

        if (!carrito.length) {
            sessionManager.updateSession(userId, S.SEARCHING, {});
            return `Parece que no hay productos en el carrito. ¿Qué ${vocab().item} buscas?`;
        }

        const subtotal = totalCarrito(carrito);
        const cob      = buscarCobertura(cpNum);

        // ── Métodos de entrega activos (módulos, Bloque 2). Defaults dejan a
        // Julio Cepeda igual: pickup ON, paquetería ON, repartidor OFF. ──
        const _delPickup = moduloActivo('entrega_pickup_activo');
        const _delPaq    = moduloActivo('entrega_paqueteria_activo');
        const _delRep    = moduloActivo('entrega_repartidor_activo');
        // Método de entrega a domicilio efectivo (paquetería tiene prioridad si
        // ambos están activos). null = el negocio no entrega a domicilio.
        const _metodoDom = _delPaq ? 'paqueteria' : (_delRep ? 'repartidor' : null);

        // ── Sin cobertura local → solo envío a domicilio ──────────────────────
        if (!cob) {
            if (!_metodoDom) {
                // No hay envío a domicilio configurado y sin cobertura local → asesor.
                registrarEscalada(userId, null, 'Sin método de entrega para su zona', tel);
                sessionManager.updateSession(userId, S.ASESOR, { ...data, modo:'sin_entrega' });
                return '😔 Por ahora no tenemos entrega para tu zona. Un asesor te ayuda. 👤\n🟢 _Conectando..._';
            }
            const costoEnvSC = calcularFlete(subtotal);
            sessionManager.updateSession(userId, S.DELIVERY, {
                ...data, cp:cpNum, estado_cob:'', ciudad_cob:'', stockLocal:0,
                idPunto:null, soloEnvio:true, sinCobertura:true, costoEnvFijo:costoEnvSC, carrito,
                metodoEntrega:_metodoDom
            });
            const _domTxt = _metodoDom === 'repartidor' ? 'entrega con repartidor' : 'envío a domicilio';
            return (
                `📦 Por el momento solo contamos con *${_domTxt}* para tu zona.\n\n` +
                `${formatCarrito(carrito, costoEnvSC)}\n\n` +
                `1️⃣  🚚 Continuar con ${_domTxt}\n` +
                `2️⃣  👤 Hablar con un asesor`
            );
        }

        const ciudad = cob.ciudad || cob.capital;
        const punto  = db.prepare('SELECT * FROM puntos_entrega WHERE estado=? AND activo=1 LIMIT 1').get(cob.estado);

        // ── Clasificar carrito por disponibilidad en sucursal ─────────────────
        let { pickup, envio, sinStock } = partirCarrito(carrito, cob.estado);

        // Si el negocio NO ofrece pickup, todo lo "recogible" pasa a entrega a
        // domicilio (requiere que haya un método de domicilio activo).
        if (!_delPickup && pickup.length) {
            if (!_metodoDom) {
                registrarEscalada(userId, null, 'Sin método de entrega activo (pickup off, sin domicilio)', tel);
                sessionManager.updateSession(userId, S.ASESOR, { ...data, modo:'sin_entrega' });
                return '😔 No hay un método de entrega disponible ahora mismo. Un asesor te ayuda. 👤';
            }
            envio  = [...pickup.map(i => ({ ...i, _diasEntrega: i._diasEntrega || 2 })), ...envio];
            pickup = [];
        }

        // Sin stock total → escalar
        if (sinStock.length) {
            const nombres = sinStock.map(i => `• ${i.name}`).join('\n');
            registrarEscalada(userId, null, `Sin stock para: ${sinStock.map(i=>i.name).join(', ')}`, tel);
            sessionManager.updateSession(userId, S.ASESOR, { ...data, modo:'sin_stock' });
            return (
                `😔 Los siguientes productos no tienen stock disponible:\n${nombres}\n\n` +
                `Un asesor verifica opciones. 👤\n🟢 _Conectando..._`
            );
        }

        const baseData = {
            ...data, cp:cpNum, estado_cob:cob.estado, ciudad_cob:ciudad,
            idPunto: punto ? punto.id : null, carrito, metodoEntrega:_metodoDom
        };

        // ── Carrito homogéneo (todo pickup O todo envío) → flujo normal ───────
        if (!pickup.length) {
            // Todo requiere envío a domicilio
            const costoEnv = calcularFlete(subtotal);
            sessionManager.updateSession(userId, S.DELIVERY, { ...baseData, soloEnvio:true });
            // La opción "recibir en sucursal" solo aplica si el negocio ofrece pickup.
            return (
                `📦 Los productos de tu carrito se surten desde almacén central.\n\n` +
                `${formatCarrito(carrito, costoEnv)}\n\n` +
                `1️⃣  🚚 Envío a domicilio — ${costoEnv===0?'*¡GRATIS!*':`*$${costoEnv} MXN*`}\n` +
                (_delPickup ? `2️⃣  🏪 Recibir todo en sucursal _(espera ~${Math.max(...envio.map(i=>i._diasEntrega))} días)_\n` : '') +
                `3️⃣  👤 Hablar con un asesor`
            );
        }

        if (!envio.length) {
            // Todo disponible en tienda. Si el negocio no entrega a domicilio
            // (solo pickup), ofrecer únicamente recoger en sucursal.
            const costoEnv = calcularFlete(subtotal);
            sessionManager.updateSession(userId, S.DELIVERY, { ...baseData });
            if (!_metodoDom) {
                return (
                    `✅ Hay disponibilidad en *${ciudad}*.\n\n${formatCarrito(carrito)}\n\n` +
                    `1️⃣  🏪 Recoger en sucursal — _Sin costo, listo hoy_\n` +
                    `2️⃣  👤 Hablar con un asesor`
                );
            }
            // Regla de negocio: "gratis" SOLO para envío/flete — pickup es "sin costo"
            const fleteTxt = costoEnv === 0 ? '*¡GRATIS!*' : `*$${costoEnv} MXN*`;
            const msgDisp = t('disponibilidad_local', { ciudad, flete: fleteTxt });
            return (msgDisp
                ? `${msgDisp}\n\n${formatCarrito(carrito)}`
                : `✅ Hay disponibilidad en *${ciudad}*. ¿Cómo lo recibes?\n\n` +
                  `${formatCarrito(carrito)}\n\n` +
                  `1️⃣  🏪 Pick Up — _Sin costo, listo hoy_\n` +
                  `2️⃣  🚚 Envío a domicilio — ${fleteTxt}`
            );
        }

        // ── Carrito MIXTO ─────────────────────────────────────────────────────
        // Si el negocio no entrega a domicilio (solo pickup), los artículos de
        // almacén se reciben en sucursal tras la espera → un solo pedido pickup.
        if (!_metodoDom) {
            const diasMax = Math.max(...envio.map(i => i._diasEntrega || 5));
            sessionManager.updateSession(userId, S.PICKUP_CONFIRM, {
                ...baseData, metodo:'pickup_unificado',
                carritoPickup: pickup, carritoEnvio: envio,
                carrito: [...pickup, ...envio],
            });
            return (
                `🏪 *Entrega en sucursal*\n\n` +
                `Algunos artículos llegan de almacén en ~*${diasMax} días hábiles*; te avisamos cuando estén listos para recoger.\n\n` +
                `${formatCarrito([...pickup, ...envio])}\n\n` +
                `1️⃣  ✅ Confirmar y recoger en sucursal\n` +
                `2️⃣  👤 Hablar con un asesor`
            );
        }

        // Presentar los 3 escenarios (pickup + domicilio disponibles)
        const subtotalPickup  = totalCarrito(pickup);
        const subtotalEnvio   = totalCarrito(envio);
        const fleteEnvio      = calcularFlete(subtotalEnvio);       // flete solo por la parte de envío
        const fleteUnificado  = calcularFlete(subtotal);            // flete si todo va a domicilio

        sessionManager.updateSession(userId, S.SPLIT_DELIVERY, {
            ...baseData,
            carritoPickup: pickup,
            carritoEnvio:  envio,
            subtotalPickup, subtotalEnvio,
            fleteEnvio, fleteUnificado,
        });

        return (
            resumenEscenariosMixtos(pickup, envio, subtotalPickup, subtotalEnvio, fleteEnvio, fleteUnificado) +
            `\n\n¿Cuál prefieres?\n\n` +
            `1️⃣  ✂️ Dos pedidos separados (pickup + envío)\n` +
            `2️⃣  🏪 Recibir todo en sucursal _(sin costo de flete, espera ~${Math.max(...envio.map(i=>i._diasEntrega))} días)_\n` +
            `3️⃣  🚚 Enviar todo a domicilio`
        );
    }


    // ── SPLIT_DELIVERY ───────────────────────────────────
    // El cliente tiene un carrito mixto (algunos items en tienda, otros en CEDIS)
    // y eligió cómo quiere dividirlo.
    if (step === S.SPLIT_DELIVERY) {
        const carritoPickup = data.carritoPickup || [];
        const carritoEnvio  = data.carritoEnvio  || [];

        // Opción A — Dos pedidos separados
        if (action === '1') {
            // Para los de envío necesitamos dirección → empezar captura
            const promptDir = iniciarCapturaDireccion(userId, tel, {
                ...data,
                metodo: 'split',
                // carritoPickup y carritoEnvio ya están en data
            });
            return (
                `✂️ *Perfecto, haremos dos pedidos independientes.*\n\n` +
                `🏪 *Pickup (disponible hoy):* ${carritoPickup.map(i=>i.name).join(', ')}\n` +
                `📦 *Envío a domicilio:* ${carritoEnvio.map(i=>i.name).join(', ')}\n\n` +
                `Para el envío necesito tu dirección.\n` +
                `${promptDir}`
            );
        }

        // Opción B — Todo en sucursal (cliente espera los de CEDIS)
        if (action === '2') {
            const diasMax = Math.max(...carritoEnvio.map(i => i._diasEntrega || 5));
            const punto   = data.idPunto
                ? db.prepare('SELECT * FROM puntos_entrega WHERE id=?').get(data.idPunto)
                : null;
            sessionManager.updateSession(userId, S.PICKUP_CONFIRM, {
                ...data,
                metodo: 'pickup_unificado',
                carrito: [...carritoPickup, ...carritoEnvio],
            });
            return (
                `🏪 *Entrega unificada en sucursal*\n\n` +
                `📍 ${punto ? punto.nombre : 'Sucursal ' + data.ciudad_cob}\n` +
                (punto && punto.direccion ? `   ${punto.direccion}\n` : '') +
                `🕐 Horario: *${HORARIO}*\n\n` +
                `📦 Los artículos de almacén llegarán en aprox. *${diasMax} días hábiles*.\n` +
                `Te avisaremos cuando estén listos para recoger.\n\n` +
                `${formatCarrito([...carritoPickup,...carritoEnvio])}\n\n` +
                `¿Confirmas recoger todo en sucursal?\n\n` +
                `1️⃣  ✅ Sí, confirmar\n` +
                `2️⃣  🔙 Ver otras opciones`
            );
        }

        // Opción C — Todo a domicilio
        if (action === '3') {
            const carrito  = [...carritoPickup, ...carritoEnvio];
            const subtotal = totalCarrito(carrito);
            const costoEnv = data.fleteUnificado !== undefined ? data.fleteUnificado : calcularFlete(subtotal);
            const promptDir = iniciarCapturaDireccion(userId, tel, {
                ...data,
                metodo: 'envio',
                carrito,
                costoEnvFijo: costoEnv,
            });
            return (
                `🚚 *Todo a domicilio.*\n\n` +
                `${formatCarrito(carrito, costoEnv)}\n\n` +
                `${promptDir}`
            );
        }

        return `Responde con 1, 2 o 3.`;
    }

    // ── SPLIT_CONFIRM ────────────────────────────────────
    // Confirma y graba los dos pedidos (pickup + envío) después de capturar la dirección.
    if (step === S.SPLIT_CONFIRM) {
        if (['1','si','sí','confirmar','confirmo'].includes(action)) {
            const { pedidoPickup, pedidoEnvio } = grabarPedidoSplit(data, tel);
            tagCliente(tel, 'pedido_pendiente');
            const _multi = debePreguntarMetodoPago();

            let msg = `✅ *¡Pedidos confirmados!* 🎉\n\n`;

            if (pedidoPickup) {
                msg += (
                    `🏪 *Pedido Pick Up*\n` +
                    `📋 Folio: *${pedidoPickup.folio}*\n` +
                    `${formatParticion(data.carritoPickup,'pickup')}\n` +
                    (pedidoPickup.descuentoReferido > 0 ? `🎁 Descuento de bienvenida (referido) -10%: -$${pedidoPickup.descuentoReferido.toFixed(2)} MXN\n` : '') +
                    `💰 Total: *$${Number(pedidoPickup.total).toFixed(2)} MXN*\n` +
                    `🔐 Código de retiro: \`${pedidoPickup.codigo}\`\n` +
                    (_multi ? '' : bloquePago(pedidoPickup.linkUrl, `💳 Pagar aquí:\n${pedidoPickup.linkUrl}`)) + `\n\n`
                );
            }

            if (pedidoEnvio) {
                msg += (
                    `🚚 *Pedido Envío a Domicilio*\n` +
                    `📋 Folio: *${pedidoEnvio.folio}*\n` +
                    `${formatParticion(data.carritoEnvio,'envio')}\n` +
                    `📍 ${data.calle}, ${data.colonia}, ${data.ciudad}\n` +
                    `📦 Flete: ${pedidoEnvio.costoEnv===0?'*¡GRATIS!*':`*$${pedidoEnvio.costoEnv} MXN*`}\n` +
                    (pedidoEnvio.descuentoReferido > 0 ? `🎁 Descuento de bienvenida (referido) -10%: -$${pedidoEnvio.descuentoReferido.toFixed(2)} MXN\n` : '') +
                    `💰 Total: *$${Number(pedidoEnvio.total).toFixed(2)} MXN*\n` +
                    (_multi ? '' : bloquePago(pedidoEnvio.linkUrl, `💳 Pagar aquí:\n${pedidoEnvio.linkUrl}`)) + `\n\n`
                );
            }

            const gran_total = (pedidoPickup?.total||0) + (pedidoEnvio?.total||0);
            msg += `━━━━━━━━━━━━━━━━━\n💵 *Gran total: $${gran_total.toFixed(2)} MXN*\n\n`;

            // Pago multi-método: una sola elección para ambos pedidos.
            if (_multi) {
                const _metodos = pagoMetodosActivos();
                const _peds = [pedidoPickup, pedidoEnvio].filter(Boolean).map(pd => ({ folio: pd.folio, linkUrl: pd.linkUrl }));
                sessionManager.updateSession(userId, S.PAGO_METODO, { _pagoPedidos: _peds, _pagoMetodos: _metodos });
                return msg + menuPago(_metodos);
            }
            sessionManager.clearSession(userId);
            msg += `¡Gracias por tu compra! ${vocab().emoji} Escribe *hola* si necesitas algo más.`;
            return msg;
        }

        if (action === '2') {
            // Regresar a ver las opciones (re-mostrar resumen)
            const { carritoPickup, carritoEnvio, subtotalPickup, subtotalEnvio, fleteEnvio, fleteUnificado } = data;
            sessionManager.updateSession(userId, S.SPLIT_DELIVERY, data);
            return (
                resumenEscenariosMixtos(carritoPickup, carritoEnvio, subtotalPickup, subtotalEnvio, fleteEnvio, fleteUnificado) +
                `\n\n¿Cuál prefieres?\n\n` +
                `1️⃣  ✂️ Dos pedidos separados\n` +
                `2️⃣  🏪 Todo en sucursal\n` +
                `3️⃣  🚚 Todo a domicilio`
            );
        }

        return `Responde con 1 _(confirmar)_ o 2 _(ver opciones)_.`;
    }

    // ── DELIVERY ────────────────────────────────────────
    if (step === S.DELIVERY) {
        if (data.soloEnvio) {
            if (action === '1' || action.includes('env')) {
                const promptDir = iniciarCapturaDireccion(userId, tel, { ...data, metodo:'envio' });
                return `🚚 ¡Perfecto! ${promptDir}`;
            }
            if (action === '2') {
                sessionManager.updateSession(userId, S.ASESOR, { modo:'asesor' });
                registrarEscalada(userId, null, 'Prefiere asesor en entrega', tel);
                return '👤 Hemos notificado a nuestro equipo.\n⏰ Horario: *' + HORARIO_ASESOR + '*\n\n' + msgHorarioAsesor();
            }
            return `Responde con 1 o 2.`;
        }

        if (action === '1' || action.includes('pick') || action.includes('tienda')) {
            const punto = db.prepare('SELECT * FROM puntos_entrega WHERE estado=? AND activo=1 LIMIT 1').get(data.estado_cob);
            sessionManager.updateSession(userId, S.PICKUP_CONFIRM, { ...data, metodo:'pickup', idPunto: punto ? punto.id : null });
            const mapsUrl = punto && punto.maps_url
                ? punto.maps_url
                : `https://maps.google.com/?q=Julio+Cepeda+Jugueterias+${encodeURIComponent(data.ciudad_cob)}`;
            const carrito = data.carrito || [];
            return (
                `🏪 *${punto ? punto.nombre : 'Sucursal ' + data.ciudad_cob}*\n` +
                (punto && punto.direccion ? `📍 ${punto.direccion}\n` : '') +
                `🗺️ ${mapsUrl}\n` +
                `🕐 ${HORARIO}\n\n` +
                `${formatCarrito(carrito)}\n\n` +
                `¿Confirmas recoger aquí?\n\n` +
                `1️⃣  ✅ Confirmar y pagar\n` +
                `2️⃣  🔙 Cambiar a envío`
            );
        }
        if (action === '2' || action.includes('env') || action.includes('domicilio')) {
            const promptDir = iniciarCapturaDireccion(userId, tel, { ...data, metodo:'envio' });
            return `🚚 ${promptDir}`;
        }
        return `Responde con 1 _(Pick Up)_ o 2 _(Envío a domicilio)_.`;
    }

    // ── PICKUP_CONFIRM ──────────────────────────────────
    if (step === S.PICKUP_CONFIRM) {
        if (['1','si','sí','confirmar','confirmo'].includes(action)) {
            // Modo pickup unificado (todo en sucursal, incluyendo items de CEDIS)
            const resultado = data.metodo === 'pickup_unificado'
                ? grabarPedidoPickupUnificado(data, tel)
                : grabarPedidoPickup(data, tel);

            tagCliente(tel, 'pedido_pendiente');
            const _pprevPeds = db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE id_cliente=(SELECT id FROM clientes WHERE telefono=? LIMIT 1) OR cliente=?").get(tel, data.nombre||tel);
            if ((_pprevPeds?.n||0) >= 1) tagCliente(tel, 'cliente_recurrente');
            const diasMax = data.carritoEnvio && data.carritoEnvio.length
                ? Math.max(...data.carritoEnvio.map(i => i._diasEntrega || 5))
                : null;
            const notaEspera = diasMax
                ? `\n⏳ Los artículos de almacén estarán en sucursal en aprox. *${diasMax} días hábiles*. Te avisaremos.\n`
                : '';
            const _descRefPickup = resultado.descuentoReferido || 0;
            const _resumenPickup = (
                `✅ *¡Listo, pedido confirmado!* 🎉\n\n` +
                `📋 Folio: *${resultado.folio}*\n\n` +
                `${formatCarrito(data.carrito || [])}\n` +
                (_descRefPickup > 0 ? `🎁 Descuento de bienvenida (referido) -10%: -$${_descRefPickup.toFixed(2)} MXN\n💵 *Total final: $${resultado.total.toFixed(2)} MXN*\n` : '') +
                notaEspera + `\n` +
                `🔐 Código de retiro: \`${resultado.codigo}\`\n` +
                `_(Preséntalo en caja al llegar)_\n\n`
            );
            if (debePreguntarMetodoPago()) {
                const _metodos = pagoMetodosActivos();
                sessionManager.updateSession(userId, S.PAGO_METODO, {
                    _pagoPedidos: [{ folio: resultado.folio, linkUrl: resultado.linkUrl }],
                    _pagoMetodos: _metodos,
                });
                return _resumenPickup + menuPago(_metodos);
            }
            sessionManager.clearSession(userId);
            return _resumenPickup +
                bloquePago(resultado.linkUrl, `💳 Paga aquí _(link válido 48 hrs)_:\n${resultado.linkUrl}`) + `\n\n` +
                `¡Gracias por tu compra! ${vocab().emoji} Escribe *hola* si necesitas algo más.`;
        }
        if (action === '2') {
            // Volver a las opciones si era carrito mixto
            if (data.metodo === 'pickup_unificado' && data.carritoPickup) {
                sessionManager.updateSession(userId, S.SPLIT_DELIVERY, data);
                return (
                    resumenEscenariosMixtos(
                        data.carritoPickup, data.carritoEnvio,
                        data.subtotalPickup, data.subtotalEnvio,
                        data.fleteEnvio, data.fleteUnificado
                    ) +
                    `\n\n¿Cuál prefieres?\n\n` +
                    `1️⃣  ✂️ Dos pedidos separados\n` +
                    `2️⃣  🏪 Todo en sucursal\n` +
                    `3️⃣  🚚 Todo a domicilio`
                );
            }
            const promptDir = iniciarCapturaDireccion(userId, tel, { ...data, metodo:'envio' });
            return `🚚 ${promptDir}`;
        }
        return `Responde con 1 _(confirmar)_ o 2 _(opciones)_.`;
    }

    // ── CAPTURA DATOS ENVÍO ─────────────────────────────
    return undefined; // estado no manejado por este flow
}

module.exports = { handle, STEPS };
