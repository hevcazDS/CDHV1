// ═══════════════════════════════════════════════════════
//  tagging.js — auto-tagging de clientes. Extraído mecánicamente de
//  bot/flows/_shared.js, sin cambio de lógica.
// ═══════════════════════════════════════════════════════
const { db, log } = require('./_base');

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

module.exports = {
    tagCliente,
    quitarTag,
};
