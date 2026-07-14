'use strict';
// scripts/ui/estilo_guard.js — CANDADO DE CONSISTENCIA UI (ratchet).
// Cuenta anti-patrones en dashboard-ui/src y compara contra el baseline:
//   · si un conteo SUBE → exit 1 (una página nueva nació saltándose la regla);
//   · si BAJA → el baseline se reescribe solo (el trinquete aprieta);
//   · nunca exige arreglar lo viejo de golpe — solo prohíbe empeorar.
// Reglas en CONVENCIONES_UI.md §10. Corre en `npm test` (test:ui-estilo).
//   node scripts/ui/estilo_guard.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..', 'dashboard-ui', 'src');
const BASELINE = path.join(__dirname, 'estilo_baseline.json');

// metrica → { patron, dónde, regla (mensaje al desarrollador) }
const METRICAS = {
    hex_en_jsx: {
        re: /#[0-9a-fA-F]{6}\b/g, dirs: ['pages', 'components'], ext: '.jsx',
        regla: 'Color hex en JSX: usa un token (var(--brand), var(--text-dim), theme Mantine) — CONVENCIONES_UI.md §10.1',
    },
    tabla_cruda: {
        re: /<table/g, dirs: ['pages', 'components'], ext: '.jsx',
        regla: 'Tabla <table> cruda nueva: usa el patrón de tabla estándar — CONVENCIONES_UI.md §10.2',
    },
    cargando_texto: {
        re: /Cargando/g, dirs: ['pages', 'components'], ext: '.jsx',
        regla: 'Texto "Cargando...": usa <Skeleton> de Mantine — CONVENCIONES_UI.md §10.4',
    },
    btn_clase_vieja: {
        re: /className="btn/g, dirs: ['pages'], ext: '.jsx',
        regla: 'className="btn...": usa <Button> de Mantine (hereda la marca del theme) — CONVENCIONES_UI.md §10.3',
    },
    grid_fijo_inline: {
        re: /gridTemplateColumns/g, dirs: ['pages'], ext: '.jsx',
        regla: 'grid fijo inline: usa .split-2 / .cols-2 / .cols-3 / .kpi-grid (responsivas) — CONVENCIONES_UI.md §2',
    },
};

function archivos(dir, ext, acc = []) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) archivos(p, ext, acc);
        else if (f.name.endsWith(ext)) acc.push(p);
    }
    return acc;
}

function contar() {
    const res = {};
    for (const [nombre, m] of Object.entries(METRICAS)) {
        let n = 0;
        for (const d of m.dirs) {
            const dir = path.join(RAIZ, d);
            if (!fs.existsSync(dir)) continue;
            for (const f of archivos(dir, m.ext)) {
                n += (fs.readFileSync(f, 'utf8').match(m.re) || []).length;
            }
        }
        res[nombre] = n;
    }
    return res;
}

const actual = contar();
let base = null;
try { base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) {}

if (!base) {
    fs.writeFileSync(BASELINE, JSON.stringify(actual, null, 2) + '\n');
    console.log('📸 Baseline de estilo creado:', JSON.stringify(actual));
    process.exit(0);
}

let fallos = 0, mejoras = 0;
for (const [k, v] of Object.entries(actual)) {
    const b = base[k] ?? 0;
    if (v > b) { fallos++; console.error(`❌ ${k}: ${b} → ${v} (+${v - b}). ${METRICAS[k].regla}`); }
    else if (v < b) { mejoras++; base[k] = v; }
}
if (mejoras) {
    fs.writeFileSync(BASELINE, JSON.stringify({ ...base, ...Object.fromEntries(Object.entries(actual).filter(([k, v]) => v <= (base[k] ?? 0))) }, null, 2) + '\n');
    console.log('🔧 Trinquete apretado: ' + mejoras + ' métrica(s) bajaron — baseline actualizado.');
}
if (fallos) {
    console.error('\n' + fallos + ' regla(s) de estilo violadas. Las páginas nuevas deben nacer con el sistema de diseño (CONVENCIONES_UI.md §10).');
    process.exit(1);
}
console.log('✓ Estilo UI dentro del baseline (' + Object.entries(actual).map(([k, v]) => k + ':' + v).join(' · ') + ')');
