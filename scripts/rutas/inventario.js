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
    ['GET', '/api/onboarding/estado'], ['POST', '/api/onboarding'],
    ['GET', '/api/flota/status']]; // hub máquina-a-máquina (token propio)
const esPublica = (met, ruta) => PUBLICAS.some(([m, r]) => r === ruta && (m === met || met === 'ANY'));

const RE_ROUTE = /\bp\s*===|\bp\.match\(|\bp\.startsWith\(/; // "empieza una ruta"

// Gate de un bloque: requireSession(...,[roles]) o permite(rol,'area'). El
// `permite('area')` es el mecanismo real de las áreas especialistas (finanzas/
// pos/almacen/rrhh/compras), no solo requireSession — hay que verlo o el mapa
// de auth miente. Devuelve el rol/área o null.
function gateEn(linea) {
    let g = linea.match(/requireSession\([^,]+,[^,]+,\s*\[([^\]]*)\]\)/);
    if (g) return g[1].replace(/['"\s]/g, '') || null;
    // Todas las áreas permite(...) de la línea, unidas con || (el gate suele ser
    // `permite(x,'pos') || permite(x,'operacion')` — mostrar solo la primera mentía).
    const perms = [...linea.matchAll(/permite\([^,]+,\s*'([a-z_]+)'\)/g)].map(m => m[1]);
    if (perms.length) return [...new Set(perms)].join('||');
    return null;
}

// Extrae [{ modulo, archivo, linea, metodo, ruta, tipo, rolMin }]
function extraer() {
    const rutas = [];
    for (const archivo of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js'))) {
        const modulo = archivo.replace('.js', '');
        // Quita comentarios de línea (preservando el número de línea) para no
        // parsear ejemplos de ruta dentro de comentarios (p.ej. el header de
        // _construirModulo.js). Las rutas nunca llevan '//' en su literal.
        const lineas = fs.readFileSync(path.join(ROUTES_DIR, archivo), 'utf8').split('\n')
            .map(l => { const j = l.indexOf('//'); return j >= 0 ? l.slice(0, j) : l; });
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
            // Formato DECLARATIVO (paso 3, construirModulo): una línea con
            // { metodo:'X', path:'/api/..'|/regex/, area:'y'|roles:[...] }. Se
            // parsea directo del arreglo — más confiable que las cadenas de if.
            const decl = L.match(/metodo:\s*'([A-Z]+)'/);
            if (decl && /path:\s*/.test(L)) {
                const ps = L.match(/path:\s*'([^']+)'/);
                const pr = L.match(/path:\s*\/(.+)\/[a-z]*\s*,/); // literal regex (greedy hasta /flags,)
                let dRuta = null, dTipo = 'exacta';
                if (ps) { dRuta = ps[1]; }
                else if (pr) { dRuta = pr[1].replace(/\\\//g, '/').replace(/[\^$]/g, '').replace(/\([^)]*\)/g, '*'); dTipo = 'patrón'; }
                if (dRuta && dRuta.startsWith('/api')) {
                    const aM = L.match(/\barea:\s*'([a-z_]+)'/);
                    const asM = L.match(/\bareas:\s*\[([^\]]*)\]/);
                    const rM = L.match(/\broles:\s*\[([^\]]*)\]/);
                    const dRol = aM ? aM[1]
                        : asM ? asM[1].replace(/['"\s]/g, '').split(',').filter(Boolean).join('||')
                        : (rM ? rM[1].replace(/['"\s]/g, '') : null);
                    const pin = /\bpin:\s*true/.test(L); // op sensible: el tronco exige PIN
                    rutas.push({ modulo, archivo, linea: i + 1, metodo: decl[1], ruta: dRuta, tipo: dTipo, rolMin: dRol, gateModulo: false, pin });
                    continue;
                }
            }
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

// Sombra exacta-vs-patrón: una ruta EXACTA queda INALCANZABLE si en el MISMO
// módulo+método hay un patrón catch-all (termina en '*') declarado ANTES (línea
// menor) cuyo prefijo la cubre — construirModulo matchea en orden de arreglo y
// retorna al primer match. Es el riesgo que --check antes no veía (comparaba
// solo exactas). Solo patrones con comodín FINAL disparan el chequeo (el
// catch-all real: '/api/puntos/*', '/api/modulo/*'); un patrón con comodín
// intermedio ('/api/x/*/y') no cubre exactas.
function sombras(rutas) {
    const out = [];
    const exactas = rutas.filter(r => r.tipo === 'exacta');
    const catchAlls = rutas.filter(r => (r.tipo === 'patrón' || r.tipo === 'prefijo') && /\*$/.test(r.ruta));
    for (const ex of exactas) {
        for (const pat of catchAlls) {
            if (pat.modulo !== ex.modulo || pat.metodo !== ex.metodo || pat.linea >= ex.linea) continue;
            const base = pat.ruta.replace(/\*$/, '');
            if (base && ex.ruta.startsWith(base)) out.push({ exacta: ex, patron: pat });
        }
    }
    return out;
}

function main() {
    const rutas = extraer().sort((a, b) => a.ruta.localeCompare(b.ruta) || a.metodo.localeCompare(b.metodo));
    const cols = colisiones(rutas);
    const somb = sombras(rutas);

    if (process.argv.includes('--json')) { console.log(JSON.stringify({ rutas, colisiones: cols, sombras: somb }, null, 2)); return; }

    if (process.argv.includes('--check')) {
        if (cols.length) { console.error('❌ ' + cols.length + ' colisión(es) de ruta:'); cols.forEach(c => console.error('  ' + c.clave + ' → ' + c.en.map(x => x.modulo + ':' + x.linea).join(' Y '))); process.exit(1); }
        if (somb.length) { console.error('❌ ' + somb.length + ' ruta(s) exacta(s) sombreada(s) por un catch-all declarado antes (mueve la exacta ARRIBA del patrón):'); somb.forEach(s => console.error('  ' + s.exacta.metodo + ' ' + s.exacta.ruta + ' (' + s.exacta.archivo + ':' + s.exacta.linea + ') ← ' + s.patron.ruta + ':' + s.patron.linea)); process.exit(1); }
        console.log('✓ Sin colisiones ni sombras de ruta (' + rutas.length + ' rutas en ' + new Set(rutas.map(r => r.modulo)).size + ' módulos).');
        return;
    }

    // Índice legible
    console.log('ÍNDICE CANÓNICO DE RUTAS — ' + rutas.length + ' rutas / ' + new Set(rutas.map(r => r.modulo)).size + ' módulos\n');
    let modActual = '';
    for (const r of rutas.sort((a, b) => a.modulo.localeCompare(b.modulo) || a.ruta.localeCompare(b.ruta))) {
        if (r.modulo !== modActual) { modActual = r.modulo; console.log('\n[' + modActual + ']'); }
        const gate = (esPublica(r.metodo, r.ruta) ? '🌐pública' : (r.rolMin ? '🔒' + r.rolMin + (r.gateModulo ? '(módulo)' : '') : '·global')) + (r.pin ? ' 🔐PIN' : '');
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
    console.log('  Nota: el PIN declarativo del tronco (pin:true) se ve como 🔐PIN; el PIN por-handler (autorizacion.exigir dentro del código, p.ej. condicional-por-body) no se detecta.');
    if (soloGlobal.length) { console.log('\n  Rutas solo-global (candidatas a revisar rol):'); soloGlobal.forEach(r => console.log('    ' + r.metodo.padEnd(6) + ' ' + r.ruta + '  (' + r.archivo + ':' + r.linea + ')')); }
    if (cols.length) console.log('\n⚠️  ' + cols.length + ' colisión(es) — corre --check para el detalle.');
}

// Exporta para que otras herramientas (el smoke test) consuman el índice sin
// duplicar el parser. Solo corre main() cuando se invoca como script.
module.exports = { extraer, colisiones, sombras, esPublica };
if (require.main === module) main();
