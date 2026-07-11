'use strict';
// ─────────────────────────────────────────────────────────────────────────
// ÍNDICE CANÓNICO DE RUTAS — derivado del código, no mantenido a mano.
//
//   node scripts/rutas/inventario.js            → imprime el índice
//   node scripts/rutas/inventario.js --json     → JSON (para otras herramientas)
//   node scripts/rutas/inventario.js --check    → exit≠0 si hay colisiones
//
// Escanea dashboard/routes/*.js y extrae cada ruta (`p === '...'` y
// `p.match(/.../)`), su método, su módulo dueño y si tiene gate de rol
// (`requireSession(...,[...])`). Como se deriva del código, NO puede driftear:
// si mueves/duplicas una ruta, el índice cambia y --check lo detecta.
//
// Nota de auth: server.js aplica un requireSession GLOBAL (cualquier sesión) a
// todo /api/* salvo una whitelist pública (login/logout/me/onboarding*/bot/qr).
// El gate por-ruta que aquí se reporta es el ADICIONAL de rol (gerente/prime…).
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'dashboard', 'routes');
const PUBLICAS = ['/api/login', '/api/logout', '/api/me', '/api/bot/qr']; // + /api/onboarding*

// Extrae [{ modulo, archivo, linea, metodo, ruta, tipo, rolMin }]
function extraer() {
    const rutas = [];
    for (const archivo of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js'))) {
        const modulo = archivo.replace('.js', '');
        const lineas = fs.readFileSync(path.join(ROUTES_DIR, archivo), 'utf8').split('\n');
        for (let i = 0; i < lineas.length; i++) {
            const L = lineas[i];
            // método declarado en la misma condición del if (si lo hay)
            const met = (L.match(/req\.method\s*===\s*'([A-Z]+)'/) || [])[1];
            // ruta exacta: p === '...'
            let m = L.match(/\bp\s*===\s*'([^']+)'/) || L.match(/\bp\s*===\s*"([^"]+)"/);
            let tipo = 'exacta', ruta = m && m[1];
            // ruta por patrón: p.match(/.../)
            if (!ruta) { m = L.match(/\bp\.match\(\/([^/]+(?:\\.[^/]*)*)\//); if (m) { ruta = '/' + m[1].replace(/\\\//g, '/').replace(/\^|\$/g, ''); tipo = 'patrón'; } }
            if (!ruta || !ruta.startsWith('/api')) continue;
            // gate de rol: buscar requireSession en las ~25 líneas siguientes,
            // hasta la próxima condición de ruta.
            let rolMin = null;
            for (let j = i; j < Math.min(lineas.length, i + 25); j++) {
                if (j > i && /\bp\s*===|\bp\.match\(/.test(lineas[j])) break;
                const rs = lineas[j].match(/requireSession\([^,]+,[^,]+(?:,\s*\[([^\]]*)\])?\)/);
                if (rs) { rolMin = rs[1] ? rs[1].replace(/['"\s]/g, '') : 'sesión'; break; }
            }
            rutas.push({ modulo, archivo, linea: i + 1, metodo: met || 'ANY', ruta, tipo, rolMin });
        }
    }
    return rutas;
}

// Colisiones: misma (metodo, ruta exacta) en 2+ módulos/lugares.
function colisiones(rutas) {
    const porClave = {};
    for (const r of rutas) {
        if (r.tipo !== 'exacta') continue;
        const k = r.metodo + ' ' + r.ruta;
        (porClave[k] = porClave[k] || []).push(r);
    }
    return Object.entries(porClave).filter(([, v]) => v.length > 1).map(([k, v]) => ({ clave: k, en: v }));
}

function main() {
    const rutas = extraer().sort((a, b) => a.ruta.localeCompare(b.ruta) || a.metodo.localeCompare(b.metodo));
    const cols = colisiones(rutas);

    if (process.argv.includes('--json')) { console.log(JSON.stringify({ rutas, colisiones: cols }, null, 2)); return; }

    if (process.argv.includes('--check')) {
        if (cols.length) { console.error('❌ ' + cols.length + ' colisión(es) de ruta:'); cols.forEach(c => console.error('  ' + c.clave + ' → ' + c.en.map(x => x.modulo + ':' + x.linea).join(' Y '))); process.exit(1); }
        console.log('✓ Sin colisiones de ruta (' + rutas.length + ' rutas en ' + new Set(rutas.map(r => r.modulo)).size + ' módulos).');
        return;
    }

    // Índice legible
    console.log('ÍNDICE CANÓNICO DE RUTAS — ' + rutas.length + ' rutas / ' + new Set(rutas.map(r => r.modulo)).size + ' módulos\n');
    let modActual = '';
    for (const r of rutas.sort((a, b) => a.modulo.localeCompare(b.modulo) || a.ruta.localeCompare(b.ruta))) {
        if (r.modulo !== modActual) { modActual = r.modulo; console.log('\n[' + modActual + ']'); }
        const gate = r.rolMin ? (r.rolMin === 'sesión' ? '🔒sesión' : '🔒' + r.rolMin) : (PUBLICAS.some(pu => r.ruta.startsWith(pu)) || r.ruta.startsWith('/api/onboarding') ? '🌐pública' : '·global');
        console.log('  ' + r.metodo.padEnd(6) + ' ' + r.ruta.padEnd(42) + ' ' + gate + '  (' + r.archivo + ':' + r.linea + ')');
    }
    // Resumen de cobertura de auth
    const sinGateRol = rutas.filter(r => !r.rolMin && !PUBLICAS.some(pu => r.ruta.startsWith(pu)) && !r.ruta.startsWith('/api/onboarding'));
    console.log('\n── Cobertura de auth ──');
    console.log('  con gate de rol por-ruta: ' + rutas.filter(r => r.rolMin && r.rolMin !== 'sesión').length);
    console.log('  solo gate global (cualquier sesión): ' + sinGateRol.length);
    console.log('  públicas (sin sesión): ' + rutas.filter(r => PUBLICAS.some(pu => r.ruta.startsWith(pu)) || r.ruta.startsWith('/api/onboarding')).length);
    if (cols.length) console.log('\n⚠️  ' + cols.length + ' colisión(es) — corre --check para el detalle.');
}

main();
