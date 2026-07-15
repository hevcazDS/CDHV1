// flows/asesorFlow.js — Estados: ASESOR, LISTA_ESPERA, CSAT, DEVOLUCION
// Cada flow es independiente: un error aquí se captura en el router
// y NO tumba el resto del bot. Frases con sistema de tonos via t().
'use strict';
const shared = require('./_shared');
const { registrarErrorDB } = require('../dbErrorLog');
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
    getValor,
    mostrarCarrito,
    vocab,
} = shared;

const STEPS = [S.ASESOR, S.LISTA_ESPERA, S.CSAT, S.DEVOLUCION];

async function handle(ctx) {
    const { userId, session, message, client, raw, action, step, data, tel, isImage } = ctx;

    if (step === S.ASESOR) {
        if (data.modo === 'rastreo' && /^[A-Z0-9\-]{4,30}$/i.test(raw)) {
            const lp = db.prepare(
                `SELECT lp.monto, lp.estatus, lp.creado_en, p.estatus AS est_pedido
                 FROM links_pago lp JOIN pedidos p ON p.id_pedido = lp.id_pedido
                 WHERE lp.token_externo LIKE ? LIMIT 1`
            ).get(`%${raw.toUpperCase()}%`);
            if (lp) {
                return `📦 *Pedido ${limpiarQuery(raw).toUpperCase()}*\n📌 Estatus: *${lp.est_pedido}*\n💳 Pago: *${lp.estatus}*\n💰 Total: $${Number(lp.monto).toFixed(2)}\n\nEscribe *hola* para volver al menú.`;
            }
            return `No encontré el pedido *${limpiarQuery(raw)}*. Verifica el folio o escribe *hola* para hablar con un asesor.`;
        }
        if (!data._notificado) {
            sessionManager.updateSession(userId, S.ASESOR, { ...data, _notificado: true });
            return 'Tu solicitud fue registrada. ' + vocab().emoji + '\n⏰ Horario: *' + HORARIO_ASESOR + '*\n\n' + msgHorarioAsesor() + '\n\nEscribe *hola* para volver al menú.';
        }
        return null; // ya notificado — silencio hasta que escriba hola
    }

    // LISTA_ESPERA
    if (step === S.LISTA_ESPERA) {
        const _idP = data.idProducto;
        const _query = data._queryOriginal || '';
        const _sinRes = data._sinResultado || false;

        if (action === '1') {
            // Registrar en lista espera — si hay idProducto usa ese, si no registra por texto
            if (_idP) {
                const _r = stockService.registrarListaEspera(tel, _idP, data.nombre||tel, 1);
                sessionManager.clearSession(userId);
                return _r.ok
                    ? '\uD83D\uDD14 Anotado. Te avisamos en cuanto llegue a nuestra tienda.\n\nEscribe *hola* para volver al men\u00fa.'
                    : 'Ya est\u00e1s en lista de espera para ese producto. Te avisaremos pronto.';
            } else {
                // Sin producto específico — guardar como búsqueda en lista de espera genérica
                // Usamos el producto de score más alto del fallback si existe
                try {
                    db.prepare("INSERT INTO lista_espera (id_producto, telefono, nombre_cliente, cantidad, precio_al_registrar, estatus, canal, notas) VALUES (1, ?, ?, 1, 0, 'activa', 'whatsapp', ?)")
                      .run(tel, data.nombre||tel, 'Busqueda: '+_query.slice(0,100));
                } catch(e) { log.debug('No se pudo registrar lista de espera genérica: ' + e.message); }
                sessionManager.clearSession(userId);
                return '\uD83D\uDD14 Anotado. Te avisamos en cuanto llegue a nuestra tienda.\n\nEscribe *hola* para volver al men\u00fa.';
            }
        }

        if (action === '2') {
            // Lanzar wizard con mensaje especial de entrada
            sessionManager.updateSession(userId, S.WIZARD_Q1, {
                carrito: data.carrito || [],
                _desdeListaEspera: true,
            });
            return '*\u00bfPara qui\u00e9n es el ' + vocab().item + '?*\n\n1\uFE0F\u20E3  \uD83D\uDC76 Beb\u00e9 (0\u20132 a\u00f1os)\n2\uFE0F\u20E3  \uD83E\uDDD2 Ni\u00f1o/a (3\u20138 a\u00f1os)\n3\uFE0F\u20E3  \uD83E\uDDD1 Preadolescente (9\u201312)\n4\uFE0F\u20E3  \uD83C\uDF93 Adolescente / Adulto';
        }

        sessionManager.clearSession(userId);
        return menuPrincipal(tel);
    }
    // CSAT
    if (step === S.CSAT) {
        const _cal = parseInt(action, 10);
        if (_cal >= 1 && _cal <= 5) {
            try { db.prepare('INSERT INTO valoraciones (id_pedido,id_cliente,calificacion,canal) VALUES (?, (SELECT id FROM clientes WHERE telefono=? LIMIT 1), ?,\'whatsapp\')').run(data.idPedido||null, tel, _cal);
                    // Auto-tag por calificación
                    if (_cal >= 4) tagCliente(tel, 'cliente_satisfecho');
                    if (_cal <= 2) {
                        tagCliente(tel, 'queja');
                        // CSAT bajo (1-2 estrellas) — escalar a un asesor humano en vez
                        // de quedar solo como un tag invisible en el perfil del cliente.
                        registrarEscalada(userId, data.idPedido || null, 'CSAT bajo (' + _cal + '/5)', tel, 'csat_bajo', null);
                    } } catch(e){ log.debug('No se pudo registrar valoración CSAT: ' + e.message); }
            sessionManager.clearSession(userId);
            return _cal >= 4 ? '\u2B50 \u00a1Gracias! Nos alegra tu experiencia.' : _cal === 3 ? '\uD83D\uDE4F Gracias, tu opini\u00f3n nos ayuda a mejorar.' : '\uD83D\uDCDD Gracias por avisarnos.';
        }
        return 'Responde con un n\u00famero del *1 al 5* \u2B50';
    }

    // ── DEVOLUCION ────────────────────────────────────────
    if (step === S.DEVOLUCION) {
        const _paso = data.paso || 'bienvenida';

        // ── Paso 1: Selección de motivo ───────────────────────────
        if (_paso === 'bienvenida') {
            const _motivos = { '1':'Producto dañado o defectuoso','2':'Producto incorrecto','3':'Llegó duplicado / ya lo tenía','4':'No funciona correctamente' };
            const _motivo = _motivos[action] || (action.length > 3 ? action : 'Otro motivo: ' + raw);
            sessionManager.updateSession(userId, S.DEVOLUCION, { paso: 'pedir_folio', motivo: _motivo });
            return (
                'Entendido, lamentamos lo sucedido. \uD83D\uDE4F\n\n' +
                'Para agilizar tu caso necesito algunos datos.\n\n' +
                '*\u00bfCu\u00e1l es el folio de tu pedido?*\n' +
                '_(Lo encuentras en el mensaje de confirmaci\u00f3n, ejemplo: HEV-PED-000001)_\n\n' +
                'O escribe *sin folio* si no lo tienes.'
            );
        }

        // ── Paso 2: Folio del pedido ──────────────────────────────
        if (_paso === 'pedir_folio') {
            if (/sin folio|no tengo|no s[eé]/i.test(raw)) {
                sessionManager.updateSession(userId, S.DEVOLUCION, { ...data, paso: 'pedir_fecha', idPedido: null, folio: 'SIN FOLIO' });
                return '*\u00bfEn qu\u00e9 fecha aproximadamente realizaste la compra?*\n_(Ejemplo: 25 de mayo, o hace una semana)_';
            }
            const _folio = raw.replace(/[^A-Z0-9\-]/gi, '').toUpperCase().trim();
            const _ped = db.prepare('SELECT id_pedido, folio, estatus, total, cliente, creado_en FROM pedidos WHERE folio=? LIMIT 1').get(_folio);
            if (!_ped) {
                const _int = (data.intentos_folio || 0) + 1;
                if (_int >= 2) {
                    sessionManager.updateSession(userId, S.DEVOLUCION, { ...data, paso: 'pedir_fecha', idPedido: null, folio: 'SIN FOLIO' });
                    return 'Sin problema, continuamos sin el folio. \u00bfEn qu\u00e9 fecha fue tu compra aproximadamente?';
                }
                sessionManager.updateSession(userId, S.DEVOLUCION, { ...data, intentos_folio: _int });
                return 'No encontr\u00e9 ese folio. \uD83D\uDD0D\n\n\u00bfPuedes verificarlo? Debe tener el formato *HEV-PED-000001*\nO escribe *sin folio*.';
            }
            // Identificar qu\u00E9 producto del pedido se est\u00E1 devolviendo \u2014 necesario
            // para poder reintegrar la cantidad correcta a inventarios cuando el
            // asesor marque la devoluci\u00F3n como resuelta.
            const _items = db.prepare(
                'SELECT pd.id_producto, pd.cantidad, pr.name FROM pedido_detalle pd LEFT JOIN productos pr ON pr.id = pd.id_producto WHERE pd.id_pedido=?'
            ).all(_ped.id_pedido);

            if (_items.length > 1) {
                sessionManager.updateSession(userId, S.DEVOLUCION, { ...data, paso: 'pedir_producto', idPedido: _ped.id_pedido, folio: _ped.folio, total: _ped.total, _itemsDevolucion: _items });
                const _lista = _items.map((it,i) => (i+1) + '\uFE0F\u20E3  ' + (it.name||'Producto #'+it.id_producto) + ' (x' + it.cantidad + ')').join('\n');
                return (
                    '\u2705 Pedido encontrado: *' + _ped.folio + '*\n\n' +
                    '*\u00bfQu\u00E9 producto quieres devolver?*\n\n' + _lista
                );
            }

            const _item = _items[0] || null;
            sessionManager.updateSession(userId, S.DEVOLUCION, {
                ...data, paso: 'pedir_foto', idPedido: _ped.id_pedido, folio: _ped.folio, total: _ped.total,
                idProductoDevuelto: _item ? _item.id_producto : null,
                cantidadDevuelta:   _item ? _item.cantidad    : null,
            });
            return (
                '\u2705 Pedido encontrado: *' + _ped.folio + '*\n' +
                '\uD83D\uDCB0 Total: $' + Number(_ped.total||0).toFixed(2) + ' MXN\n\n' +
                '*\u00bfTienes una foto del producto con el problema?*\n_(Nos ayuda mucho para agilizar tu caso)_\n\n' +
                '1\uFE0F\u20E3  S\u00ed, la env\u00edo ahora\n' +
                '2\uFE0F\u20E3  No tengo foto'
            );
        }

        // \u2500\u2500 Paso 2c: Elegir cu\u00E1l producto del pedido se devuelve \u2500\u2500
        if (_paso === 'pedir_producto') {
            const _items = data._itemsDevolucion || [];
            const _idx = parseInt(action, 10) - 1;
            if (isNaN(_idx) || _idx < 0 || _idx >= _items.length) {
                const _lista = _items.map((it,i) => (i+1) + '\uFE0F\u20E3  ' + (it.name||'Producto #'+it.id_producto) + ' (x' + it.cantidad + ')').join('\n');
                return 'Por favor elige el n\u00FAmero del producto que quieres devolver:\n\n' + _lista;
            }
            const _sel = _items[_idx];
            sessionManager.updateSession(userId, S.DEVOLUCION, { ...data, paso: 'pedir_foto', idProductoDevuelto: _sel.id_producto, cantidadDevuelta: _sel.cantidad });
            return (
                '*\u00bfTienes una foto del producto con el problema?*\n_(Nos ayuda mucho para agilizar tu caso)_\n\n' +
                '1\uFE0F\u20E3  S\u00ed, la env\u00edo ahora\n' +
                '2\uFE0F\u20E3  No tengo foto'
            );
        }

        // ── Paso 2b: Fecha (cuando no hay folio) ─────────────────
        if (_paso === 'pedir_fecha') {
            sessionManager.updateSession(userId, S.DEVOLUCION, { ...data, paso: 'pedir_foto', fechaCompra: raw });
            return (
                'Anotado. \uD83D\uDCDD\n\n' +
                '*\u00bfTienes una foto del producto con el problema?*\n_(Nos ayuda mucho para agilizar tu caso)_\n\n' +
                '1\uFE0F\u20E3  S\u00ed, la env\u00edo ahora\n' +
                '2\uFE0F\u20E3  No tengo foto'
            );
        }

        // ── Paso 3: Foto ──────────────────────────────────────────
        if (_paso === 'pedir_foto') {
            const _tieneFoto = isImage || action === '1';
            let _evidencia = null;
            if (isImage) {
                _evidencia = (global.__ultimaImagenPorTel || {})[tel] || null;
                // Reenviar la foto DIRECTO al WhatsApp del asesor (antes solo
                // se guardaba y el asesor tenía que ir al panel a buscarla)
                try {
                    const _op = getValor('operador_telefono', process.env.ASESOR_WHATSAPP);
                    if (_op && message.downloadMedia) {
                        const _media = await message.downloadMedia();
                        if (_media) await client.sendMessage(_op.replace(/\D/g, '') + '@c.us', _media,
                            { caption: '📸 Evidencia de devolución — pedido ' + (data.idPedido || 's/folio') + ' · cliente ' + tel });
                    }
                } catch (e) { log.debug('No se pudo reenviar evidencia al asesor: ' + e.message); }
            }
            sessionManager.updateSession(userId, S.DEVOLUCION, { ...data, paso: 'pedir_donde_compro', tieneFoto: _tieneFoto, evidencia: _evidencia });
            return (
                (_tieneFoto ? '\uD83D\uDCF8 Foto recibida, gracias. ' : 'Sin problema. ') +
                '\u00bfD\u00f3nde realizaste la compra?\n\n' +
                '1\uFE0F\u20E3  Por WhatsApp (este chat)\n' +
                '2\uFE0F\u20E3  En tienda f\u00edsica\n' +
                '3\uFE0F\u20E3  Por otro medio'
            );
        }

        // ── Paso 4: Canal de compra ───────────────────────────────
        if (_paso === 'pedir_donde_compro') {
            const _cmap = { '1':'WhatsApp','2':'Tienda f\u00edsica','3':'Otro medio' };
            const _canal = _cmap[action] || raw;
            sessionManager.updateSession(userId, S.DEVOLUCION, { ...data, paso: 'pedir_metodo_pago', canalCompra: _canal });
            return (
                '*\u00bfCu\u00e1l fue tu m\u00e9todo de pago?*\n\n' +
                '1\uFE0F\u20E3  PayPal\n2\uFE0F\u20E3  Efectivo\n' +
                '3\uFE0F\u20E3  Tarjeta\n4\uFE0F\u20E3  Transferencia\n5\uFE0F\u20E3  Otro'
            );
        }

        // ── Paso 5: Método de pago → registrar y escalar ─────────
        if (_paso === 'pedir_metodo_pago') {
            const _mmap = { '1':'PayPal','2':'Efectivo','3':'Tarjeta','4':'Transferencia','5':'Otro' };
            const _metodo = _mmap[action] || raw;
            const _resumen = `${data.motivo} | Canal: ${data.canalCompra} | Pago: ${_metodo} | Foto: ${data.tieneFoto?'Sí':'No'}`;

            try {
                db.prepare(
                    'INSERT INTO devoluciones (id_pedido,motivo,estatus,id_producto,cantidad,evidencia_url,creada_en) VALUES (?,?,\'solicitada\',?,?,?,datetime(\'now\',\'localtime\'))'
                ).run(data.idPedido||null, _resumen, data.idProductoDevuelto||null, data.cantidadDevuelta||null, data.evidencia||null);
            } catch(e){ log.debug('No se pudo registrar devolución: ' + e.message); }
            tagCliente(tel, 'devolucion');
            try {
                db.prepare(
                    'INSERT INTO cola_atencion (id_conversacion,id_cliente,motivo_escalada,prioridad,estatus,tipo) VALUES (NULL,NULL,?,2,\'en_espera\',\'devolucion\')'
                ).run('DEVOLUCI\u00d3N ' + (data.folio||'SIN FOLIO') + ' | ' + _resumen);
            } catch(e){ log.debug('No se pudo registrar cola_atencion de devoluci\u00f3n: ' + e.message); }

            const _at = getValor('operador_telefono', process.env.ASESOR_WHATSAPP);
            if (_at) {
                try {
                    db.prepare('INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES (\'whatsapp\',?,?,?,\'pendiente\')').run(
                        _at, 'Devoluci\u00f3n solicitada',
                        '\u21A9\uFE0F *DEVOLUCI\u00d3N SOLICITADA*\nFolio: ' + (data.folio||'Sin folio') + '\nCliente: ' + tel + '\nMotivo: ' + data.motivo + '\nCanal: ' + data.canalCompra + '\nPago: ' + _metodo + '\nFoto: ' + (data.tieneFoto?'S\u00ed':'No') + '\nTotal: $' + Number(data.total||0).toFixed(2) + ' MXN'
                    );
                } catch(e){ log.debug('No se pudo notificar devolución al asesor: ' + e.message); registrarErrorDB('asesorFlow:devolucion', e.message, { folio: data.folio }); }
            }

            sessionManager.clearSession(userId);
            return (
                '\u2705 *Listo, tu solicitud fue registrada.*\n\n' +
                '\uD83D\uDCCB Folio: *' + (data.folio||'En revisi\u00f3n') + '*\n' +
                '\uD83D\uDCDD Motivo: ' + data.motivo + '\n\n' +
                msgHorarioAsesor() + '\n\n' +
                '\u00a1Gracias por tu paciencia! \uD83E\uDDF8'
            );
        }

        sessionManager.updateSession(userId, S.DEVOLUCION, { paso: 'bienvenida' });
        return '\u21A9\uFE0F \u00bfQu\u00e9 pas\u00f3 con tu producto?\n\n1\uFE0F\u20E3  Da\u00f1ado o defectuoso\n2\uFE0F\u20E3  Producto incorrecto\n3\uFE0F\u20E3  Lleg\u00f3 duplicado\n4\uFE0F\u20E3  No funciona\n5\uFE0F\u20E3  Otro motivo';
    }

    // ── OFERTAS ───────────────────────────────────────────
    return undefined; // estado no manejado por este flow
}

module.exports = { handle, STEPS };
