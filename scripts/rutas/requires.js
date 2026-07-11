'use strict';
// ─────────────────────────────────────────────────────────────────────────
// CHECK DE INTEGRIDAD DE REQUIRES — falla si un require('./...' | '../...')
// relativo NO resuelve a un archivo real.
//
//   node scripts/rutas/requires.js
//
// Por qué existe: un `require` con path equivocado dentro de un `try/catch`
// (patrón común en este repo para "opcional") NO tira 500 — se traga el error
// y la lógica NUNCA corre (falso verde). El smoke test no lo ve. Este check SÍ,
// de forma estática, sin ejecutar nada. Encontró rutas de rutas y de puntos de
// lealtad silenciosamente rotas por `../` en vez de `../../`.
//
// Salta requires dentro de comentarios (// y bloques). Ignora carpetas no-fuente.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// Escanea el código de PRODUCCIÓN (bot/, services/, dashboard/, scripts/). Se
// excluye tests/ (tests legacy con patrón de fallback require, no son runtime)
// y las carpetas no-fuente.
const IGNORE = new Set(['node_modules', '.git', 'dashboard-ui', 'demo', 'desktop', '.wwebjs_auth', 'logs', 'tests']);

// Quita comentarios de línea y de bloque para no matchear requires comentados.
function sinComentarios(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')) // bloque → espacios (preserva líneas)
        .split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
}

let roto = [], total = 0;
function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORE.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.js')) scan(full);
    }
}
function resuelve(base, spec) {
    for (const ext of ['', '.js', '.json', '/index.js']) {
        if (fs.existsSync(path.resolve(base, spec + ext))) return true;
    }
    return false;
}
function scan(file) {
    const src = sinComentarios(fs.readFileSync(file, 'utf8'));
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        total++;
        if (!resuelve(path.dirname(file), m[1])) {
            const linea = src.slice(0, m.index).split('\n').length;
            roto.push(path.relative(ROOT, file) + ':' + linea + "  require('" + m[1] + "')");
        }
    }
}

walk(ROOT);
if (roto.length) {
    console.error('❌ ' + roto.length + ' require(s) relativo(s) roto(s) (fallan en silencio si están en try/catch):');
    roto.forEach(r => console.error('  ' + r));
    process.exit(1);
}
console.log('✓ ' + total + ' requires relativos, todos resuelven.');
