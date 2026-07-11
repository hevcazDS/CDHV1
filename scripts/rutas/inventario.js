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
// Whitelist pública EXACTA y por método — espejo de server.js `esRutaPublica`
// (líneas ~634-641). Coincidencia exacta, no por prefijo (antes '/api/me'
// matcheaba '/api/metricas'/'/api/mesas'). bot/qr NO es pública.
const PUBLICAS = [['POST', '/api/login'], ['POST', '/api/logout'], ['GET', '/api/me'],
    ['GET', '/api/onboarding/estado'], ['POST', '/api/onboarding']];
const esPublica = (met, ruta) => PUBLICAS.some(([m, r]) => r === ruta && (m === met || met === 'ANY'));

const RE_ROUTE = /\bp\s*===|\bp\.match\(|\bp\.startsWith\(/; // "empieza una ruta"

// Gate de un bloque: requireSession(...,[roles]) o permite(rol,'area'). El
// `permite('area')` es el mecanismo real de las áreas especialistas (finanzas/
// pos/almacen/rrhh/compras), no solo requireSession — hay que verlo o el mapa
// de auth miente. Devuelve el rol/área o null.
function gateEn(linea) {
    let g = linea.match(/requireSession\([^,]+,[^,]+,\s*\[([^\]]*)\]\)/);
    if (g) return g[1].replace(/['"\s]/g, '') || null;
    g = linea.match(/permite\([^,]+,\s*'([a-z_]+)'\)/);
    if (g) return g[1];
    return null;
}

// Extrae [{ modulo, archivo, linea, metodo, ruta, tipo, rolMin }]
function extraer() {
    const rutas = [];
    for (const archivo of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js'))) {
        const modulo = archivo.replace('.js', '');
        const lineas = fs.readFileSync(path.join(ROUTES_DIR, archivo), 'utf8').split('\n');
        // Línea de la primera ruta del módulo → todo lo anterior es "cabecera"
        // (filtro de prefijo + posible gate a nivel de módulo).
        let primeraRuta = lineas.length;
        for (let i = 0; i < lineas.length; i++) {
            const L = lineas[i];
            const tieneMet = /req\.method\s*===/.test(L);
            if ((/\bp\s*===/.test(L)) || (/\bp\.match\(/.test(L)) || (/\bp\.startsWith\(/.test(L) && tieneMet && !/!\s*p\.startsWith/.test(L) && !/return next/.test(L))) { primeraRuta = i; break; }
        }
        // Gate a nivel de módulo: escanea la cabecera. Cubre el patrón
        // `if (p.startsWith('/api/x/')...) { requireSession; permite(rol,'area') }`.
        let gateModulo = null;
        for (let i = 0; i < primeraRuta; i++) { const g = gateEn(lineas[i]); if (g) { gateModulo = g; break; } }

        for (let i = 0; i < lineas.length; i++) {
            const L = lineas[i];
            const met = (L.match(/req\.method\s*===\s*'([A-Z]+)'/) || [])[1];
            let m = L.match(/\bp\s*===\s*'([^']+)'/) || L.match(/\bp\s*===\s*"([^"]+)"/);
            let tipo = 'exacta', ruta = m && m[1];
            if (!ruta) { m = L.match(/\bp\.match\(\/([^/]+(?:\\.[^/]*)*)\//); if (m) { ruta = '/' + m[1].replace(/\\\//g, '/').replace(/\^|\$/g, ''); tipo = 'patrón'; } }
            // startsWith SOLO como ruta viva: lleva método, no está negado y no
            // es un `return next()` (esos son guardas de prefijo, no rutas).
            if (!ruta && met && !/!\s*p\.startsWith/.test(L) && !/return next/.test(L)) {
                m = L.match(/\bp\.startsWith\(['"]([^'"]+)['"]\)/); if (m) { ruta = m[1] + '*'; tipo = 'prefijo'; }
            }
            if (!ruta || !ruta.startsWith('/api')) continue;
            // Gate por-ruta: requireSession/permite en el bloque (hasta la
            // próxima ruta). Si no hay, hereda el gate del módulo.
            let rolMin = null;
            for (let j = i; j < Math.min(lineas.length, i + 25); j++) {
                if (j > i && RE_ROUTE.test(lineas[j])) break;
                const g = gateEn(lineas[j]); if (g) { rolMin = g; break; }
            }
            if (!rolMin) rolMin = gateModulo;
            rutas.push({ modulo, archivo, linea: i + 1, metodo: met || 'ANY', ruta, tipo, rolMin, gateModulo: !!gateModulo && rolMin === gateModulo });
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
        const gate = esPublica(r.metodo, r.ruta) ? '🌐pública' : (r.rolMin ? '🔒' + r.rolMin + (r.gateModulo ? '(módulo)' : '') : '·global');
        console.log('  ' + r.metodo.padEnd(6) + ' ' + (r.ruta + (r.tipo === 'prefijo' ? '' : '')).padEnd(42) + ' ' + gate + '  (' + r.archivo + ':' + r.linea + ')');
    }
    // Resumen de cobertura de auth
    const pub = rutas.filter(r => esPublica(r.metodo, r.ruta));
    const conRol = rutas.filter(r => r.rolMin && !esPublica(r.metodo, r.ruta));
    const soloGlobal = rutas.filter(r => !r.rolMin && !esPublica(r.metodo, r.ruta));
    console.log('\n── Cobertura de auth ──');
    console.log('  con gate de rol (por-ruta o módulo): ' + conRol.length);
    console.log('  solo gate global (cualquier sesión): ' + soloGlobal.length);
    console.log('  públicas (sin sesión): ' + pub.length);
    console.log('  Nota: no se detectan gates por PIN (autorizacion.exigir) — esas rutas salen como ·global.');
    if (soloGlobal.length) { console.log('\n  Rutas solo-global (candidatas a revisar rol):'); soloGlobal.forEach(r => console.log('    ' + r.metodo.padEnd(6) + ' ' + r.ruta + '  (' + r.archivo + ':' + r.linea + ')')); }
    if (cols.length) console.log('\n⚠️  ' + cols.length + ' colisión(es) — corre --check para el detalle.');
}

main();
