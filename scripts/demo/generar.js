'use strict';
// ─────────────────────────────────────────────────────────────────────────
// ORQUESTADOR DEL DEMO — clona la BD real una vez por giro y la siembra.
//
//   node scripts/demo/generar.js                 → genera todos los giros
//   node scripts/demo/generar.js abarrotes carniceria   → solo esos
//   node scripts/demo/generar.js --limpiar        → borra demo/ (reversible)
//
// Cada giro queda en demo/<giro>.db (carpeta gitignoreada, *.db). El clon de
// 'jugueteria' CONSERVA los datos reales de Julio Cepeda (solo resetea las
// claves demo a 123). Los demás se vacían y se llenan con su propio catálogo
// + un año de operación. Nada toca la BD real de producción.
// ─────────────────────────────────────────────────────────────────────────

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');
const DEMO_DIR = path.join(RAIZ, 'demo');
const REAL = process.env.DB_PATH;

const TODOS = ['jugueteria', 'restaurante', 'abarrotes', 'carniceria', 'ferreteria',
    'barberia', 'estetica', 'servicios', 'retail', 'tatuajes', 'unas', 'mantenimiento', 'isp', 'custom'];

function limpiar() {
    if (fs.existsSync(DEMO_DIR)) { fs.rmSync(DEMO_DIR, { recursive: true, force: true }); console.log('[demo] carpeta demo/ eliminada.'); }
    else console.log('[demo] no hay carpeta demo/ que limpiar.');
}

function generar(giros) {
    if (!REAL || !fs.existsSync(REAL)) { console.error('[demo] DB_PATH real no encontrada: ' + REAL); process.exit(1); }
    fs.mkdirSync(DEMO_DIR, { recursive: true });
    for (const giro of giros) {
        const destino = path.join(DEMO_DIR, giro + '.db');
        // limpiar clon previo + WAL/SHM
        for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(destino + ext); } catch (_) {} }
        fs.copyFileSync(REAL, destino);
        process.stdout.write('[demo] ' + giro.padEnd(14) + ' clonado → sembrando... ');
        try {
            const out = execFileSync('node', [path.join(__dirname, 'seed.js'), destino, giro], { cwd: RAIZ, encoding: 'utf8' });
            process.stdout.write(out.trim().split('\n').pop() + '\n');
        } catch (e) { process.stdout.write('ERROR: ' + (e.stdout || e.message) + '\n'); }
    }
    // índice de giros disponibles para el hub (servir.js)
    fs.writeFileSync(path.join(DEMO_DIR, 'giros.json'), JSON.stringify(giros, null, 2));
    console.log('[demo] listo — ' + giros.length + ' giro(s) en ' + DEMO_DIR);
}

const args = process.argv.slice(2);
if (args.includes('--limpiar')) {
    limpiar();
} else {
    const giros = args.filter(a => !a.startsWith('--'));
    generar(giros.length ? giros : TODOS);
}
