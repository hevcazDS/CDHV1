'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Detecta componentes JSX usados pero NO importados/definidos en dashboard-ui.
//
//   node scripts/ui/imports_jsx.js            → lista problemas
//   node scripts/ui/imports_jsx.js --check    → exit≠0 si hay alguno
//
// Por qué existe: `<Pencil/>` sin importar Pencil NO lo caza el build de Vite
// (compila a una referencia `Pencil` que solo revienta al RENDERIZAR) → pantalla
// blanca en runtime. Pasó de verdad: UsuariosTab y CatalogoTab usaban <Pencil>/
// <Inbox> sin importarlos y la pantalla de "crear usuarios" se quedaba en blanco.
// Este check lo convierte en una falla de CI, no en un bug que descubre el dueño.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'dashboard-ui', 'src');

function walk(d, acc) {
    for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        const s = fs.statSync(p);
        if (s.isDirectory()) walk(p, acc);
        else if (/\.jsx$/.test(f)) acc.push(p);
    }
    return acc;
}

// Nombres "definidos" en el archivo: imports (default + named + as), const/
// function/let capitalizados a nivel módulo, y nombres capitalizados que
// aparecen en cualquier destructuring `{ ... }` (props de componente como
// `function Kpi({ Icono })`, o `const { Foo } = ...`).
function definidos(src) {
    const d = new Set();
    for (const m of src.matchAll(/import\s+(?:([A-Za-z0-9_]+)\s*,?\s*)?(?:\{([^}]*)\})?/g)) {
        if (m[1]) d.add(m[1]);
        if (m[2]) m[2].split(',').forEach(x => { const n = x.trim().split(/\s+as\s+/).pop().trim(); if (n) d.add(n); });
    }
    for (const m of src.matchAll(/(?:const|function|let|class)\s+([A-Z][A-Za-z0-9_]*)/g)) d.add(m[1]);
    // Destructuring: cualquier `{ ... }` — tolera props renombrados/aliased.
    for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
        for (const part of m[1].split(',')) {
            const n = part.trim().split(/[:=\s]/)[0].trim();
            if (/^[A-Z][A-Za-z0-9_]*$/.test(n)) d.add(n);
        }
    }
    return d;
}

function main() {
    const problemas = [];
    for (const f of walk(DIR, [])) {
        const src = fs.readFileSync(f, 'utf8');
        const defs = definidos(src);
        const usados = new Set();
        for (const m of src.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) usados.add(m[1]);
        for (const u of usados) {
            if (u.includes('.')) continue;           // <Foo.Bar> = miembro
            if (!defs.has(u)) problemas.push({ archivo: f.replace(DIR + path.sep, ''), comp: u });
        }
    }

    if (process.argv.includes('--check')) {
        if (problemas.length) {
            console.error('❌ ' + problemas.length + ' componente(s) JSX usado(s) sin importar/definir (crash en runtime):');
            problemas.forEach(p => console.error('  ' + p.archivo + '  →  <' + p.comp + '>'));
            process.exit(1);
        }
        console.log('✓ Sin componentes JSX sin importar (' + walk(DIR, []).length + ' archivos .jsx).');
        return;
    }
    if (problemas.length) problemas.forEach(p => console.log('  ' + p.archivo + '  →  <' + p.comp + '>'));
    else console.log('✓ 0 componentes JSX sin importar.');
}

main();
