'use strict';
// ─────────────────────────────────────────────────────────────────────────
// GUARDIÁN DE ESQUEMA — falla si el código crea tablas/columnas inline que NO
// están reflejadas en db/schema.sql.
//
//   node scripts/db/schema_guard.js
//
// Por qué: el drift que mordió producción no fue una migración perdida, fue
// esquema cambiado INLINE (CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN
// dispersos en 7 archivos de boot) sin reflejarlo en db/schema.sql — así las
// instancias nuevas divergen de las viejas (el incidente usuarios.nombre NOT
// NULL, los duplicados de cola_emails). Este check estático lo atrapa: cada
// tabla creada inline debe existir en schema.sql, y cada columna agregada por
// ALTER inline debe estar en el bloque CREATE de esa tabla en schema.sql.
//
// No muta nada. Salta comentarios y strings de tests. Complementa migrations/.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCHEMA = path.join(ROOT, 'db', 'schema.sql');
const DIRS = ['bot', 'services', 'dashboard'];
const IGNORE_DIRS = new Set(['node_modules', 'dashboard-ui', 'demo', 'logs', '.git']);

// ── Parseo de schema.sql → { tabla: Set(columnas/tokens del bloque) } ──────
function parseSchema() {
    const src = fs.readFileSync(SCHEMA, 'utf8');
    const tablas = {};
    // Bloques CREATE TABLE [IF NOT EXISTS] nombre ( ... );
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\)\s*;/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
        const nombre = m[1].toLowerCase();
        // tokens del cuerpo (nombres de columna al inicio de cada línea, y todo palabra)
        const cuerpo = m[2];
        const cols = new Set();
        cuerpo.split(',').forEach(frag => { const c = frag.trim().match(/^["'`]?(\w+)["'`]?/); if (c) cols.add(c[1].toLowerCase()); });
        cuerpo.split(/\W+/).forEach(w => w && cols.add(w.toLowerCase())); // laxo: cualquier palabra del bloque
        tablas[nombre] = cols;
    }
    return tablas;
}

function sinComentarios(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
}

// ── ALTER con nombre de columna interpolado (template literal) ─────────────
// reAlter (arriba) exige un nombre de columna literal `\w+` tras ADD COLUMN,
// pero `_asegurarColumnasUsuarios` (dashboard/server.js) arma el SQL como
// `ALTER TABLE usuarios ADD COLUMN ${nombre} TEXT` dentro de un
// `for (const nombre of requeridas)` — reAlter nunca matchea eso y el check
// lo salta en silencio. En vez de parsear JS en general (arriesgado y fuera
// de alcance), resolvemos este patrón concreto: hallamos el ALTER con
// `${var}`, el `for...of` que declara esa variable, y el array literal de
// origen — y validamos cada nombre de columna de ese array contra schema.sql.
function checkAltersTemplateLiteral(src, rel, schema, faltantes) {
    const reAlterTpl = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+\$\{\s*(\w+)\s*\}/gi;
    if (!reAlterTpl.test(src)) return;
    reAlterTpl.lastIndex = 0;

    // loopVar -> arrayVar, de cada `for (const loopVar of arrayVar)` del archivo
    const forOf = {};
    const reForOf = /for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)/g;
    let fm;
    while ((fm = reForOf.exec(src)) !== null) forOf[fm[1]] = fm[2];

    // arrayVar -> contenido crudo de `const arrayVar = [ ... ]`
    const arrays = {};
    const reArr = /const\s+(\w+)\s*=\s*\[([^\]]*)\]/g;
    let am;
    while ((am = reArr.exec(src)) !== null) arrays[am[1]] = am[2];

    let m;
    while ((m = reAlterTpl.exec(src)) !== null) {
        const t = m[1].toLowerCase(), loopVar = m[2];
        const arrayVar = forOf[loopVar];
        const contenido = arrayVar && arrays[arrayVar];
        if (!contenido) {
            faltantes.push(rel + ': ALTER `' + m[1] + '` con columna dinámica `${' + loopVar + '}` que no se pudo resolver contra un array de origen — revisar a mano');
            continue;
        }
        const cols = [...contenido.matchAll(/['"`]([^'"`]+)['"`]/g)].map(x => x[1].toLowerCase());
        if (!schema[t]) { faltantes.push(rel + ': ALTER de tabla `' + m[1] + '` que no está en db/schema.sql'); continue; }
        for (const c of cols) {
            if (!schema[t].has(c)) faltantes.push(rel + ': ALTER `' + m[1] + '.' + c + '` (vía `${' + loopVar + '}` de `' + arrayVar + '`) — columna no está en el CREATE de db/schema.sql');
        }
    }
}

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORE_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith('.js')) out.push(full);
    }
}

function main() {
    const schema = parseSchema();
    const files = [];
    for (const d of DIRS) walk(path.join(ROOT, d), files);

    const faltantes = [];
    const reCreate = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+["'`]?(\w+)["'`]?/gi;
    const reAlter = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+["'`]?(\w+)["'`]?/gi;

    for (const f of files) {
        const src = sinComentarios(fs.readFileSync(f, 'utf8'));
        const rel = path.relative(ROOT, f);
        let m;
        while ((m = reCreate.exec(src)) !== null) {
            const t = m[1].toLowerCase();
            if (!schema[t]) faltantes.push(rel + ': CREATE TABLE inline `' + m[1] + '` no está en db/schema.sql');
        }
        while ((m = reAlter.exec(src)) !== null) {
            const t = m[1].toLowerCase(), c = m[2].toLowerCase();
            if (!schema[t]) faltantes.push(rel + ': ALTER de tabla `' + m[1] + '` que no está en db/schema.sql');
            else if (!schema[t].has(c)) faltantes.push(rel + ': ALTER `' + m[1] + '.' + m[2] + '` — columna no está en el CREATE de db/schema.sql');
        }
        checkAltersTemplateLiteral(src, rel, schema, faltantes);
    }

    if (faltantes.length) {
        console.error('❌ ' + faltantes.length + ' cambio(s) de esquema inline SIN reflejar en db/schema.sql:');
        [...new Set(faltantes)].forEach(x => console.error('  ' + x));
        console.error('\n  Regla: todo CREATE/ALTER inline debe estar también en db/schema.sql (fuente canónica de fresh installs).');
        process.exit(1);
    }
    console.log('✓ Esquema inline consistente con db/schema.sql (' + Object.keys(schema).length + ' tablas en schema.sql).');
}

main();
