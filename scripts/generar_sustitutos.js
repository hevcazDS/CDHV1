// generar_sustitutos.js
// Pobla la tabla productos_similares con relaciones automáticas.
// Corre una sola vez (o cuando entra nuevo catálogo).
// Uso: node generar_sustitutos.js
'use strict';
const db = require('../bot/db_connection');

const RANGO_PRECIO  = 0.35;   // ±35% del precio base
const SCORE_MIN     = 3;      // score mínimo para insertar
const MAX_POR_PROD  = 5;      // máx 5 sustitutos por producto

function calcularScore(base, cand) {
    let score = 0;
    // Misma categoría (ya filtrado en SQL, pero ponderamos)
    if (base.cat === cand.cat)                          score += 4;
    // Misma marca
    if (base.brand && cand.brand &&
        base.brand.toLowerCase() === cand.brand.toLowerCase()) score += 3;
    // Misma edad recomendada
    if (base.edad_recomendada && cand.edad_recomendada &&
        base.edad_recomendada === cand.edad_recomendada) score += 2;
    // Mismo género o género neutro
    if (base.genero && cand.genero) {
        const bg = base.genero.toLowerCase();
        const cg = cand.genero.toLowerCase();
        if (bg === cg)                                  score += 2;
        else if (bg.includes('niño') && cg.includes('niño')) score += 1;
        else if (bg.includes('niña') && cg.includes('niña')) score += 1;
    }
    // Tags en común
    const bt = new Set((base.tags || '').toLowerCase().split(',').map(t => t.trim()).filter(t => t.length > 3));
    const ct = new Set((cand.tags || '').toLowerCase().split(',').map(t => t.trim()).filter(t => t.length > 3));
    const comunes = [...bt].filter(t => ct.has(t)).length;
    score += Math.min(comunes, 3);
    // Precio muy similar (±10%)
    const diff = Math.abs(base.price - cand.price) / base.price;
    if (diff <= 0.10)      score += 2;
    else if (diff <= 0.20) score += 1;

    return score;
}

console.log('\n═══════════════════════════════════════════');
console.log('  Generando sustitutos automáticos...');
console.log('═══════════════════════════════════════════\n');

// Limpiar tabla antes de regenerar
db.prepare('DELETE FROM productos_similares').run();
console.log('Tabla limpiada.');

const productos = db.prepare(`
    SELECT id, name, cat, price, tags, brand, edad_recomendada, genero,
           stock_tienda, stock_cedis
    FROM productos WHERE activo=1
`).all();

console.log(`Procesando ${productos.length} productos...`);

const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO productos_similares
        (id_producto, id_sustituto, tipo_relacion, score, activa)
    VALUES (?, ?, ?, ?, 1)
`);

const insertMany = db.transaction((relaciones) => {
    for (const r of relaciones) {
        insertStmt.run(r.id_producto, r.id_sustituto, r.tipo, r.score);
    }
});

let totalInsertados = 0;
let procesados = 0;

for (const base of productos) {
    const minP = base.price * (1 - RANGO_PRECIO);
    const maxP = base.price * (1 + RANGO_PRECIO);

    // Candidatos: misma categoría, precio similar, diferente producto
    const candidatos = productos.filter(c =>
        c.id !== base.id &&
        c.cat === base.cat &&
        c.price >= minP &&
        c.price <= maxP
    );

    // Calcular scores
    const scored = candidatos
        .map(c => ({
            ...c,
            score: calcularScore(base, c),
            tieneStock: (c.stock_tienda || 0) + (c.stock_cedis || 0) > 0,
        }))
        .filter(c => c.score >= SCORE_MIN)
        // Priorizar los que tienen stock
        .sort((a, b) => {
            if (a.tieneStock !== b.tieneStock) return b.tieneStock - a.tieneStock;
            return b.score - a.score;
        })
        .slice(0, MAX_POR_PROD);

    if (!scored.length) { procesados++; continue; }

    const relaciones = scored.map(c => {
        let tipo = 'similar';
        if (c.price < base.price * 0.85)      tipo = 'alternativa_economica';
        else if (c.price > base.price * 1.15) tipo = 'alternativa_premium';
        return { id_producto: base.id, id_sustituto: c.id, tipo, score: c.score };
    });

    insertMany(relaciones);
    totalInsertados += relaciones.length;
    procesados++;

    // Log de progreso cada 100 productos
    if (procesados % 100 === 0) {
        process.stdout.write(`  ${procesados}/${productos.length} productos procesados...\r`);
    }
}

console.log(`\n✅ Procesados: ${procesados} productos`);
console.log(`✅ Relaciones insertadas: ${totalInsertados}`);

// Verificar resultado
const stats = db.prepare(`
    SELECT
        COUNT(*)                                    AS total_relaciones,
        COUNT(DISTINCT id_producto)                 AS productos_con_sustituto,
        ROUND(AVG(score), 1)                        AS score_promedio,
        MAX(score)                                  AS score_maximo,
        SUM(CASE WHEN tipo_relacion='similar' THEN 1 ELSE 0 END)              AS similares,
        SUM(CASE WHEN tipo_relacion='alternativa_economica' THEN 1 ELSE 0 END) AS economicos,
        SUM(CASE WHEN tipo_relacion='alternativa_premium' THEN 1 ELSE 0 END)   AS premium
    FROM productos_similares
`).get();

console.log('\n=== Estadísticas ===');
console.log(`  Total relaciones:           ${stats.total_relaciones}`);
console.log(`  Productos con sustituto:    ${stats.productos_con_sustituto}/${productos.length}`);
console.log(`  Score promedio:             ${stats.score_promedio}`);
console.log(`  Score máximo:               ${stats.score_maximo}`);
console.log(`  Similares:                  ${stats.similares}`);
console.log(`  Alternativas económicas:    ${stats.economicos}`);
console.log(`  Alternativas premium:       ${stats.premium}`);

// Muestra de 5 relaciones
console.log('\n=== Muestra de relaciones generadas ===');
const muestra = db.prepare(`
    SELECT p1.name AS producto, p2.name AS sustituto,
           ps.tipo_relacion AS tipo, ps.score,
           p1.price AS precio_base, p2.price AS precio_sust
    FROM productos_similares ps
    JOIN productos p1 ON p1.id = ps.id_producto
    JOIN productos p2 ON p2.id = ps.id_sustituto
    ORDER BY ps.score DESC
    LIMIT 5
`).all();
for (const r of muestra) {
    console.log(`  "${r.producto}" ($${r.precio_base})`);
    console.log(`    → "${r.sustituto}" ($${r.precio_sust}) | ${r.tipo} | score:${r.score}`);
}

console.log('\n✅ Listo. Los sustitutos están disponibles para el bot.\n');
