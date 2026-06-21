// ── Flows y logger ─────────────────────────────────────────────
let _MessageMedia = null;
try { _MessageMedia = require('whatsapp-web.js').MessageMedia; } catch(_) {}

const puntosHandler  = (() => { try { return require('../handlers/puntosHandler'); } catch(_) { return null; } })();
const mensajeService = (() => { try { return require('../../services/mensajeService'); } catch(_) { return { marcarOutcome: () => {} }; } })();
const log            = (() => { try { return require('../logger')('handler');    } catch(_) { return { info:console.log, warn:console.warn, error:console.error, debug:()=>{} }; } })();

const sessionManager  = require('../sessionManager');
const estafeta        = require('../../services/estafetaService');
const emailSvc        = require('../../services/emailService');
const db              = require('../db_connection');
const stockService    = require('../../services/stockService');
// Sistema de tonos (A/B/C/D) y módulos activables desde el dashboard
const { t, moduloActivo } = (() => {
    try { return require('./_config'); }
    catch(_) { return { t: () => '', moduloActivo: () => true }; }
})();

// ═══════════════════════════════════════════════════════
//  PASOS
// ═══════════════════════════════════════════════════════
const S = {
    MENU:           'MENU',
    SEARCHING:      'SEARCHING',
    VIEW_PRODUCT:   'VIEW_PRODUCT',
    SHOW_CART:      'SHOW_CART',
    WIZARD_Q1:      'WIZARD_Q1',
    WIZARD_Q2:      'WIZARD_Q2',
    WIZARD_Q3:      'WIZARD_Q3',
    ASK_CP:         'ASK_CP',
    SPLIT_DELIVERY: 'SPLIT_DELIVERY',     // ← carrito mixto: elegir cómo dividir
    DELIVERY:       'DELIVERY',
    PICKUP_CONFIRM: 'PICKUP_CONFIRM',
    SPLIT_CONFIRM:  'SPLIT_CONFIRM',      // ← confirmar los dos pedidos separados
    CONFIRM_DIR_GUARDADA: 'CONFIRM_DIR_GUARDADA', // ← ofrecer reusar última dirección guardada
    ASK_NOMBRE:     'ASK_NOMBRE',
    ASK_CALLE:      'ASK_CALLE',
    ASK_COLONIA:    'ASK_COLONIA',
    ASK_CIUDAD:     'ASK_CIUDAD',
    ASK_REF:        'ASK_REF',
    CONFIRM_ORDER:  'CONFIRM_ORDER',
    ADD_MORE:        'ADD_MORE',
    ASESOR:          'ASESOR',
    LISTA_ESPERA:    'LISTA_ESPERA',
    CSAT:            'CSAT',
    DEVOLUCION:      'DEVOLUCION',
    OFERTAS:         'OFERTAS',
    CUPON:           'CUPON',
};

// ═══════════════════════════════════════════════════════
//  CONSTANTES
// ═══════════════════════════════════════════════════════
function enHorario() {
    const h = (new Date().getUTCHours() - 6 + 24) % 24;
    return h >= 11 && h < 20;
}
const HORARIO          = '11:00 am – 8:00 pm';
const HORARIO_ASESOR   = '11:00 am – 8:00 pm, todos los días';

function enHorario() {
    const h = new Date().getHours();
    return h >= 11 && h < 20;
}
function msgHorarioAsesor() {
    if (enHorario()) return 'Un asesor te contactará en los próximos *30 minutos*. ¡Gracias! 🧸';
    return 'Estamos fuera de horario. 🌙\n⏰ Nuestro horario es *' + HORARIO_ASESOR + '*.\nHemos registrado tu solicitud y te contactaremos al inicio del siguiente horario.';
}
const _RE_DEVOLUCION = /devolver|devolv|devoluci[oó]n|devuelta|cambiar.*producto|cambio.*producto|quiero.*devolver|quiero.*cambiar|repetido|duplicado|ya.*tenía|me.*llegó.*mal|llegó.*incorrecto|no.*funciona|está.*roto|está.*dañado|garantia|garantía|me.*equivoqué|pedido.*mal|llegó.*dañado|producto.*dañado|dañado/i;
const UMBRAL_ENVIO_GRA = 699;
const COSTO_ENVIO_STD  = 99;
const MAX_MISMO_PROD   = 2;   // máximo unidades del mismo producto sin escalar a asesor

function calcularFlete(precioTotal, costoEnvFijo = null) {
    if (costoEnvFijo !== null) return costoEnvFijo;
    return precioTotal >= UMBRAL_ENVIO_GRA ? 0 : COSTO_ENVIO_STD;
}

// ═══════════════════════════════════════════════════════
//  FOLIO
// ═══════════════════════════════════════════════════════
function generarFolio(tipo = 'pedido') {
    const row = db.prepare('SELECT prefijo, ultimo_folio, longitud FROM series_folios WHERE tipo = ?').get(tipo);
    if (!row) return `${tipo.toUpperCase()}-${Date.now()}`;
    const n = row.ultimo_folio + 1;
    db.prepare('UPDATE series_folios SET ultimo_folio = ? WHERE tipo = ?').run(n, tipo);
    return `${row.prefijo}${String(n).padStart(row.longitud, '0')}`;
}

// ═══════════════════════════════════════════════════════
//  BÚSQUEDA — jerarquía: nombre > seo_description > tags
//  + boost por inventario disponible
//  + fallback de sugerencias cuando hay poco match
// ═══════════════════════════════════════════════════════

// Stock total normalizado para boost (0-3 puntos)
function boostStock(p) {
    const total = (p.stock_tienda||0) + (p.stock_cedis||0) + (p.stock_exhibicion||0);
    if (total >= 20) return 3;
    if (total >= 5)  return 2;
    if (total >= 1)  return 1;
    return 0;
}

/**
 * searchProducts — búsqueda principal con jerarquía + boost inventario.
 * Retorna { results, isFallback }
 *   isFallback=true  → pocos matches, se complementa con sugerencias por inventario
 *   isFallback=false → resultados directos con score suficiente
 */
// Palabras vacías en español — no aportan nada a la búsqueda de productos
const _STOPWORDS = new Set([
    'las','los','una','uno','unos','unas','para','por','con','sin',
    'que','del','los','les','sus','hay','tiene','tienes','tendras',
    'quiero','quieres','busco','busca','buscas','dame','dame','dar',
    'quiero','necesito','necesita','quisiera','me','te','le','nos',
    'voy','vamos','ver','veo','esta','este','estos','estas','ese',
    'eso','esos','esas','ahi','alla','aqui','hay','tener','tenia',
    'donde','como','cual','cuales','cuanto','cuando','algo','algun',
]);

function limpiarQuery(q) {
    return (q || '')
        .replace(/[!¡¿?"'"`.,;:()\[\]{}\/*|@#$%^&+=~<>\\]/g, ' ')  // quitar símbolos
        .replace(/\s+/g, ' ')                                              // espacios múltiples
        .trim();
}

function searchProducts(query, limit = 3, telefono = null) {
    const queryLimpio = limpiarQuery(query);
    const words = queryLimpio.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !_STOPWORDS.has(w));
    if (!words.length) return { results: [], isFallback: false };

    const all = db.prepare(
        `SELECT id,name,cat,price,url_imagen,tags,seo_description,
                edad_recomendada,target_audience,genero,
                stock_tienda,stock_cedis,stock_exhibicion,ventas_simuladas
         FROM productos WHERE activo=1`
    ).all();

    const scored = all.map(p => {
        let score = 0;
        const nombre  = (p.name || '').toLowerCase();
        const seoDesc = (p.seo_description || '').toLowerCase();
        const tags    = (p.tags || '').toLowerCase();
        const cat     = (p.cat || '').toLowerCase();
        words.forEach(w => {
            if (nombre.includes(w))  score += 10;
            if (seoDesc.includes(w)) score += 5;
            if (tags.includes(w))    score += 3;
            if (cat.includes(w))     score += 2;
        });
        // Boost por inventario: favorece lo que SÍ tenemos en stock
        if (score > 0) score += boostStock(p);
        return { ...p, score };
    });

    const matches = scored.filter(p => p.score > 0).sort((a,b) => b.score - a.score);

    // Umbral de "buen match": al menos 1 resultado con score >= 10 (match en nombre)
    const hayBuenMatch = matches.some(p => p.score >= 10);

    let resultado;
    if (hayBuenMatch || matches.length >= limit) {
        // Resultados directos — sin fallback
        resultado = { results: matches.slice(0, limit), isFallback: false };
    } else {
        // ── Fallback: pocos o malos matches ────────────────────────────────
        // 1. Combinar los matches débiles que hay
        // 2. Rellenar con los de mayor stock que NO estén ya incluidos
        const incluidos = new Set(matches.map(p => p.id));
        const sugeridos = scored
            .filter(p => p.score === 0 && boostStock(p) > 0)  // con stock pero sin match
            .sort((a,b) => boostStock(b) - boostStock(a) || b.price - a.price)
            .filter(p => !incluidos.has(p.id));

        const combinados = [...matches, ...sugeridos].slice(0, limit);
        resultado = { results: combinados, isFallback: matches.length === 0 };
    }

    // Registrar la búsqueda en log_eventos — incluye teléfono y conteo de
    // resultados reales (matches.length, no el total con sugeridos de relleno)
    // para poder medir tasa de búsquedas sin match real desde el dashboard/ML.
    try {
        db.prepare(`INSERT INTO log_eventos (tipo_evento, canal, valor, telefono, resultados) VALUES ('busqueda', 'whatsapp', ?, ?, ?)`)
          .run(queryLimpio.slice(0, 200), telefono, matches.length);
    } catch(e) { log.debug('No se pudo registrar evento busqueda: ' + e.message); }

    return resultado;
}

function wizardSearch(answers) {
    const priceMap = { bajo:[0,250], medio:[250,500], alto:[500,800], premium:[0,999999] };
    const [minP, maxP] = priceMap[answers.presupuesto] || [0,999999];

    // Rangos de edad por opción del wizard
    const edadRanges = {
        bebe:   [0, 3],
        nino:   [3, 8],    // niño/niña 3-8
        pre:    [9, 12],   // preadolescente
        adulto: [13, 99],
    };
    const [eMin, eMax] = edadRanges[answers.edad] || [0, 99];

    // Géneros aceptados según respuesta
    const generoMap = {
        nino:   ['nino', 'unisex'],
        nina:   ['nina', 'unisex'],
        unisex: ['nino', 'nina', 'unisex'],
        bebe:   ['unisex', 'nino', 'nina'],
        adulto: ['unisex', 'nino', 'nina'],
    };
    const generosOk = generoMap[answers.genero || answers.edad] || ['nino','nina','unisex'];

    // Tipos de juguete por opción del wizard
    const tipoMap = {
        diversion:     ['diversion', 'peluche'],
        educativo:     ['educativo'],
        creativo:      ['creativo', 'diversion'],
        coleccionable: ['coleccionable', 'diversion'],
    };
    const tiposOk = tipoMap[answers.tipo] || ['diversion','educativo','creativo','coleccionable','peluche'];

    // Verificar si las columnas normalizadas existen
    const tieneNormalizados = (() => {
        try { db.prepare('SELECT edad_min FROM productos LIMIT 1').get(); return true; }
        catch(_) { return false; }
    })();

    if (tieneNormalizados) {
        // Usar columnas normalizadas — búsqueda exacta y eficiente
        const genPlaceholders = generosOk.map(() => '?').join(',');
        const tipoPlaceholders = tiposOk.map(() => '?').join(',');
        const params = [minP, maxP, eMax, eMin, ...generosOk, ...tiposOk];
        const results = db.prepare(`
            SELECT id, name, cat, price, url_imagen, tags, seo_description,
                   edad_recomendada, genero, tipo_juguete,
                   ventas_simuladas
            FROM productos
            WHERE activo = 1
              AND price BETWEEN ? AND ?
              AND edad_min <= ? AND edad_max >= ?
              AND genero IN (${genPlaceholders})
              AND tipo_juguete IN (${tipoPlaceholders})
              AND (stock_tienda > 0 OR stock_cedis > 0)
            ORDER BY ventas_simuladas DESC, price ASC
            LIMIT 5
        `).all(...params);

        // Si no hay resultados exactos, relajar filtro de tipo
        if (!results.length) {
            const fallback = db.prepare(`
                SELECT id, name, cat, price, url_imagen, tags, seo_description,
                       edad_recomendada, genero, tipo_juguete, ventas_simuladas
                FROM productos
                WHERE activo = 1
                  AND price BETWEEN ? AND ?
                  AND edad_min <= ? AND edad_max >= ?
                  AND (stock_tienda > 0 OR stock_cedis > 0)
                ORDER BY ventas_simuladas DESC, price ASC
                LIMIT 3
            `).all(minP, maxP, eMax, eMin);
            return fallback;
        }
        return results;
    }

    // Fallback: búsqueda con regex en campos de texto (comportamiento original)
    const edadPatterns = {
        bebe:   [/^0\s*a\s*[123]/, /bebé|bebe|primera infancia/i],
        nino:   [/^[34]\s*a|^[34]\+|^3 a 8|^4 a 10/i],
        pre:    [/^[56789]|^6 a 12|^6\+/i],
        adulto: [/adulto|coleccionista|18\+/i],
    };
    const typeMap = {
        diversion:    ['Vehículos y Montables','Juguetes Creativos','Figuras de Acción y Coleccionables'],
        educativo:    ['Juegos de Mesa y Aprendizaje','Primera Infancia','Bloques y Construcción'],
        creativo:     ['Juguetes Creativos','Muñecas y Peluches'],
        coleccionable:['Figuras de Acción y Coleccionables'],
    };
    const pats      = edadPatterns[answers.edad] || [];
    const catsFiltro = typeMap[answers.tipo] || [];
    return db.prepare(
        'SELECT id,name,cat,price,url_imagen,tags,seo_description,edad_recomendada,genero FROM productos WHERE activo=1 AND price BETWEEN ? AND ?'
    ).all(minP, maxP)
    .filter(p => {
        const edadOk  = pats.length === 0 || pats.some(pat => pat.test(p.edad_recomendada||''));
        const catOk   = catsFiltro.length === 0 || catsFiltro.includes(p.cat);
        return edadOk && catOk;
    })
    .slice(0, 3);
}

// ═══════════════════════════════════════════════════════
//  COBERTURA
// ═══════════════════════════════════════════════════════
function buscarCobertura(cp) {
    const cpNum = cp.replace(/\D/g, '');
    if (cpNum.length < 2) return null;
    const pre2 = cpNum.substring(0, 2);
    const rows  = db.prepare('SELECT * FROM cobertura WHERE activa=1').all();
    for (const r of rows) {
        if (r.cp && r.cp.startsWith(pre2)) return r;
    }
    return null;
}

// ═══════════════════════════════════════════════════════
//  INVENTARIO
// ═══════════════════════════════════════════════════════
function stockEnSucursal(idProducto, estado) {
    const row = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(idProducto, estado);
    return row ? (row.stock || 0) : 0;
}
function stockGlobal(idProducto) {
    // Fuente de verdad: tabla inventarios (suma nacional por producto).
    // Las columnas productos.stock_* son un cache que puede estar desincronizado.
    const row = db.prepare('SELECT COALESCE(SUM(stock),0) AS total FROM inventarios WHERE id_producto=?').get(idProducto);
    return row ? (row.total || 0) : 0;
}

/**
 * Versión por lotes de stockEnSucursal+stockGlobal — una sola query de cada
 * tipo para N productos en vez de 2N. Retorna Map<idProducto, {local, total}>.
 */
function stockBatch(ids, estado) {
    const map = new Map(ids.map(id => [id, { local: 0, total: 0 }]));
    if (!ids.length) return map;
    const ph = ids.map(() => '?').join(',');
    const totales = db.prepare(
        `SELECT id_producto, COALESCE(SUM(stock),0) AS total FROM inventarios WHERE id_producto IN (${ph}) GROUP BY id_producto`
    ).all(...ids);
    for (const r of totales) map.get(r.id_producto).total = r.total;
    if (estado) {
        const locales = db.prepare(
            `SELECT id_producto, COALESCE(SUM(stock),0) AS local FROM inventarios WHERE id_producto IN (${ph}) AND sucursal=? GROUP BY id_producto`
        ).all(...ids, estado);
        for (const r of locales) map.get(r.id_producto).local = r.local;
    }
    return map;
}

// ═══════════════════════════════════════════════════════
//  CARRITO — helpers
// ═══════════════════════════════════════════════════════

/**
 * Agrega un producto al carrito.
 * Regla: mismo producto máximo MAX_MISMO_PROD veces.
 * Retorna { ok, carrito, total, escalar, cantidadActual }
 */
function agregarAlCarrito(carritoActual, producto) {
    const carrito = carritoActual ? [...carritoActual] : [];
    const idx     = carrito.findIndex(i => i.id === producto.id);
    const cantidadActual = idx >= 0 ? carrito[idx].cantidad : 0;

    if (cantidadActual >= MAX_MISMO_PROD) {
        return { ok: false, escalar: true, cantidadActual, carrito, total: totalCarrito(carrito) };
    }

    if (idx >= 0) {
        carrito[idx] = { ...carrito[idx], cantidad: carrito[idx].cantidad + 1 };
    } else {
        carrito.push({ ...producto, cantidad: 1 });
    }

    return { ok: true, escalar: false, cantidadActual: cantidadActual + 1, carrito, total: totalCarrito(carrito) };
}

function totalCarrito(carrito) {
    return carrito.reduce((sum, i) => sum + i.price * i.cantidad, 0);
}

function aplicarCupon(codigo, carrito, idProducto) {
    if (!codigo) return { ok: false, error: 'Sin código' };
    const hoy = new Date().toISOString().slice(0, 10);
    const promo = db.prepare(`
        SELECT * FROM promociones
        WHERE UPPER(codigo) = UPPER(?)
          AND activa = 1
          AND (fecha_inicio IS NULL OR fecha_inicio <= ?)
          AND (fecha_fin IS NULL OR fecha_fin >= ?)
          AND (usos_max = 0 OR usos_actual < usos_max)
        LIMIT 1
    `).get(codigo.trim(), hoy, hoy);

    if (!promo) return { ok: false, error: 'Código no válido o expirado' };

    // Si el cupón es de producto específico, verificar que esté en el carrito
    if (promo.id_producto) {
        const tieneProducto = carrito.some(i => i.id === promo.id_producto);
        if (!tieneProducto) {
            const prod = db.prepare('SELECT name FROM productos WHERE id=?').get(promo.id_producto);
            return { ok: false, error: 'Este cupón aplica solo para *' + (prod?.name || 'un producto específico') + '*' };
        }
    }

    const subtotal = totalCarrito(carrito);
    let descuento = 0;
    if (promo.tipo === 'porcentaje') {
        descuento = subtotal * (promo.valor / 100);
    } else {
        descuento = Math.min(promo.valor, subtotal); // monto fijo — no puede superar el total
    }

    return {
        ok: true,
        promo,
        descuento:  parseFloat(descuento.toFixed(2)),
        totalFinal: parseFloat((subtotal - descuento).toFixed(2)),
        descripcion: promo.tipo === 'porcentaje'
            ? promo.valor + '% de descuento'
            : '$' + promo.valor.toFixed(2) + ' MXN de descuento',
    };
}

/** Valida stock de todos los items. Retorna array de items con problema. */
function validarStockMultiple(carrito, estadoCob) {
    const stock = stockBatch(carrito.map(i => i.id), estadoCob);
    return carrito.filter(item => {
        const { local, total } = stock.get(item.id);
        return local + total < item.cantidad;
    });
}

// ─────────────────────────────────────────────────────
//  PARTICIÓN DE CARRITO  (pickup disponible vs solo envío)
// ─────────────────────────────────────────────────────

/**
 * Clasifica cada item del carrito según stock local en la sucursal.
 * Retorna { pickup: [], envio: [], sinStock: [] }
 *   pickup   → tiene stock en tienda (puede recogerse hoy)
 *   envio    → solo stock en CEDIS/almacén (requiere envío o espera)
 *   sinStock → sin stock en ningún lado (escalar a asesor)
 */
function partirCarrito(carrito, estadoCob) {
    const pickup   = [];
    const envio    = [];
    const sinStock = [];
    const stock    = stockBatch(carrito.map(i => i.id), estadoCob);

    for (const item of carrito) {
        const { local: stLocal, total: stTotal } = stock.get(item.id);

        if (stLocal >= item.cantidad) {
            pickup.push({ ...item, _stLocal: stLocal, _stTotal: stTotal });
        } else if (stTotal >= item.cantidad) {
            // Calcular días estimados de entrega desde CEDIS
            const diasEst = stLocal > 0 ? 2 : 5;   // si hay algo en tienda viene pronto
            envio.push({ ...item, _stLocal: stLocal, _stTotal: stTotal, _diasEntrega: diasEst });
        } else {
            sinStock.push(item);
        }
    }
    return { pickup, envio, sinStock };
}

/**
 * Formatea bloque de productos con etiqueta de disponibilidad.
 * tipo: 'pickup' | 'envio'
 */
function formatParticion(items, tipo) {
    if (!items.length) return '';
    const icono = tipo === 'pickup' ? '🏪' : '📦';
    const label = tipo === 'pickup' ? 'Listo en tienda hoy' : 'Envío desde almacén';
    const lineas = items.map((i, n) => {
        const precio = `$${(i.price * i.cantidad).toFixed(2)}`;
        const extra  = tipo === 'envio' ? ` _(~${i._diasEntrega} días)_` : '';
        return `${n+1}. *${i.name}*  ×${i.cantidad}  ${precio}${extra}`;
    });
    return icono + ' *' + label + ':*\n' + lineas.join('\n');
}

/**
 * Genera el resumen del escenario mixto para presentar al cliente.
 * Incluye los tres escenarios posibles y sus costos.
 */
function resumenEscenariosMixtos(pickup, envio, subtotalPickup, subtotalEnvio, fleteEnvio, fleteUnificado) {
    const totalPickup  = subtotalPickup;
    const totalEnvio   = subtotalEnvio + fleteEnvio;
    const totalUnif    = subtotalPickup + subtotalEnvio + fleteUnificado;

    return (
        `📊 *Opciones de entrega para tu pedido:*

` +

        `*Opción A — Dos pedidos separados* ✂️
` +
        `${formatParticion(pickup,'pickup')}
` +
        `   💰 Subtotal pickup: $${subtotalPickup.toFixed(2)} MXN

` +
        `${formatParticion(envio,'envio')}
` +
        `   📦 Flete envío: ${fleteEnvio===0?'*¡GRATIS!*':`*$${fleteEnvio} MXN*`}
` +
        `   💰 Subtotal envío: $${totalEnvio.toFixed(2)} MXN
` +
        `━━━━━━━━━━━━━━━━━
` +
        `   💵 Total ambos pedidos: *$${(totalPickup+totalEnvio).toFixed(2)} MXN*

` +

        `*Opción B — Todo en sucursal* 🏪
` +
        `   Los ${envio.length} artículo${envio.length>1?'s':''} de envío llegarán a la tienda en ~${Math.max(...envio.map(i=>i._diasEntrega))} días hábiles.
` +
        `   💰 Total: *$${(subtotalPickup+subtotalEnvio).toFixed(2)} MXN* _(sin costo de flete)_

` +

        `*Opción C — Todo a domicilio* 🚚
` +
        `   📦 Flete único: ${fleteUnificado===0?'*¡GRATIS!*':`*$${fleteUnificado} MXN*`}
` +
        `   💰 Total: *$${totalUnif.toFixed(2)} MXN*`
    );
}

/** Formatea el carrito para mensaje WhatsApp */
function formatCarrito(carrito, flete = null) {
    if (!carrito || !carrito.length) return '_(Carrito vacío)_';
    const lineas = carrito.map((i, n) =>
        `${n+1}. *${i.name}*\n   💰 $${Number(i.price).toFixed(2)} × ${i.cantidad} = *$${(i.price * i.cantidad).toFixed(2)}*`
    );
    const subtotal = totalCarrito(carrito);
    let resumen = lineas.join('\n\n') + `\n\n━━━━━━━━━━━━━━━━━`;
    resumen += `\n🛒 Subtotal: *$${subtotal.toFixed(2)} MXN*`;
    if (flete !== null) {
        resumen += `\n📦 Envío: ${flete === 0 ? '*¡GRATIS!*' : `*$${flete} MXN*`}`;
        resumen += `\n💵 *Total: $${(subtotal + flete).toFixed(2)} MXN*`;
    }
    return resumen;
}

// ═══════════════════════════════════════════════════════
//  CLIENTES
// ═══════════════════════════════════════════════════════
function upsertCliente(telefono, nombre = null) {
    let c = db.prepare('SELECT * FROM clientes WHERE telefono=?').get(telefono);
    if (!c) {
        db.prepare(`INSERT INTO clientes (nombre,telefono,canal_origen,activo) VALUES (?,?,'whatsapp',1)`).run(nombre, telefono);
        c = db.prepare('SELECT * FROM clientes WHERE telefono=?').get(telefono);
    } else if (nombre) {
        db.prepare(`UPDATE clientes SET nombre=?, ultima_actividad=datetime('now','localtime') WHERE id=?`).run(nombre, c.id);
        c.nombre = nombre;
    }
    return c;
}

// Última dirección guardada de un cliente (direcciones_envio se inserta en
// cada pedido con envío, siempre es_default=1, sin chequeo de unicidad — la
// más reciente por id es la mejor aproximación a "su dirección actual").
function buscarDireccionGuardada(telefono) {
    try {
        return db.prepare(`
            SELECT c.nombre AS nombre, d.calle, d.colonia, d.ciudad, d.estado, d.cp, d.referencia
            FROM direcciones_envio d
            JOIN clientes c ON c.id = d.id_cliente
            WHERE c.telefono = ?
            ORDER BY d.id DESC LIMIT 1
        `).get(telefono) || null;
    } catch (_) { return null; }
}

// Punto de entrada único para iniciar la captura de dirección de envío. Si
// el cliente ya tiene una dirección guardada, ofrece reusarla (vía
// S.CONFIRM_DIR_GUARDADA) en vez de volver a pedir nombre/calle/colonia/
// ciudad/referencia desde cero — centraliza lo que antes eran 5 sitios
// duplicados en orderFlow.js que iban directo a S.ASK_NOMBRE.
function iniciarCapturaDireccion(userId, tel, dataBase) {
    const guardada = buscarDireccionGuardada(tel);
    if (guardada && guardada.calle) {
        sessionManager.updateSession(userId, S.CONFIRM_DIR_GUARDADA, { ...dataBase, direccionGuardada: guardada });
        return (
            `📍 Tenemos esta dirección guardada de tu última compra:\n\n` +
            `${guardada.nombre || ''}\n${guardada.calle}, ${guardada.colonia}\n` +
            `${guardada.ciudad}${guardada.estado ? ', ' + guardada.estado : ''}\n` +
            (guardada.referencia ? `Ref: ${guardada.referencia}\n` : '') +
            `\n1️⃣  ✅ Usar esta dirección\n2️⃣  ✏️ Usar otra dirección`
        );
    }
    sessionManager.updateSession(userId, S.ASK_NOMBRE, dataBase);
    return `¿Cuál es tu *nombre completo*?`;
}

// ═══════════════════════════════════════════════════════
//  GRABADO DE PEDIDO — soporta carrito múltiple
// ═══════════════════════════════════════════════════════
function insertarLinkPago(pedidoRowid, monto, folio) {
    const token   = `PP-${folio}-${Date.now()}`;
    const linkUrl = moduloActivo('pago_real_activo')
        ? _crearLinkPagoReal(pedidoRowid, monto, folio, token)
        : `https://www.paypal.com/checkoutnow?token=${token}`;
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
    const stmtDetalle = db.prepare(`
        INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal_linea, sucursal_origen)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of carrito) {
        const lineTotal = item.price * item.cantidad;
        stmtDetalle.run(pedidoRowid, item.id, item.cantidad, item.price, lineTotal, sucursalOrigen || '');
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

function grabarPedidoPickup(data, telefono) {
    const folio   = generarFolio('pedido');
    const cliente = upsertCliente(telefono, data.nombre || null);
    const carrito = data.carrito && data.carrito.length ? data.carrito : [{ ...data.selectedProduct, cantidad: 1 }];

    const { pedidoRowid, subtotal } = insertarPedidoConCarrito(
        cliente.nombre || telefono, carrito, data.ciudad_cob || '', 'Pick Up Pendiente', data.estado_cob, folio, cliente.id,
        data.origenVentaPrevia ? 'asesor' : 'bot'
    );
    db.prepare('UPDATE pedidos SET subtotal=?, total=? WHERE id_pedido=?').run(subtotal, subtotal, pedidoRowid);
    if (data.cp) { try { db.prepare('UPDATE pedidos SET cp=? WHERE id_pedido=?').run(data.cp, pedidoRowid); } catch(e) { log.debug('No se pudo guardar CP en pedido: ' + e.message); } }
    const linkUrl = insertarLinkPago(pedidoRowid, subtotal, folio);

    const codigo = `RET-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
    const limite = new Date(Date.now() + 72*3600*1000).toISOString().replace('T',' ').substring(0,19);
    if (data.idPunto) {
        db.prepare(`INSERT INTO reservas_pickup (id_pedido, id_punto, estatus, fecha_limite, codigo_retiro) VALUES (?,?,'apartado',?,?)`)
          .run(pedidoRowid, data.idPunto, limite, codigo);
    }

    // Notificar por correo (async)
    const productosEmailPu = carrito.map(i => ({ nombre:i.name, cantidad:i.cantidad, precio:i.price }));
    emailSvc.notificarPedido({
        folio, idPedido: pedidoRowid,
        cliente: cliente.nombre || telefono,
        total: subtotal, subtotal, costoEnv: 0, metodo: 'pickup',
        tipoEntrega: 'pickup',
        codigoRetiro: codigo,
        productos: productosEmailPu,
        linkPago: linkUrl,
        fechaCreacion: new Date().toLocaleString('es-MX'),
    }).catch(e => log.warn('Error email', e));

    mensajeService.marcarOutcome(db, telefono, 'venta');
    return { folio, total: subtotal, linkUrl, codigo };
}

function grabarPedidoEnvio(data, telefono) {
    const folio   = generarFolio('pedido');
    const cliente = upsertCliente(telefono, data.nombre);
    const carrito = data.carrito && data.carrito.length ? data.carrito : [{ ...data.selectedProduct, cantidad: 1 }];
    const subtotal  = totalCarrito(carrito);
    const costoEnv  = calcularFlete(subtotal, data.costoEnvFijo || null);
    // El cupón (si se aplicó en el flujo CUPON de cartFlow.js) debe descontarse
    // aquí mismo: este `total` es el que se cobra en el link de pago real.
    const descuento = data.descuentoCupon || 0;
    const total     = subtotal + costoEnv - descuento;

    db.prepare(`
        INSERT INTO direcciones_envio (id_cliente, alias, calle, colonia, ciudad, estado, cp, referencia, es_default)
        VALUES (?, 'WhatsApp', ?, ?, ?, ?, ?, ?, 1)
    `).run(cliente.id, data.calle, data.colonia, data.ciudad, data.estado_cob, data.cp, data.referencia || '');

    const { pedidoRowid } = insertarPedidoConCarrito(
        data.nombre, carrito, data.ciudad || data.ciudad_cob, 'Pendiente', data.estado_cob, folio, cliente.id,
        data.origenVentaPrevia ? 'asesor' : 'bot'
    );
    db.prepare('UPDATE pedidos SET subtotal=?, descuento=?, total=? WHERE id_pedido=?').run(subtotal, descuento, total, pedidoRowid);
    if (data.cp) { try { db.prepare('UPDATE pedidos SET cp=? WHERE id_pedido=?').run(data.cp, pedidoRowid); } catch(e) { log.debug('No se pudo guardar CP en pedido: ' + e.message); } }
    const linkUrl = insertarLinkPago(pedidoRowid, total, folio);

    // Crear guía simulada de Estafeta
    let guiaData = null;
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
    return { folio, total, linkUrl, costoEnv, subtotal, guia: guiaData };
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

    // ── Pedido Pickup ────────────────────────────────
    if (carritoPickup.length) {
        const folio    = generarFolio('pedido');
        const subtotal = totalCarrito(carritoPickup);
        const { pedidoRowid } = insertarPedidoConCarrito(
            cliente.nombre || telefono, carritoPickup, data.ciudad_cob || '', 'Pick Up Pendiente', data.estado_cob, folio, cliente.id,
            data.origenVentaPrevia ? 'asesor' : 'bot'
        );
        db.prepare('UPDATE pedidos SET subtotal=?, total=? WHERE id_pedido=?').run(subtotal, subtotal, pedidoRowid);
        if (data.cp) { try { db.prepare('UPDATE pedidos SET cp=? WHERE id_pedido=?').run(data.cp, pedidoRowid); } catch(e) { log.debug('No se pudo guardar CP en pedido: ' + e.message); } }
        const linkUrl = insertarLinkPago(pedidoRowid, subtotal, folio);
        const codigo  = `RET-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
        const limite  = new Date(Date.now() + 72*3600*1000).toISOString().replace('T',' ').substring(0,19);
        if (data.idPunto) {
            db.prepare(`INSERT INTO reservas_pickup (id_pedido, id_punto, estatus, fecha_limite, codigo_retiro) VALUES (?,?,'apartado',?,?)`)
              .run(pedidoRowid, data.idPunto, limite, codigo);
        }
        resultados.pedidoPickup = { folio, total: subtotal, linkUrl, codigo };
    }

    // ── Pedido Envío ─────────────────────────────────
    if (carritoEnvio.length) {
        const folio    = generarFolio('pedido');
        const subtotal = totalCarrito(carritoEnvio);
        const costoEnv = calcularFlete(subtotal, data.costoEnvFijo || null);
        const total    = subtotal + costoEnv;

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
        db.prepare('UPDATE pedidos SET subtotal=?, total=? WHERE id_pedido=?').run(subtotal, total, pedidoRowid);
        const linkUrl = insertarLinkPago(pedidoRowid, total, folio);
        resultados.pedidoEnvio = { folio, total, linkUrl, costoEnv, subtotal };
    }

    if (resultados.pedidoPickup || resultados.pedidoEnvio) mensajeService.marcarOutcome(db, telefono, 'venta');
    return resultados;
}

/**
 * Graba UN pedido de pickup unificado con TODOS los items,
 * incluyendo los que normalmente irían a envío (cliente eligió esperar en sucursal).
 */
function grabarPedidoPickupUnificado(data, telefono) {
    const cliente = upsertCliente(telefono, data.nombre || null);
    const carrito = [...(data.carritoPickup||[]), ...(data.carritoEnvio||[])];
    const folio   = generarFolio('pedido');
    const subtotal = totalCarrito(carrito);

    const { pedidoRowid } = insertarPedidoConCarrito(
        cliente.nombre || telefono, carrito, data.ciudad_cob || '', 'Pick Up Pendiente — Espera artículos de almacén', data.estado_cob, folio, cliente.id,
        data.origenVentaPrevia ? 'asesor' : 'bot'
    );
    db.prepare('UPDATE pedidos SET subtotal=?, total=? WHERE id_pedido=?').run(subtotal, subtotal, pedidoRowid);
    if (data.cp) { try { db.prepare('UPDATE pedidos SET cp=? WHERE id_pedido=?').run(data.cp, pedidoRowid); } catch(e) { log.debug('No se pudo guardar CP en pedido: ' + e.message); } }
    const linkUrl = insertarLinkPago(pedidoRowid, subtotal, folio);
    const codigo  = `RET-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
    const limite  = new Date(Date.now() + 14*24*3600*1000).toISOString().replace('T',' ').substring(0,19); // 14 días
    if (data.idPunto) {
        db.prepare(`INSERT INTO reservas_pickup (id_pedido, id_punto, estatus, fecha_limite, codigo_retiro) VALUES (?,?,'apartado',?,?)`)
          .run(pedidoRowid, data.idPunto, limite, codigo);
    }
    mensajeService.marcarOutcome(db, telefono, 'venta');
    return { folio, total: subtotal, linkUrl, codigo };
}

// ═══════════════════════════════════════════════════════
//  HELPERS FORMATO
// ═══════════════════════════════════════════════════════
function formatProducts(products) {
    return products.map((p,i) => {
        // ponytail: umbral fijo de "vendidos"; ajustar si ventas_simuladas cambia de escala.
        const _vendidos = p.ventas_simuladas > 20 ? `\n   🔥 ${p.ventas_simuladas} vendidos` : '';
        return `${i+1}. *${p.name}*\n   📦 ${p.cat} · 💰 $${Number(p.price).toFixed(2)}${_vendidos}`;
    }).join('\n\n');
}

function menuPrincipal(tel) {
    // Saludo diferenciado para clientes recurrentes — usa el tono configurado
    let saludo = t('saludo_nuevo') || '🧸 ¡Hola! Bienvenido a *Julio Cepeda Jugueterías* 🎉';
    if (tel) {
        try {
            const cli = db.prepare('SELECT nombre, tags FROM clientes WHERE telefono=?').get(tel);
            if (cli && (cli.tags||'').includes('pedido_')) {
                const nombre = (cli.nombre || '').split(' ')[0];
                const nVar = nombre ? ', *' + nombre + '* ' : ' ';
                saludo = t('saludo_recurrente', { nombre: nVar }) ||
                    ('🧸 ¡Bienvenido de vuelta' + (nombre ? ', *' + nombre + '*' : '') + '! Qué gusto verte de nuevo 🎉');
            }
        } catch(e) { log.debug('No se pudo cargar cliente para saludo: ' + e.message); }
    }
    const opciones = t('menu_opciones') ||
        ('Soy tu asistente de ventas. ¿Cómo te puedo ayudar?\n\n' +
         '1️⃣  🔍 Sé qué juguete busco\n2️⃣  🧙 No sé qué pedir — ¡ayúdame!\n' +
         '3️⃣  📦 Rastrear mi pedido\n4️⃣  👤 Hablar con un asesor');
    return saludo + '\n\n' + opciones + '\n\n_Escribe el número de tu opción._';
}

// ═══════════════════════════════════════════════════════
//  AUTO-TAGGING DE CLIENTES
// ═══════════════════════════════════════════════════════
function tagCliente(telefono, ...tags) {
    if (!telefono || !tags.length) return;
    try {
        for (const tag of tags) {
            db.prepare(`UPDATE clientes SET tags =
                CASE WHEN tags IS NULL OR tags = '' THEN ?
                     WHEN tags NOT LIKE '%' || ? || '%' THEN tags || ',' || ?
                     ELSE tags END
                WHERE telefono = ?`).run(tag, tag, tag, telefono);
        }
    } catch (e) { log.debug('No se pudo etiquetar cliente: ' + e.message); }
}

function quitarTag(telefono, tag) {
    if (!telefono || !tag) return;
    try {
        db.prepare(`UPDATE clientes SET
            tags = TRIM(REPLACE(REPLACE(',' || COALESCE(tags,'') || ',',
                ',' || ? || ',', ','), ',,', ','), ',')
            WHERE telefono = ?`).run(tag, telefono);
    } catch (e) { log.debug('No se pudo quitar tag de cliente: ' + e.message); }
}

//  ESCALADA A ASESOR
// ═══════════════════════════════════════════════════════
function registrarEscalada(userId, idPedido, motivo, telefono, tipo, caso) {
    const esQuejaMotivo = /queja|molest|frustrad|inconforme|enojad/i.test(motivo||'');
    const outcome = esQuejaMotivo ? 'queja' : 'escalacion';
    // Auto-tag según el motivo de la escalada
    if (telefono) {
        if (esQuejaMotivo) tagCliente(telefono, 'queja');
    }
    try {
        let conv = db.prepare(
            `SELECT id FROM conversaciones WHERE telefono=? AND estatus IN ('activa','escalada') ORDER BY iniciada_en DESC LIMIT 1`
        ).get(telefono);
        if (!conv) {
            const cli = db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);
            const infoC = db.prepare(
                `INSERT INTO conversaciones (id_cliente, telefono, canal, estatus, id_pedido) VALUES (?,?,'whatsapp','escalada',?)`
            ).run(cli ? cli.id : null, telefono, idPedido || null);
            conv = { id: infoC.lastInsertRowid };
        } else {
            db.prepare(`UPDATE conversaciones SET estatus='escalada' WHERE id=?`).run(conv.id);
        }
        mensajeService.marcarOutcome(db, telefono, outcome);
        const cli2 = db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);
        db.prepare(
            `INSERT INTO cola_atencion (id_conversacion, id_cliente, motivo_escalada, prioridad, estatus, tipo, caso) VALUES (?,?,?,1,'en_espera',?,?)`
        ).run(conv.id, cli2 ? cli2.id : null, motivo || 'Sin motivo', tipo || 'otro', caso || null);

        const ahora = new Date();
        const minActual = ahora.getHours() * 60 + ahora.getMinutes();
        const cuerpo = JSON.stringify({
            evento: 'escalada_asesor', telefono, motivo: motivo || 'Sin especificar',
            fuera_horario: !(minActual >= 660 && minActual < 1200),
            hora: ahora.toISOString(),
        });
        db.prepare(
            `INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, id_pedido, estatus) VALUES ('dashboard','asesor','Cliente esperando atención',?,?,'pendiente')`
        ).run(cuerpo, idPedido || null);
        // Notificacion WhatsApp al asesor
        const _asesorTel = process.env.ASESOR_WHATSAPP;
        if (_asesorTel) {
            const _hh = (new Date().getUTCHours() - 6 + 24) % 24;
            const _msgA = '\u26a0\ufe0f *Cliente esperando atencion*\n\nTel: ' + telefono + '\nMotivo: ' + (motivo || 'Sin especificar') + '\nHorario: ' + (_hh >= 11 && _hh < 20 ? 'En horario' : 'Fuera de horario') + '\n\nResponde directamente a *' + telefono + '*';
            try { db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,?,?,'pendiente')").run(_asesorTel, 'Escalada asesor', _msgA); } catch(e) { log.debug('No se pudo notificar al asesor: ' + e.message); }
        }
    } catch(e) {
        log.error('registrarEscalada error', e);
    }
}

// ═══════════════════════════════════════════════════════
//  HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════

// ── Helper interno para mostrar carrito ──────────────────
function mostrarCarrito(carrito) {
    return (
        `🛒 *Tu carrito* (${carrito.length} producto${carrito.length>1?'s distintos':''}):\n\n` +
        `${formatCarrito(carrito)}\n\n` +
        `¿Qué quieres hacer?\n\n` +
        `1️⃣  🔍 Seguir buscando\n` +
        `2️⃣  ✅ Proceder al pago\n` +
        `3️⃣  🗑️ Vaciar carrito`
    );
}

module.exports = {
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
    buscarDireccionGuardada,
    iniciarCapturaDireccion,
};