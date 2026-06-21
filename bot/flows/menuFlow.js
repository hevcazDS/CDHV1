// flows/menuFlow.js — Estados: MENU, SEARCHING, WIZARD_Q1, WIZARD_Q2, WIZARD_Q3, VIEW_PRODUCT, ADD_MORE
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
} = shared;

// Sugerencia de complementario por familia de producto — reusada al agregar
// al carrito sin importar si el cliente sigue buscando o va directo a pagar.
// ponytail: familias hardcodeadas; mover a tabla si la lista crece mucho.
function buscarUpsellMsg(prod, totalAct) {
    if (!moduloActivo('upselling_activo')) return '';
    const FLETE_UMBRAL = parseFloat(process.env.FLETE_UMBRAL || '699');
    if (totalAct >= FLETE_UMBRAL) return '';
    try {
        const _nombre = (prod.name || '').toLowerCase();
        const _familias = [
            { trigger: /patin|patines/,                    buscar: 'casco protector',     label: '⛸️ Con los patines' },
            { trigger: /bici|bicicleta/,                   buscar: 'casco bicicleta',     label: '🚲 Con la bici' },
            { trigger: /nerf|x.?shot|lanzador|gelfire/,    buscar: 'dardos refill',       label: '🎯 Para tu lanzador' },
            { trigger: /dardo|dart/,                       buscar: 'nerf lanzador',       label: '🎯 Para tus dardos' },
            { trigger: /ksi|bebe|ksimerito/,               buscar: 'ropa accesorios bebe',label: '👶 Para tu bebé' },
            { trigger: /muñeca|barbie|fashion/,            buscar: 'ropa muñeca accesorio',label: '👗 Para tu muñeca' },
            { trigger: /carro|auto|vehiculo|hot wheels/,   buscar: 'pista carros set',    label: '🏎️ Para tus autos' },
        ];
        const _familia = _familias.find(f => f.trigger.test(_nombre));
        if (!_familia) return '';
        const { results: _comp } = searchProducts(_familia.buscar);
        const _disponibles = _comp.filter(p => p.id !== prod.id && (p.stock_tienda > 0 || p.stock_cedis > 0));
        if (!_disponibles.length) return '';
        const _sug = _disponibles[0];
        const _falta = FLETE_UMBRAL - totalAct;
        const _hint = totalAct + _sug.price >= FLETE_UMBRAL
            ? ' _¡Con esto llegas a envío gratis!_ 🎉'
            : ' _Te faltan $' + _falta.toFixed(0) + ' para envío gratis._';
        return '\n\n💡 *' + _familia.label + ', muchos llevan también:*\n' +
            '*' + _sug.name + '* — $' + Number(_sug.price).toFixed(2) + ' MXN' + _hint;
    } catch (_) { return ''; }
}

const STEPS = [S.MENU, S.SEARCHING, S.WIZARD_Q1, S.WIZARD_Q2, S.WIZARD_Q3, S.VIEW_PRODUCT, S.ADD_MORE];

async function handle(ctx) {
    const { userId, session, message, client, raw, action, step, data, tel } = ctx;

    if (step === S.MENU) {
        if (['1','buscar'].includes(action)) {
            sessionManager.updateSession(userId, S.SEARCHING, { carrito: data.carrito || [] });
            return t('buscar_inicio') || `🔍 ¿Qué juguete buscas? Puedes:\n\n· Escribir el nombre o descripción\n· Enviar una *foto* del juguete 📸\n· Pegar el *link* de donde lo viste 🔗\n\n_Ej: "patines para niña" · foto de la caja · link de Amazon o Shopify_`;
        }
        if (['2','wizard','ayuda'].includes(action)) {
            sessionManager.updateSession(userId, S.WIZARD_Q1, { carrito: data.carrito || [] });
            return t('wizard_q1') || `🧙 ¡Te ayudo a encontrar el regalo perfecto! 🎁\n\n*Pregunta 1 de 3* — ¿Para quién es el juguete?\n\n1️⃣  👶 Bebé (0–2 años)\n2️⃣  🧒 Niño/a (3–8 años)\n3️⃣  🧑 Preadolescente (9–12)\n4️⃣  🎓 Adolescente / Adulto`;
        }
        // Detección de devolución por texto libre — todas las variantes
        if (/devolver|devolv|devoluci[oó]n|devuelta|cambiar.*producto|cambio.*producto|quiero.*devolver|quiero.*cambiar|repetido|duplicado|ya.*ten[ií]a|me.*llegó.*mal|llegó.*incorrecto|no.*funciona|est[aá].*roto|est[aá].*da[nñ]ado|garantia|garant[ií]a|me.*equivoqu[eé]|pedido.*mal/i.test(raw)) {
            sessionManager.updateSession(userId, S.DEVOLUCION, { paso: 'bienvenida' });
            return (
                '↩️ Entendido, voy a ayudarte con tu devolución.\n\n' +
                'Cuéntame, *¿qué pasó con tu producto?*\n\n' +
                '1️⃣  Llegó dañado o defectuoso\n' +
                '2️⃣  Me llegó un producto diferente al que pedí\n' +
                '3️⃣  Ya tenía ese producto / llegó duplicado\n' +
                '4️⃣  No funciona correctamente\n' +
                '5️⃣  Otro motivo'
            );
        }
        if (['3','rastrear','pedido','mis pedidos','historial'].includes(action)) {
            // Mostrar historial si el cliente ya tiene pedidos
            try {
                const _peds = db.prepare(`
                    SELECT p.folio, p.estatus, lp.monto, p.creado_en,
                           g.numero_guia, g.estatus AS guia_estatus
                    FROM pedidos p
                    LEFT JOIN links_pago lp ON lp.id_pedido = p.id_pedido
                    LEFT JOIN guias_estafeta g ON g.id_pedido = p.id_pedido
                    WHERE p.cliente = (SELECT nombre FROM clientes WHERE telefono=? LIMIT 1)
                       OR p.id_pedido IN (SELECT id_pedido FROM pedido_detalle WHERE 1=0)
                    ORDER BY p.id_pedido DESC LIMIT 3
                `).all(tel);
                if (_peds.length) {
                    const _lista = _peds.map((p, i) => {
                        const _folio = p.folio || 'Sin folio';
                        const _total = p.monto ? '$' + Number(p.monto).toFixed(2) : '';
                        const _guia  = p.numero_guia ? '\n   🚚 Guía: ' + p.numero_guia + ' (' + (p.guia_estatus||'generada') + ')' : '';
                        return (i+1) + '. *' + _folio + '* — ' + (p.estatus||'Pendiente') + ' ' + _total + _guia;
                    }).join('\n\n');
                    sessionManager.updateSession(userId, S.ASESOR, { modo:'rastreo' });
                    return '📦 *Tus últimos pedidos:*\n\n' + _lista + '\n\n¿Quieres más detalle de alguno? Escríbeme el folio.';
                }
            } catch(e) { log.debug('No se pudo cargar historial de pedidos: ' + e.message); }
            sessionManager.updateSession(userId, S.ASESOR, { modo:'rastreo' });
            return '📦 Escribe tu *número de pedido* (ej. HEV-PED-000001):';
        }
        if (['4','asesor'].includes(action)) {
            sessionManager.updateSession(userId, S.ASESOR, { modo:'asesor' });
            registrarEscalada(userId, null, 'Solicitud directa desde menú', tel);
            return (t('asesor_notificado', { horario: HORARIO_ASESOR }) || ('👤 Hemos notificado a nuestro equipo de ventas.\n\n⏰ Horario de atención: *' + HORARIO_ASESOR + '*')) + '\n\n' + msgHorarioAsesor();
        }
        // Detección de consulta de ofertas / descuentos
        if (/oferta|descuento|promo|rebaja|barato|econom|sale|más bara|lo más bara|qué tienen de oferta|tienen algo de oferta|tienen descuento/i.test(raw)) {
            // Gate: módulo de ofertas desactivado desde el dashboard
            if (!moduloActivo('ofertas_activo')) {
                return '🏷️ En este momento no tenemos ofertas activas.\n\n¡Pero tenemos más de 600 juguetes a excelentes precios! Escribe *1* para buscar.';
            }
            try {
                const _hoy = new Date().toISOString().slice(0, 10);
                const _ofertas = db.prepare(`
                    SELECT pr.id AS id_promo, pr.valor, p.id, p.name, p.price, p.url_imagen, p.cat,
                           ROUND(p.price * (1 - pr.valor / 100.0), 2) AS precio_oferta,
                           pr.fecha_fin
                    FROM promociones pr
                    JOIN productos p ON p.id = pr.id_producto
                    WHERE pr.activa = 1
                      AND (pr.fecha_fin IS NULL OR pr.fecha_fin >= ?)
                      AND (p.stock_tienda > 0 OR p.stock_cedis > 0)
                      AND (pr.usos_max = 0 OR pr.usos_actual < pr.usos_max)
                    ORDER BY pr.valor DESC
                    LIMIT 3
                `).all(_hoy);

                if (_ofertas.length) {
                    const _lista = _ofertas.map((o, i) => {
                        // ponytail: umbral de urgencia fijo en 3 días; ajustar si se quiere antes/después.
                        let _vence = '';
                        if (o.fecha_fin) {
                            const _diasRestantes = Math.ceil((new Date(o.fecha_fin) - new Date(_hoy)) / 86400000);
                            _vence = _diasRestantes <= 3
                                ? ' ⏰ _¡' + (_diasRestantes <= 0 ? 'Solo hoy' : 'Solo ' + _diasRestantes + ' día' + (_diasRestantes > 1 ? 's' : '') + ' más') + '!_'
                                : ' _(hasta ' + o.fecha_fin + ')_';
                        }
                        return (i+1) + '. *' + o.name + '*\n' +
                               '   ~~$' + Number(o.price).toFixed(2) + '~~ → *$' + Number(o.precio_oferta).toFixed(2) + ' MXN* (-' + o.valor + '%)' + _vence;
                    }).join('\n\n');
                    // Guardar las ofertas en sesión para que el cliente elija por número
                    sessionManager.updateSession(userId, S.OFERTAS, {
                        carrito: data.carrito || [],
                        ofertas: _ofertas
                    });
                    return '🏷️ *Ofertas disponibles ahora:*\n\n' + _lista + '\n\n¿Te interesa alguna? Elige el número para ver detalle.';
                } else {
                    return '🏷️ En este momento no tenemos ofertas activas.\n\n¡Pero tenemos más de 600 juguetes a excelentes precios! Escribe *hola* para ver el menú.';
                }
            } catch(e) { /* continuar flujo normal si falla */ }
        }

        // Detección de intención desde MENU (texto libre)
        const _SOLO_SALUDO = new Set(['hola','hi','hey','buenas','buenos','buen','ok','okay','bien','si','no','gracias','adios']);
        const _esUrl = /https?:\/\//i.test(raw);
        const _esFolio = /^[A-Z0-9]{4,}-[A-Z0-9]{2,}/i.test(raw);
        const _esNum  = /^\d+$/.test(action);
        if (raw.length >= 3 && !_SOLO_SALUDO.has(action) && !_esUrl && !_esFolio && !_esNum) {
            const { results: _mr, isFallback: _mf } = searchProducts(raw, 3, tel);
            if (_mr.length) {
                sessionManager.updateSession(userId, S.VIEW_PRODUCT, { carrito: data.carrito || [], products: _mr, source: 'menu_directo' });
                const _rawQ = message._fromImage ? 'la imagen que enviaste' : limpiarQuery(raw);
                const _mh = _mf
                    ? (message._fromImage
                        ? 'Ya la ubic\u00e9 \uD83D\uDCF8 De momento no tenemos ese producto exacto, pero esto puede interesarte:'
                        : 'No encontr\u00e9 exactamente lo que buscas en ' + _rawQ + ', pero esto puede interesarte:')
                    : _mr.length+' resultado'+(+(_mr.length>1)?'s':'')+' para '+_rawQ+':';
                return _mh+'\n\n'+formatProducts(_mr)+'\n\nElige un número para ver detalle, o escribe *hola* para ver el menú.';
            }
            return 'No encontré "'+limpiarQuery(raw)+'" en el catálogo.\n\n'+menuPrincipal(tel);
        }
        return menuPrincipal(tel);
    }

    // ── SEARCHING ───────────────────────────────────────
    if (step === S.SEARCHING) {
        if (raw.length < 2) return `Por favor escribe el nombre o descripción del juguete.`;

        // Detectar si el mensaje es un link — extraer nombre limpio
        const _urlMatch = raw.match(/https?:\/\/[^\s]+/i);
        if (_urlMatch) {
            const _url  = _urlMatch[0];
            const _domain = (() => { try { return new URL(_url).hostname.replace(/^www\./, ''); } catch(_){return '';} })();
            // Extraer nombre del producto desde el path de la URL
            // Ej: /products/fi-car → "fi car"
            const _pathClean = (() => {
                try {
                    const p = new URL(_url).pathname;
                    // Tomar el último segmento significativo
                    const parts = p.split('/').filter(s => s && s !== 'products' && s !== 'p' && s !== 'item');
                    const last  = parts[parts.length - 1] || '';
                    // Quitar parámetros, IDs numéricos largos, slugify inverso
                    return last.replace(/[_-]/g, ' ').replace(/[0-9]{5,}/g, '').replace(/\?.*$/, '').trim();
                } catch(_) { return ''; }
            })();
            if (_pathClean.length >= 2) {
                log.info('Link extraído', { query: _pathClean, dominio: _domain });
                const { results: lr, isFallback: lf } = searchProducts(_pathClean, 3, tel);
                if (lr.length) {
                    sessionManager.updateSession(userId, S.VIEW_PRODUCT, { ...data, products: lr, source: 'link' });
                    return `🔗 Vi el link de *${_domain}* — encontré esto en nuestro catálogo:\n\n${formatProducts(lr)}\n\nElige un número para ver detalle.`;
                }
            }
            // Link no dio resultados → pedir descripción
            return `🔗 No encontré ese producto por el link. ¿Puedes describirlo con palabras? Ej: _"carro de control remoto azul"_`;
        }

        // ── Detector de intención de búsqueda ─────────────────────────────
        // Si el mensaje empieza con verbos/frases de intención, extraer solo
        // el sustantivo del producto y descartar el resto antes de buscar.
        // Si después de extraer el producto no hay palabras reales → stock inteligente directo.
        const _INTENT_REGEX = new RegExp('^(?:^(?:quiero|queria|queriamos|quisiera|quisieramos|quisieras|querria|querriamos|quisiste|quise|kiero|keria|qiero|qisiera|qero|qeria|gustaria|gustara|me\s+gustaria|me\s+gustara|me\s+agradaria|me\s+late|me\s+pinta|tengo\s+ganas\s+de|traigo\s+ganas\s+de|le\s+traigo\s+ganas|ando\s+queriendo|busco|busca|buscas|buscaba|buscabas|buscamos|buscar|buscaria|ando\s+buscando|andabamos\s+buscando|vengo\s+buscando|vengo\s+a\s+ver|venia\s+por|venimos\s+por|vengo\s+por|vengo\s+a\s+preguntar\s+por|ando\s+viendo|ando\s+cotizando|vengo\s+a\s+cotizar|ando\s+sobre|ando\s+cazando|ando\s+correteando|le\s+ando\s+echando\s+el\s+ojo|tienes|tiene|tienen|tenias|tenas|tines|tnes|tendras|tendra|tendran|tendrian|por\s+ahi\s+tendras|vendes|vende|venden|venderias|venderas|vendera|venderan|vends|consigues|consigue|consigo|conseguimos|surten|surtes|surte|surtiras|sacan|sacas|saca|sacaras|manejas|maneja|manejan|manejaran|necesito|necesita|necesitas|necesitamos|necesitaba|necesitabamos|necesitaria|ando\s+necesitando|nesesito|nesecito|necito|ocupo|ocupa|ocupas|ocupamos|ocupaba|ocuparia|ando\s+ocupando|okupo|requiero|requiere|requieres|requerimos|requeriria|rekiere|urge|nos\s+urge|me\s+falta|nos\s+hace\s+falta|me\s+hace\s+falta|me\s+es\s+necesario|ando\s+corto\s+de|le\s+falta\s+a|hay|habia|habra|habria|no\s+hay|me\s+interesa|me\s+interesaria|me\s+interesa\s+comprar|me\s+quieres\s+vender|me\s+quisieras\s+vender|andamos\s+tras|ando\s+tras|venimos\s+por|donde\s+tienes|donde\s+dejas|donde\s+hay|donde\s+encuentro|donde\s+consigo|dónde\s+tienes|dónde\s+dejas|dónde\s+hay|dónde\s+encuentro|dónde\s+consigo|dame|me\s+das|me\s+mandas|me\s+traes)\s*)', 'i');
        const _intentMatch = message._fromIntent ? null : raw.match(_INTENT_REGEX);
        const _queryLimpio = ((_intentMatch
            ? raw.slice(_intentMatch[0].length).trim()
            : raw)
            // Limpiar símbolos — no mostrar "zapatos?" al cliente
            .replace(/[¿?¡!.,;:"'()@#$%^&*+=<>{}[\]|~`]/g, ' ')
            .replace(/\s+/g, ' ').trim());

        // Si después de quitar el verbo queda algo con palabras válidas → buscar eso
        // Si no → activar stock inteligente directamente con el query original
        const _wordsLimpias = _queryLimpio.toLowerCase().split(/\s+/)
            .filter(w => w.length > 2 && !_STOPWORDS.has(w));

        if (_wordsLimpias.length === 0) {
            const _enEsp2 = db.prepare("SELECT COUNT(*) AS n FROM lista_espera WHERE notas LIKE ? AND estatus='activa'").get('%'+raw.slice(0,30)+'%')?.n || 0;
            sessionManager.updateSession(userId, S.LISTA_ESPERA, { ...data, _queryOriginal: raw, idProducto: null, _sinResultado: true });
            const _lineas = ['\uD83D\uDD0D D\u00e9jame buscarlo en toda nuestra tienda...','','¡Este juguete está volando! pero estamos por recibir más. ¿Te gustaría recibir un aviso exclusivo por WhatsApp en cuanto nos llegue?','','1\uFE0F\u20E3  \uD83D\uDD14 Av\u00edsame cuando llegue','2\uFE0F\u20E3  \uD83D\uDD0D Ver alternativas ahora','3\uFE0F\u20E3  \uD83C\uDFE0 Volver al men\u00fa'];
            if (_enEsp2 > 0) _lineas.push('','_'+_enEsp2+' persona'+(_enEsp2>1?'s':'')+' tambi\u00e9n esperando._');
            return _lineas.join('\n');
        }

        // Buscar con el query limpio (sin el verbo de intención)
        const { results, isFallback } = searchProducts(_intentMatch ? _queryLimpio : raw, 3, tel);

        // ── Resultados con match real → mostrar directamente ──────────────
        const _fromImg  = message._fromImage  || false;
        const _fromLink = message._fromLink   || false;
        // score>=13: 1 palabra en nombre(10) + boost stock alto(3), o 2 palabras en seo(10)
const hayMatchReal = !isFallback && results.some(p => p.score >= 13);

        if (hayMatchReal || _fromImg || _fromLink) {
            sessionManager.updateSession(userId, S.VIEW_PRODUCT, { ...data, products: results, source: 'search', _queryOriginal: raw });
            const header = _fromImg
                ? `📸 Encontré esto en el catálogo para esa imagen:`
                : _fromLink
                    ? `🔗 Encontré ${results.length} coincidencia${results.length>1?'s':''} en el catálogo:`
                    : `✅ ${results.length} resultado${results.length>1?'s':''} para *"${raw}"*:`;
            return `${header}\n\n${formatProducts(results)}\n\nElige un número para ver imagen y detalle.`;
        }

        // ── Sin match real → flujo stock inteligente ──────────────────────
        // Informar al cliente que estamos verificando (simula los 5 segundos de búsqueda)
        sessionManager.updateSession(userId, S.LISTA_ESPERA, {
            ...data,
            _queryOriginal: raw,
            idProducto: null,   // sin producto específico — lista espera por búsqueda
            _sinResultado: true,
        });

        // Buscar sustitutos por texto libre — misma categoría que los fallback results
        const _sustQuery = results.length > 0
            ? stockService.buscarSustitutosAuto(results[0].id, 0.50, 3)
            : [];
        const _haySust = _sustQuery.length > 0;

        // Contar personas en espera para este término (buscar en lista_espera por notas)
        const _enEspera = db.prepare(
            "SELECT COUNT(*) AS n FROM lista_espera WHERE notas LIKE ? AND estatus='activa'"
        ).get(`%${raw.slice(0,30)}%`)?.n || 0;

        const _espMsg = _enEspera > 0 ? '\n\n_' + _enEspera + ' persona' + (_enEspera > 1 ? 's' : '') + ' también esperando._' : '';
        // Gate: si lista_espera está desactivada, ofrecer solo alternativas
        if (!moduloActivo('lista_espera_activo')) {
            sessionManager.updateSession(userId, S.WIZARD_Q1, { carrito: data.carrito || [], _desdeListaEspera: true });
            return 'No encontré ese producto disponible ahora, pero te ayudo a encontrar algo igual de bueno. 🎯\n\n' +
                (t('wizard_q1') || '*¿Para quién es el juguete?*\n\n1️⃣  👶 Bebé (0–2)\n2️⃣  🧒 Niño/a (3–8)\n3️⃣  🧑 Preadolescente (9–12)\n4️⃣  🎓 Adolescente / Adulto');
        }
        return (t('lista_espera_oferta') ||
            ('\uD83D\uDD0D Déjame buscarlo en toda nuestra tienda...\n\n' +
            '¡Este juguete está volando pero muy pronto tendremos más piezas! Déjanos avisarte por WhatsApp en cuanto aterrice en la tienda:\n\n' +
            '1\uFE0F\u20E3  \uD83D\uDD14 Avísame cuando llegue\n' +
            '2\uFE0F\u20E3  \uD83D\uDD0D ¡Cero estrés! Te ayudo a encontrar algo mejor hoy mismo\n' +
            '3\uFE0F\u20E3  \uD83C\uDFE0 Volver al menú principal')) +
            _espMsg;
    }

    // ── WIZARD ──────────────────────────────────────────
    if (step === S.WIZARD_Q1) {
        const m = {'1':'bebe','2':'nino','3':'pre','4':'adulto'};
        if (!m[action]) return `Responde con 1, 2, 3 o 4.`;
        const edad = m[action];
        if (edad === 'bebe') {
            sessionManager.updateSession(userId, S.WIZARD_Q2, { ...data, edad, genero:'bebe' });
            return `*Pregunta 2 de 3* — ¿Qué tipo de juguete? 🧠\n\n1️⃣  🎮 Entretenimiento / Diversión\n2️⃣  📚 Educativo / Aprendizaje\n3️⃣  🎨 Creativo / Manualidades\n4️⃣  🏆 Coleccionable / Especial`;
        }
        if (edad === 'adulto') {
            sessionManager.updateSession(userId, S.WIZARD_Q2, { ...data, edad, genero:'adulto' });
            return `*Pregunta 2 de 3* — ¿Qué tipo de juguete? 🧠\n\n1️⃣  🎮 Entretenimiento / Diversión\n2️⃣  📚 Educativo / Aprendizaje\n3️⃣  🎨 Creativo / Manualidades\n4️⃣  🏆 Coleccionable / Especial`;
        }
        sessionManager.updateSession(userId, S.WIZARD_Q2, { ...data, edad });
        return `*Pregunta 2 de 3* — ¿Es para niño o niña? 🎀\n\n1️⃣  👦 Niño\n2️⃣  👧 Niña\n3️⃣  🤝 Sin preferencia`;
    }
    if (step === S.WIZARD_Q2) {
        if (data.genero) {
            const m = {'1':'diversion','2':'educativo','3':'creativo','4':'coleccionable'};
            if (!m[action]) return `Responde con 1, 2, 3 o 4.`;
            sessionManager.updateSession(userId, S.WIZARD_Q3, { ...data, tipo:m[action] });
            return `*Pregunta 3 de 3* — ¿Cuánto quieres gastar? 💰\n\n1️⃣  💵 Hasta $250\n2️⃣  💴 $250 – $500\n3️⃣  💶 $500 – $800\n4️⃣  💎 Sin límite`;
        }
        const mg = {'1':'nino','2':'nina','3':'unisex'};
        if (!mg[action]) return `Responde con 1, 2 o 3.`;
        sessionManager.updateSession(userId, S.WIZARD_Q3, { ...data, genero:mg[action] });
        return `*Pregunta 3 de 3* — ¿Qué tipo de juguete? 🧠\n\n1️⃣  🎮 Entretenimiento / Diversión\n2️⃣  📚 Educativo / Aprendizaje\n3️⃣  🎨 Creativo / Manualidades\n4️⃣  🏆 Coleccionable / Especial`;
    }
    if (step === S.WIZARD_Q3) {
        if (data.genero && !data.tipo) {
            const mt = {'1':'diversion','2':'educativo','3':'creativo','4':'coleccionable'};
            if (!mt[action]) return `Responde con 1, 2, 3 o 4.`;
            sessionManager.updateSession(userId, S.WIZARD_Q3, { ...data, tipo:mt[action], _subpaso:'presupuesto' });
            return `*Última pregunta* — ¿Cuánto quieres gastar? 💰\n\n1️⃣  💵 Hasta $250\n2️⃣  💴 $250 – $500\n3️⃣  💶 $500 – $800\n4️⃣  💎 Sin límite`;
        }
        const mp = {'1':'bajo','2':'medio','3':'alto','4':'premium'};
        if (!mp[action]) return `Responde con 1, 2, 3 o 4.`;
        const presupuesto = mp[action];
        // Persistir preferencias del wizard en clientes — perfil demográfico para ML/segmentación
        try {
            upsertCliente(tel);
            db.prepare(`UPDATE clientes SET edad_pref=?, genero_pref=?, tipo_pref=?, presupuesto_pref=? WHERE telefono=?`)
              .run(data.edad || null, data.genero || null, data.tipo || null, presupuesto, tel);
        } catch(e) { log.debug('No se pudo guardar preferencias del wizard: ' + e.message); }
        const results = wizardSearch({ ...data, presupuesto });
        if (!results.length) {
            sessionManager.updateSession(userId, S.ASESOR, { modo:'sin_resultados' });
            registrarEscalada(userId, null, 'Sin resultados en wizard', tel);
            return `😔 No encontré algo exacto para esas preferencias.\n\nUn asesor te ayuda. 👤\n🟢 _Conectando..._`;
        }
        sessionManager.updateSession(userId, S.VIEW_PRODUCT, { ...data, products:results, source:'wizard' });
        return `✨ ¡Encontré ${results.length} opción${results.length>1?'es':''} para ti! 🎉\n\n${formatProducts(results)}\n\nElige un número para *ver imagen y detalle*.`;
    }

    // ── VIEW_PRODUCT ─────────────────────────────────────
    if (step === S.VIEW_PRODUCT) {
        const products = data.products || [];
        const carrito  = data.carrito  || [];

        // Sin producto seleccionado aún — el cliente elige un número de la lista
        if (!data.viewing) {
            const idx = parseInt(action, 10) - 1;

            // Si escribió texto libre (no un número) → nueva búsqueda directa
            if (isNaN(idx) && raw.length >= 2 && !['hola','menu','menú','inicio','0','salir'].includes(action)) {
                const { results: _nr, isFallback: _nf } = searchProducts(raw, 3, tel);
                const _hayMatch = !_nf && _nr.some(p => p.score >= 13);
                if (_hayMatch) {
                    sessionManager.updateSession(userId, S.VIEW_PRODUCT, { ...data, products: _nr, source: 'search', viewing: undefined, _queryOriginal: raw });
                    const _labelBusq = message._fromImage ? 'la imagen que enviaste' : limpiarQuery(raw);
                    const _footerBusq = message._fromImage
                        ? '\n\nElige un n\u00famero para ver detalle, o escr\u00edbeme el *nombre exacto* del producto si no es ninguno de estos.'
                        : '\n\nElige un n\u00famero para ver imagen y detalle.';
                    return '\u2705 ' + _nr.length + ' resultado' + (_nr.length>1?'s':'') + ' para *' + _labelBusq + '*:\n\n' + formatProducts(_nr) + _footerBusq;
                }
                // Sin match real → flujo stock inteligente
                const _enEspera = db.prepare("SELECT COUNT(*) AS n FROM lista_espera WHERE notas LIKE ? AND estatus='activa'").get('%'+raw.slice(0,30)+'%')?.n || 0;
                const _sust = stockService.buscarSustitutosAuto(_nr.length ? _nr[0].id : 0, 0.50, 3).filter(p => p.stock_tienda > 0 || p.stock_cedis > 0);
                sessionManager.updateSession(userId, S.LISTA_ESPERA, { ...data, _queryOriginal: raw, idProducto: null, _sinResultado: true, viewing: undefined });

                // Si viene de imagen → mensaje especial sin repetir el query técnico
                if (message._fromImage) {
                    return (
                        '\uD83D\uDCF8 \u00a1Ya lo ubliqu\u00e9! pero en este momento est\u00e1 volando \uD83D\uDE80\n\n' +
                        '\u00bfQu\u00e9 quieres hacer?\n\n' +
                        '1\uFE0F\u20E3  \uD83D\uDD14 Av\u00edsame cuando llegue\n' +
                        '2\uFE0F\u20E3  \uD83E\uDDF9 Encontrarme algo similar disponible ahora\n' +
                        '3\uFE0F\u20E3  \uD83C\uDFE0 Volver al men\u00fa principal' +
                        (_enEspera > 0 ? '\n\n_' + _enEspera + ' persona' + (_enEspera>1?'s':'') + ' tambi\u00e9n espera este producto._' : '')
                    );
                }

                return (
                    '\uD83D\uDD0D D\u00e9jame buscarlo en toda nuestra tienda...\n\n' +
                    '\u00a1Este juguete est\u00e1 volando! pero estamos por recibir m\u00e1s. \u00bfTe gustar\u00eda recibir un aviso exclusivo por WhatsApp en cuanto nos llegue?\n\n' +
                    '1\uFE0F\u20E3  \uD83D\uDD14 Av\u00edsame cuando llegue\n' +
                    (_sust.length ? '2\uFE0F\u20E3  \uD83D\uDD0D Ver opciones disponibles\n' : '') +
                    '3\uFE0F\u20E3  \uD83C\uDFE0 Volver al men\u00fa principal' +
                    (_enEspera > 0 ? '\n\n_' + _enEspera + ' persona' + (_enEspera>1?'s':'') + ' tambi\u00e9n esperando._' : '')
                );
            }

            if (isNaN(idx) || idx < 0 || idx >= products.length)
                return `Responde con el número del producto (${products.map((_,i)=>i+1).join(', ')}), o escribe *hola* para volver.`;

            const prod = products[idx];
            sessionManager.updateSession(userId, S.VIEW_PRODUCT, { ...data, viewing:prod });
            // Evento "producto_visto" — funnel búsqueda→vista→carrito para ML/analítica
            try {
                db.prepare(`INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('producto_visto','whatsapp',?,?)`)
                  .run(`${prod.id}:${prod.name}`, tel);
            } catch(e) { log.debug('No se pudo registrar evento producto_visto: ' + e.message); }

            const desc    = prod.seo_description || prod.description || '';
            const infoCarr = carrito.length > 0
                ? `\n🛒 _${carrito.length} en carrito · $${totalCarrito(carrito).toFixed(2)} MXN_`
                : '';

            if (prod.url_imagen && client) {
                try {
                    const MessageMedia = _MessageMedia; // cacheado al inicio
                    // Caption lleva nombre + precio — el texto de abajo ya no los repite
                    const caption =
                        `🧸 *${prod.name}*\n` +
                        `📦 ${prod.cat}  ·  💰 *$${Number(prod.price).toFixed(2)} MXN*\n\n` +
                        (desc ? `📝 ${desc}` : '');
                    const media = await MessageMedia.fromUrl(prod.url_imagen, { unsafeMime:true });
                    await client.sendMessage(userId, media, { caption });
                } catch(e) { log.warn('Imagen no disponible', e); }
            }

            // Texto: solo opciones (nombre ya va en el caption de la imagen)
            const hasImg = !!prod.url_imagen;

            // Productos relacionados — upselling en la ficha
            let _relacionadosMsg = '';
            try {
                const _rel = stockService.buscarSustitutos(prod.id, 2)
                    .filter(r => r.id !== prod.id && (r.stock_tienda > 0 || r.stock_cedis > 0));
                if (_rel.length) {
                    _relacionadosMsg = '\n\n💡 *También te puede interesar:*\n' +
                        _rel.map(r => '· *' + r.name + '* — $' + Number(r.price).toFixed(2) + ' MXN').join('\n');
                }
            } catch(e) { log.debug('No se pudo cargar productos relacionados: ' + e.message); }

            return (
                (!hasImg
                    ? `🧸 *${prod.name}*\n📦 ${prod.cat}  ·  💰 *$${Number(prod.price).toFixed(2)} MXN*\n\n` +
                      (desc ? `📝 ${desc}\n` : '')
                    : '') +
                infoCarr + (infoCarr ? '\n\n' : '') +
                `1️⃣  🛒 Agregar y seguir buscando\n` +
                `2️⃣  ✅ Agregar y pagar\n` +
                `3️⃣  🔙 Ver otros\n` +
                `4️⃣  🔍 Buscar otro` +
                (carrito.length > 0 ? `\n5️⃣  👁 Ver carrito` : '') +
                _relacionadosMsg
            );
        }

        // Ya hay un producto en pantalla — procesar acción
        const prod   = data.viewing;
        const carrito2 = data.carrito || [];

        // Opciones 1 y 2 — agregar al carrito
        if (['1','2'].includes(action) || action.includes('agregar') || action.includes('carrito')) {
            const result = agregarAlCarrito(carrito2, prod);

            if (result.escalar) {
                // Límite de 2 unidades del mismo producto → escalar a asesor
                registrarEscalada(userId, null,
                    `Pedido mayorista: "${prod.name}" — cliente quiere más de ${MAX_MISMO_PROD} unidades`,
                    tel
                );
                sessionManager.updateSession(userId, S.ASESOR, { ...data, modo:'mayorista', carrito:carrito2 });
                return (
                    `Veo que ya tienes *${result.cantidadActual}* unidades de *${prod.name}* en tu carrito 🧸\n\n` +
                    `Para pedidos de 3 o más unidades del mismo producto, un asesor puede darte una atención especial y verificar disponibilidad.\n\n` +
                    `🟢 _Conectando con el equipo de ventas..._\n` +
                    `⏰ Horario: *${HORARIO_ASESOR}*`
                );
            }

            const nuevoCarrito = result.carrito;
            const totalAct     = result.total;

            if (action === '1' || action.includes('seguir') || action.includes('buscar')) {
                // Agregar y seguir buscando
                sessionManager.updateSession(userId, S.SEARCHING, {
                    ...data, carrito: nuevoCarrito, products: undefined, viewing: undefined
                });

                const _upsellMsg = buscarUpsellMsg(prod, totalAct);

                return (
                    '✅ *' + prod.name + '* agregado al carrito 🛒\n\n' +
                    '🛒 Carrito: *' + nuevoCarrito.length + ' producto' + (nuevoCarrito.length > 1 ? 's distintos' : '') + '* — Total: *$' + totalAct.toFixed(2) + ' MXN*' +
                    _upsellMsg +
                    '\n\n¿Qué otro juguete buscas?'
                );
            } else {
                // Agregar y proceder al pago
                sessionManager.updateSession(userId, S.ASK_CP, {
                    ...data, carrito: nuevoCarrito, viewing: undefined
                });
                const _upsellMsgPagar = buscarUpsellMsg(prod, totalAct);
                const _msgAgr = t('agregado_pagar', { producto: prod.name });
                return (_msgAgr
                    ? _msgAgr.replace('{producto}', prod.name) + '\n\n' + formatCarrito(nuevoCarrito) + _upsellMsgPagar
                    : `✅ *${prod.name}* agregado al carrito 🛒\n\n` +
                      `${formatCarrito(nuevoCarrito)}` + _upsellMsgPagar + `\n\n` +
                      `📮 Dime tu *código postal* para revisar disponibilidad y proceder al pago:`
                );
            }
        }

        if (action === '3') {
            sessionManager.updateSession(userId, S.VIEW_PRODUCT, { ...data, viewing:null });
            return `${formatProducts(products)}\n\nElige un número para ver el producto.`;
        }
        if (action === '4') {
            sessionManager.updateSession(userId, S.SEARCHING, { ...data, viewing:undefined });
            return `🔍 ¿Qué juguete buscas?`;
        }
        if (action === '5' && carrito2.length > 0) {
            sessionManager.updateSession(userId, S.SHOW_CART, { ...data, viewing:undefined, _returnStep: S.VIEW_PRODUCT });
            return mostrarCarrito(carrito2);
        }

        return `Responde con 1, 2, 3${carrito2.length>0?', 4 o 5':' o 4'}.`;
    }

    // ── SHOW_CART ────────────────────────────────────────

    if (step === S.ADD_MORE) {
        if (action === '1' || action.includes('agregar') || action.includes('otro')) {
            sessionManager.updateSession(userId, S.SEARCHING, { carrito: data.carrito || [] });
            return `🔍 ¿Qué otro juguete buscas?`;
        }
        if (action === '2' || action.includes('final') || action.includes('listo') || action.includes('no')) {
            const ped = data.ultimoPedido || {};
            sessionManager.clearSession(userId);
            return (t('gracias_cierre', { folio: ped.folio || 'N/A' }) ||
                `🎉 *¡Gracias por tu compra en Julio Cepeda Jugueterías!*\n\n` +
                `📋 Folio: *${ped.folio || 'N/A'}*\n\n` +
                `Te avisamos por aquí cuando confirmemos tu pago. 📲\n\n` +
                `¡Hasta pronto! 🧸`
            );
        }
        return `Responde con 1 _(agregar otro)_ o 2 _(finalizar)_.`;
    }

    // ── ASESOR ────────────────────────────────────────────
    return undefined; // estado no manejado por este flow
}

module.exports = { handle, STEPS };
