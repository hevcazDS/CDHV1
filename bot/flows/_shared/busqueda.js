// ═══════════════════════════════════════════════════════
//  busqueda.js — búsqueda de productos (jerarquía nombre > seo_description >
//  tags + boost por inventario) y wizard de recomendación.
//  Extraído mecánicamente de bot/flows/_shared.js, sin cambio de lógica.
// ═══════════════════════════════════════════════════════
const { db, log } = require('./_base');

// Stock VIVO: suma de inventarios (lo que mantiene el kardex) con fallback a
// las columnas legacy del alta (productos.stock_* NUNCA se actualizan). Se usa
// como columna calculada en los SELECT y como filtro en los WHERE del bot, así
// la búsqueda/sugerencias reflejan existencias reales (antes: sobreventa y
// catálogo desincronizado). Fallback ⇒ sin regresión para productos sin
// filas en inventarios. Requiere que la tabla se llame `productos` en el FROM.
const _STOCK_VIVO_SQL = "COALESCE((SELECT SUM(stock) FROM inventarios WHERE id_producto=productos.id), COALESCE(productos.stock_tienda,0)+COALESCE(productos.stock_cedis,0)+COALESCE(productos.stock_exhibicion,0))";

// Stock total normalizado para boost (0-3 puntos)
function boostStock(p) {
    const total = p.stock_vivo != null ? p.stock_vivo : ((p.stock_tienda||0) + (p.stock_cedis||0) + (p.stock_exhibicion||0));
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
                stock_tienda,stock_cedis,stock_exhibicion,ventas_simuladas,
                ${_STOCK_VIVO_SQL} AS stock_vivo
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
              AND ${_STOCK_VIVO_SQL} > 0
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
                  AND ${_STOCK_VIVO_SQL} > 0
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

module.exports = {
    boostStock,
    limpiarQuery,
    searchProducts,
    wizardSearch,
    _STOPWORDS,
};
