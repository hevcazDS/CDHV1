// test_estres_bd.js — Prueba de estrés del bot contra la base de datos
// ═══════════════════════════════════════════════════════════════════
// A diferencia de test_full_bot.js (que depende de catálogo/datos ya
// sembrados), este test inserta sus propios datos temporales (productos
// de prueba) para no depender de lo que haya o no en la DB en ese
// momento, y los borra todos al final (incluso si algo falla a medio
// camino). Así puede correrse en cualquier momento, contra cualquier
// base ya seedeada, con resultados reproducibles.
//
// Uso:
//   node tests/test_estres_bd.js [usuariosPorOleada] [numOleadas]
//   node tests/test_estres_bd.js 100 5
//
// Por defecto: 50 usuarios concurrentes x 3 oleadas (150 "clientes"
// simulados en total) + una ráfaga de escritura directa sobre
// cola_notificaciones/sesiones_bot para medir contención de SQLite.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Cargar .env PRIMERO — antes de cualquier require ─────────────
const fs_env = require('fs');
const path_env = require('path');
const env_path = path_env.join(__dirname, '..', '.env');
if (fs_env.existsSync(env_path)) {
    const lines = fs_env.readFileSync(env_path, 'utf8').split('\n');
    for (const line of lines) {
        const clean = line.trim();
        if (!clean || clean.startsWith('#')) continue;
        const eq = clean.indexOf('=');
        if (eq < 0) continue;
        const key = clean.slice(0, eq).trim();
        const val = clean.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
    console.log('✅ .env cargado — DB:', process.env.DB_PATH || '(no definido)');
} else {
    console.warn('⚠️  .env no encontrado — usando DB local');
}
if (!process.env.EMAIL_USER)      process.env.EMAIL_USER  = 'test@test.com';
if (!process.env.EMAIL_PASS)      process.env.EMAIL_PASS  = 'test';
if (!process.env.ASESOR_WHATSAPP) process.env.ASESOR_WHATSAPP = '5214441234567';

// SIEMPRE contra una BD de prueba, JAMÁS contra producción — se pisa
// incondicionalmente cualquier DB_PATH real que haya cargado el .env de
// arriba (a diferencia del resto de esta función, que solo rellena lo que
// falte). Mismo fixture real (db/schema.sql completo) que ya usan
// test_motor_actions.js/test_motor_conversaciones.js/etc. — este archivo
// inserta sus propios productos de prueba, así que solo necesita que
// existan las tablas, no datos precargados.
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
console.log('🧪 BD de prueba (aislada, se borra al terminar):', process.env.DB_PATH);
after(() => { try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {} });

const db          = require('../bot/db_connection');
const sessionMgr  = require('../bot/sessionManager');
const { handleAction } = require('../bot/actionHandler');

const C = { ok:'\x1b[32m', fail:'\x1b[31m', warn:'\x1b[33m', info:'\x1b[36m', reset:'\x1b[0m', bold:'\x1b[1m' };

const USUARIOS_POR_OLEADA = parseInt(process.argv[2]) || 50;
const NUM_OLEADAS         = parseInt(process.argv[3]) || 3;
const MARCA   = 'ESTRES_' + Date.now();          // marca única de esta corrida, para limpiar sin tocar nada real
const TEL_PFX = '529999' + String(Date.now()).slice(-6); // prefijo de teléfono de prueba, no usado por clientes reales

// ── Verificar tablas críticas antes de tocar nada ──────────────────
const _tablasReq = ['productos','clientes','pedidos','pedido_detalle','sesiones_bot',
                     'cola_notificaciones','lista_espera','carritos_abandonados'];
for (const t of _tablasReq) {
    try { db.prepare('SELECT 1 FROM ' + t + ' LIMIT 1').get(); }
    catch (e) {
        throw new Error('TABLA FALTANTE: ' + t + ' — este test necesita una base ya seedeada (DB_PATH real), no corre contra una DB vacía.');
    }
}
console.log('✅ Tablas críticas verificadas\n');

// ── Insertar fila respetando NOT NULL desconocidos del esquema real ─
// (no asumimos qué columnas extra pueda tener "productos" en producción;
// PRAGMA table_info nos dice cuáles son obligatorias para no romper el insert)
function insertarFixture(tabla, valoresConocidos) {
    const cols = db.pragma(`table_info(${tabla})`);
    const columnas = [];
    const valores = [];
    for (const c of cols) {
        if (c.pk) continue; // autoincremental, lo deja la DB
        if (Object.prototype.hasOwnProperty.call(valoresConocidos, c.name)) {
            columnas.push(c.name);
            valores.push(valoresConocidos[c.name]);
        } else if (c.notnull && c.dflt_value === null) {
            const tipo = (c.type || '').toUpperCase();
            const relleno = /INT|REAL|NUM|DOUB|FLOAT/.test(tipo) ? 0 : '';
            columnas.push(c.name);
            valores.push(relleno);
        }
    }
    const placeholders = columnas.map(() => '?').join(',');
    const info = db.prepare(`INSERT INTO ${tabla} (${columnas.join(',')}) VALUES (${placeholders})`).run(...valores);
    return info.lastInsertRowid;
}

// ── 1. SQL de datos temporales: productos de prueba con stock ──────
const N_PRODUCTOS_FIXTURE = 5;
const productosFixtureIds = [];
const productosFixtureNombres = [];
console.log(`${C.info}🧪 Insertando ${N_PRODUCTOS_FIXTURE} productos temporales (marca ${MARCA})...${C.reset}`);
for (let i = 0; i < N_PRODUCTOS_FIXTURE; i++) {
    const nombre = `${MARCA}_Producto_${i}`;
    const id = insertarFixture('productos', {
        name: nombre,
        cat: 'EstresTest',
        price: 199 + i * 10,
        activo: 1,
        stock_tienda: 999,
        stock_cedis: 999,
        stock_exhibicion: 0,
        tags: 'estres_test',
        seo_description: 'Producto temporal de prueba de estrés — no es catálogo real',
        ventas_simuladas: 0,
    });
    productosFixtureIds.push(id);
    productosFixtureNombres.push(nombre);
}
console.log(`${C.ok}✅ Fixtures insertados: ${productosFixtureIds.length} productos (ids ${productosFixtureIds.join(',')})${C.reset}\n`);

// ── Limpieza total — se ejecuta siempre, pase lo que pase ───────────
function limpiarFixtures() {
    console.log(`\n${C.info}🧹 Limpiando datos temporales (marca ${MARCA})...${C.reset}`);
    db.pragma('foreign_keys = OFF');
    try {
        const clientesIds = db.prepare("SELECT id FROM clientes WHERE telefono LIKE ?").all(TEL_PFX + '%').map(r => r.id);
        if (clientesIds.length) {
            const ph = clientesIds.map(() => '?').join(',');
            const pedidosIds = db.prepare(`SELECT id_pedido FROM pedidos WHERE id_cliente IN (${ph})`).all(...clientesIds).map(r => r.id_pedido);
            if (pedidosIds.length) {
                const phP = pedidosIds.map(() => '?').join(',');
                db.prepare(`DELETE FROM pedido_detalle WHERE id_pedido IN (${phP})`).run(...pedidosIds);
                try { db.prepare(`DELETE FROM links_pago WHERE id_pedido IN (${phP})`).run(...pedidosIds); } catch (_) {}
                try { db.prepare(`DELETE FROM envios WHERE id_pedido IN (${phP})`).run(...pedidosIds); } catch (_) {}
                try { db.prepare(`DELETE FROM reservas_pickup WHERE id_pedido IN (${phP})`).run(...pedidosIds); } catch (_) {}
                db.prepare(`DELETE FROM pedidos WHERE id_pedido IN (${phP})`).run(...pedidosIds);
            }
            try { db.prepare(`DELETE FROM direcciones_envio WHERE id_cliente IN (${ph})`).run(...clientesIds); } catch (_) {}
            try { db.prepare(`DELETE FROM lista_espera WHERE id_cliente IN (${ph})`).run(...clientesIds); } catch (_) {}
            try { db.prepare(`DELETE FROM valoraciones WHERE id_cliente IN (${ph})`).run(...clientesIds); } catch (_) {}
            try { db.prepare(`DELETE FROM cola_atencion WHERE id_cliente IN (${ph})`).run(...clientesIds); } catch (_) {}
            try { db.prepare(`DELETE FROM preventa_clientes WHERE id_cliente IN (${ph})`).run(...clientesIds); } catch (_) {}
            try { db.prepare(`DELETE FROM log_eventos WHERE id_cliente IN (${ph})`).run(...clientesIds); } catch (_) {}
            try { db.prepare(`DELETE FROM conversaciones WHERE id_cliente IN (${ph})`).run(...clientesIds); } catch (_) {}
            db.prepare(`DELETE FROM clientes WHERE id IN (${ph})`).run(...clientesIds);
        }
        db.prepare("DELETE FROM carritos_abandonados WHERE telefono LIKE ?").run(TEL_PFX + '%');
        db.prepare("DELETE FROM cola_notificaciones WHERE destinatario LIKE ?").run(TEL_PFX + '%');
        db.prepare("DELETE FROM sesiones_bot WHERE id_usuario LIKE ?").run(TEL_PFX + '%');
        try { db.prepare("DELETE FROM log_eventos WHERE telefono LIKE ?").run(TEL_PFX + '%'); } catch (_) {}
        if (productosFixtureIds.length) {
            const phProd = productosFixtureIds.map(() => '?').join(',');
            db.prepare(`DELETE FROM productos WHERE id IN (${phProd})`).run(...productosFixtureIds);
        }
        console.log(`${C.ok}✅ Limpieza completa — sin rastro de la corrida de estrés en la DB${C.reset}`);
    } catch (e) {
        console.error(`${C.fail}❌ Error en limpieza: ${e.message}${C.reset}`);
        console.error(`   Marca de esta corrida: ${MARCA} / prefijo teléfono: ${TEL_PFX} — revisar manualmente si quedó algo.`);
    } finally {
        db.pragma('foreign_keys = ON');
    }
}

// ── Mock de cliente WhatsApp (igual que test_full_bot.js) ──────────
const mockClient = { sendMessage: async (to, msg) => msg, getChats: async () => [] };

async function paso(userId, texto) {
    const session = sessionMgr.getSession(userId);
    const message = { body: texto, hasMedia: false, type: 'chat' };
    return await handleAction(userId, session, message, mockClient);
}

// ── Simula un cliente real: saludo → buscar → ver → agregar → CP ───
async function simularCliente(idx) {
    const userId = `${TEL_PFX}${String(idx).padStart(5, '0')}@c.us`;
    const nombreProd = productosFixtureNombres[idx % productosFixtureNombres.length];
    const t0 = Date.now();
    const tiempos = {};
    try {
        let t = Date.now(); await paso(userId, 'hola');                t = Date.now()-t; tiempos.menu = t;
        t = Date.now(); await paso(userId, '1');                       t = Date.now()-t; tiempos.opcion1 = t;
        t = Date.now(); const rBusq = await paso(userId, nombreProd);  t = Date.now()-t; tiempos.buscar = t;
        t = Date.now(); const rVer  = await paso(userId, '1');         t = Date.now()-t; tiempos.ver = t;
        t = Date.now(); const rAgr  = await paso(userId, '1');         t = Date.now()-t; tiempos.agregar = t;
        t = Date.now(); const rPag  = await paso(userId, '2');         t = Date.now()-t; tiempos.pagar = t;
        t = Date.now(); const rCP   = await paso(userId, '78000');     t = Date.now()-t; tiempos.cp = t;

        const encontroProducto = (rBusq || '').includes(nombreProd.slice(0, 12)) || (rBusq || '').includes('1.');
        sessionMgr.clearSession(userId);
        return { ok: true, ms: Date.now() - t0, tiempos, encontroProducto, respuestas: { rVer, rAgr, rPag, rCP } };
    } catch (e) {
        return { ok: false, ms: Date.now() - t0, error: e.message, userId };
    }
}

// ── Ráfaga de escritura directa — mide contención SQLite/WAL ───────
function rafagaEscrituraDirecta(n) {
    const t0 = Date.now();
    let errores = 0;
    for (let i = 0; i < n; i++) {
        try {
            db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('test',?,?,?,'pendiente')`)
              .run(TEL_PFX + '_raf' + i, MARCA + '_raf', 'mensaje de prueba de estrés');
            db.prepare(`INSERT OR REPLACE INTO sesiones_bot (id_usuario, paso_actual, data_json) VALUES (?, 'MENU', '{}')`)
              .run(`${TEL_PFX}_raf${i}@c.us`);
        } catch (e) { errores++; }
    }
    const ms = Date.now() - t0;
    db.prepare("DELETE FROM cola_notificaciones WHERE asunto=?").run(MARCA + '_raf');
    db.prepare("DELETE FROM sesiones_bot WHERE id_usuario LIKE ?").run(TEL_PFX + '_raf%');
    return { n, ms, errores, opsPorSeg: Math.round((n * 2) / (ms / 1000)) };
}

// ── Orquestación principal ──────────────────────────────────────────
test(`estrés de BD: ${USUARIOS_POR_OLEADA} usuarios x ${NUM_OLEADAS} oleadas`, async () => {
    try {
        console.log(`${C.bold}${C.info}${'═'.repeat(60)}${C.reset}`);
        console.log(`${C.bold}  ESTRÉS: ${USUARIOS_POR_OLEADA} usuarios x ${NUM_OLEADAS} oleadas (${USUARIOS_POR_OLEADA * NUM_OLEADAS} clientes simulados)${C.reset}`);
        console.log(`${C.bold}${C.info}${'═'.repeat(60)}${C.reset}\n`);

        const resultados = [];
        for (let ola = 0; ola < NUM_OLEADAS; ola++) {
            console.log(`${C.info}— Oleada ${ola + 1}/${NUM_OLEADAS}: lanzando ${USUARIOS_POR_OLEADA} clientes concurrentes —${C.reset}`);
            const tOla = Date.now();
            const idxBase = ola * USUARIOS_POR_OLEADA;
            const promesas = [];
            for (let i = 0; i < USUARIOS_POR_OLEADA; i++) promesas.push(simularCliente(idxBase + i));
            const r = await Promise.all(promesas);
            resultados.push(...r);
            console.log(`  oleada completada en ${Date.now() - tOla} ms`);
        }

        const exitosos = resultados.filter(r => r.ok);
        const fallidos  = resultados.filter(r => !r.ok);
        const tiemposMs = exitosos.map(r => r.ms);
        const prom = tiemposMs.length ? Math.round(tiemposMs.reduce((a, b) => a + b, 0) / tiemposMs.length) : 0;
        const max  = tiemposMs.length ? Math.max(...tiemposMs) : 0;
        const encontraron = exitosos.filter(r => r.encontroProducto).length;

        console.log(`\n${C.bold}${'─'.repeat(60)}${C.reset}`);
        console.log(`${C.bold}  RESULTADOS — flujo completo por cliente simulado${C.reset}`);
        console.log('─'.repeat(60));
        console.log(`  Total clientes simulados : ${resultados.length}`);
        console.log(`  ${C.ok}Completaron el flujo sin error : ${exitosos.length}${C.reset}`);
        console.log(`  ${fallidos.length ? C.fail : C.ok}Tiraron error a medio flujo     : ${fallidos.length}${C.reset}`);
        console.log(`  Encontraron su producto de prueba en la búsqueda : ${encontraron}/${exitosos.length}`);
        console.log(`  Tiempo promedio por cliente (flujo de 7 pasos)   : ${prom} ms`);
        console.log(`  Tiempo máximo por cliente                       : ${max} ms`);
        if (fallidos.length) {
            console.log(`\n  ${C.fail}Primeros errores:${C.reset}`);
            fallidos.slice(0, 5).forEach(f => console.log(`    - ${f.userId}: ${f.error}`));
        }

        console.log(`\n${C.info}— Ráfaga de escritura directa (sesiones_bot + cola_notificaciones) —${C.reset}`);
        const N_RAFAGA = USUARIOS_POR_OLEADA * 4;
        const raf = rafagaEscrituraDirecta(N_RAFAGA);
        console.log(`  ${raf.n * 2} escrituras en ${raf.ms} ms (~${raf.opsPorSeg} ops/seg), ${raf.errores ? C.fail : C.ok}${raf.errores} errores${C.reset}`);

        console.log(`\n${'═'.repeat(60)}`);
        if (fallidos.length === 0 && raf.errores === 0) {
            console.log(`  ${C.ok}${C.bold}✅ El bot soportó la carga sin errores contra la base de datos${C.reset}`);
        } else {
            console.log(`  ${C.fail}${C.bold}❌ Hubo errores bajo carga — revisar arriba${C.reset}`);
        }
        console.log('═'.repeat(60) + '\n');

        assert.equal(fallidos.length, 0, `${fallidos.length} clientes simulados tiraron error a medio flujo`);
        assert.equal(raf.errores, 0, `${raf.errores} errores en la ráfaga de escritura directa`);
    } finally {
        limpiarFixtures();
    }
});
