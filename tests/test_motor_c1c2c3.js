'use strict';
// tests/test_motor_c1c2c3.js — pendientes CRÍTICOS del editor (MOTOR_EDITOR_PENDIENTES.md):
//   C1: aristas custom desde nodos DELEGADOS disparan ANTES de delegar (y '*' no cuenta ahí).
//   C2: llegar a un nodo delegado por cable despacha su código real (no mensaje vacío).
//   C3: no se puede crear una pieza conversación no-delegada con nombre sellado (ASESOR...).
//   Medias: '*' se ordena al final al guardar; escalada por reintentos nunca es mensaje vacío.
//   node tests/test_motor_c1c2c3.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const G = require('../bot/flows/motor/grafo');
const linter = require('../bot/flows/motor/linter');
const interprete = require('../bot/flows/motor/interprete');
const conf = require('../bot/flows/_config');
const sm = require('../bot/sessionManager');
const { grafoPut } = require('../dashboard/routes/motorFlujo')._test;

let ok = 0;
const pruebas = [];
const t = (n, fn) => pruebas.push([n, fn]);
const ctx = (out) => ({ db, json: (res, d, code) => { out.d = d; out.code = code || 200; }, readJson: (req, res, cb) => cb(req._body) });

// Grafo: MENU delegado (como la plantilla real de JC) + pieza custom PROMO_X.
//   MENU  --kw:promo--> PROMO_X   (cable custom sobre pieza delegada — C1)
//   MENU  --*--> PROMO_X          (comodín sobre delegada: NO debe contar en runtime)
//   PROMO_X --kw:menu--> MENU     (regreso a pieza delegada — C2)
function sembrar() {
    const gid = db.prepare("INSERT INTO flujo_grafo (version, giro_base, activo, valido) VALUES (1,'jugueteria',1,1)").run().lastInsertRowid;
    const nodo = db.prepare('INSERT INTO flujo_nodo (id_grafo, paso, tipo, frase_clave, params_json, es_inicial) VALUES (?,?,?,?,?,?)');
    nodo.run(gid, 'MENU', 'conversacion', null, '{"delegar":true}', 1);
    nodo.run(gid, 'PROMO_X', 'conversacion', 'promo_x', '{}', 0);
    const ari = db.prepare('INSERT INTO flujo_arista (id_grafo, paso, orden, input, destino) VALUES (?,?,?,?,?)');
    ari.run(gid, 'MENU', 1, '*', 'PROMO_X');          // dibujado ANTES a propósito
    ari.run(gid, 'MENU', 2, 'kw:promo', 'PROMO_X');
    ari.run(gid, 'PROMO_X', 1, 'kw:menu', 'MENU');
    G.invalidar();
    return gid;
}
db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('frase_promo_x', '🎉 Promo especial: 2x1 en peluches este fin.')").run();
conf.invalidarCache();
sembrar();

const CX = (U, step, texto) => ({ userId: U, step, action: texto, raw: texto, data: (sm.getSession(U) || {}).data || {}, tel: '5218110009999', message: {} });

t('C1: cable custom kw:promo desde MENU delegado DISPARA', async () => {
    const U = 'c1@c.us'; sm.clearSession(U);
    const r = await interprete.handle(CX(U, 'MENU', 'quiero la promo'));
    assert(/Promo especial/.test(r), 'debe renderizar la pieza custom, no delegar: ' + r);
    assert.strictEqual(sm.getSession(U).paso_actual, 'PROMO_X');
});

t("C1: '*' sobre delegado NO cuenta — '1' sigue cayendo a menuFlow byte-idéntico", async () => {
    const U = 'c1b@c.us'; sm.clearSession(U);
    const r = await interprete.handle(CX(U, 'MENU', '1'));
    assert(typeof r === 'string' && r.length > 0 && !/Promo especial/.test(r), 'debe delegar al código: ' + r);
    assert.notStrictEqual(sm.getSession(U).paso_actual, 'PROMO_X');
});

t('C2: PROMO_X --kw:menu--> MENU delegado despacha su código real (no vacío)', async () => {
    const U = 'c2@c.us'; sm.clearSession(U);
    sm.updateSession(U, 'PROMO_X', {});
    const r = await interprete.handle(CX(U, 'PROMO_X', 'ver menu'));
    assert(typeof r === 'string' && r.trim().length > 0, 'antes del fix esto era "" (bot mudo)');
    // menuFlow corrió de verdad (procesó el texto); lo sellado es que NO quedó mudo ni en PROMO_X
    assert.notStrictEqual(sm.getSession(U).paso_actual, 'PROMO_X');
});

t('escalada por 3 reintentos NUNCA es mensaje vacío', async () => {
    const U = 'esc@c.us'; sm.clearSession(U);
    let r;
    for (let i = 0; i < 3; i++) {
        r = await interprete.handle(CX(U, 'PROMO_X', 'zzz sin sentido'));
        sm.updateSession(U, sm.getSession(U)?.paso_actual || 'PROMO_X', sm.getSession(U)?.data || {});
    }
    assert.strictEqual(sm.getSession(U).paso_actual, 'ASESOR');
    assert(typeof r === 'string' && r.trim().length > 0, 'mensaje de escalada vacío');
});

t('C3 linter: pieza conversación no-delegada llamada ASESOR/SHOW_CART → error', () => {
    for (const paso of ['ASESOR', 'SHOW_CART', 'PAGO_METODO']) {
        const g = { inicial: 'MENU', nodos: { MENU: { paso: 'MENU', tipo: 'conversacion' }, [paso]: { paso, tipo: 'conversacion', params: {} } },
            aristas: { MENU: [{ input: '1', destino: paso }] } };
        assert(linter.validar(g).errs.some(e => e.includes(paso)), paso + ' debió rechazarse');
    }
    // delegado o sistema con ese nombre SÍ pasa (así vienen las plantillas)
    const okG = { inicial: 'MENU', nodos: { MENU: { paso: 'MENU', tipo: 'conversacion' }, ASESOR: { paso: 'ASESOR', tipo: 'conversacion', params: { delegar: true } } },
        aristas: { MENU: [{ input: '1', destino: 'ASESOR' }] } };
    assert.strictEqual(linter.validar(okG).ok, true);
});

t("C1 linter: cable '*' saliendo de pieza delegada → error", () => {
    const g = { inicial: 'MENU', nodos: { MENU: { paso: 'MENU', tipo: 'conversacion', params: { delegar: true } }, X: { paso: 'X', tipo: 'conversacion' } },
        aristas: { MENU: [{ input: '*', destino: 'X' }] } };
    assert(linter.validar(g).errs.some(e => /siempre/.test(e)));
});

t('C3 grafoPut: crear nodo ASESOR conversación → 400', () => {
    const out = {};
    grafoPut({ _body: { nodos: [
        { paso: 'MENU', tipo: 'conversacion', params: { delegar: true }, es_inicial: 1 },
        { paso: 'ASESOR', tipo: 'conversacion', params: {} },
    ], aristas: [{ paso: 'MENU', input: 'kw:ayuda', destino: 'ASESOR' }] } }, null, ctx(out));
    assert.strictEqual(out.code, 400);
    assert(String(out.d.errs || out.d.error).includes('ASESOR'));
});

t("media: al guardar, '*' queda al FINAL aunque se dibuje primero", () => {
    const out = {};
    grafoPut({ _body: { nodos: [
        { paso: 'MENU', tipo: 'conversacion', params: { delegar: true }, es_inicial: 1 },
        { paso: 'PROMO_X', tipo: 'conversacion', frase_clave: 'promo_x', params: {} },
        { paso: 'FIN', tipo: 'conversacion', frase_clave: 'promo_x', params: {} },
    ], aristas: [
        { paso: 'PROMO_X', input: '*', destino: 'FIN' },        // comodín dibujado primero
        { paso: 'PROMO_X', input: '1', destino: 'FIN' },
        { paso: 'MENU', input: 'kw:promo', destino: 'PROMO_X' },
    ] } }, null, ctx(out));
    assert(out.d.ok, JSON.stringify(out.d));
    G.invalidar();
    const g = G.cargarGrafoActivo();
    const inputs = g.aristas.PROMO_X.map(a => a.input);
    assert.deepStrictEqual(inputs, ['1', '*'], 'el comodín debe quedar al final: ' + inputs);
});

t('M4: versiones lista + revertir re-activa una versión anterior (con lint)', () => {
    const { versionesGet, revertirPost } = require('../dashboard/routes/motorFlujo')._test;
    // guardar OTRA versión limpia encima (v3), para revertir a la v2 del test anterior
    const outG = {};
    grafoPut({ _body: { nodos: [
        { paso: 'MENU', tipo: 'conversacion', params: { delegar: true }, es_inicial: 1 },
        { paso: 'PROMO_X', tipo: 'conversacion', frase_clave: 'promo_x', params: {} },
    ], aristas: [{ paso: 'MENU', input: 'kw:promo', destino: 'PROMO_X' }] } }, null, ctx(outG));
    assert(outG.d.ok);
    const out = {};
    versionesGet(null, null, ctx(out));
    assert(out.d.versiones.length >= 3);
    const v2 = out.d.versiones.find(v => v.version === 2);
    const out2 = {};
    revertirPost({ _body: { id: v2.id } }, null, ctx(out2));
    assert(out2.d.ok, JSON.stringify(out2.d));
    assert.strictEqual(db.prepare('SELECT activo FROM flujo_grafo WHERE id=?').get(v2.id).activo, 1);
    // revertir a la ya-activa → 400; y la versión SUCIA (v1, '*' sobre delegado) → 400 por lint
    const out3 = {};
    revertirPost({ _body: { id: v2.id } }, null, ctx(out3));
    assert.strictEqual(out3.code, 400);
    const v1 = out.d.versiones.find(v => v.version === 1);
    const out4 = {};
    revertirPost({ _body: { id: v1.id } }, null, ctx(out4));
    assert.strictEqual(out4.code, 400, 'una versión que ya no pasa el linter no se restaura');
});

t('M2: catálogo de acciones cubre TODO el registro y marca las selladas', () => {
    const { ACTIONS, CATALOGO } = require('../bot/flows/motor/actions');
    for (const k of Object.keys(ACTIONS)) assert(CATALOGO[k], 'acción sin metadata en el catálogo: ' + k);
    assert(CATALOGO.cobrar_anticipo.sellada && CATALOGO.escalar.sellada && CATALOGO.grabar_pedido_pickup.sellada);
    assert(!CATALOGO.buscar_producto.sellada);
    // guardar con acción desconocida → 400 (truena al guardar, no en runtime)
    const out = {};
    grafoPut({ _body: { nodos: [
        { paso: 'MENU', tipo: 'conversacion', params: { delegar: true }, es_inicial: 1 },
        { paso: 'X', tipo: 'conversacion', params: {} },
    ], aristas: [{ paso: 'MENU', input: 'kw:x', destino: 'X', accion: 'accion_inventada' }] } }, null, ctx(out));
    assert.strictEqual(out.code, 400);
});

t('M1 frasesPut: acepta clave del grafo activo, rechaza desconocida', () => {
    const { frasesPut } = require('../dashboard/routes/primeConfig')._test;
    const ctxB = (out) => ({ db, json: (res, d, code) => { out.d = d; out.code = code || 200; }, readBody: (req, cb) => cb(req._rawBody) });
    // el grafo activo (guardado por el test anterior) usa frase_clave 'promo_x'
    const out = {};
    frasesPut({ _rawBody: JSON.stringify({ clave: 'promo_x', texto: 'Texto editado desde el lienzo ✍️' }) }, null, ctxB(out));
    assert(out.d.ok, JSON.stringify(out.d));
    assert.strictEqual(db.prepare("SELECT valor FROM configuracion WHERE clave='frase_promo_x'").get().valor, 'Texto editado desde el lienzo ✍️');
    const out2 = {};
    frasesPut({ _rawBody: JSON.stringify({ clave: 'no_existe_en_nada', texto: 'x' }) }, null, ctxB(out2));
    assert.strictEqual(out2.code, 400);
});

(async () => {
    for (const [n, fn] of pruebas) { await fn(); ok++; console.log('✅ ' + n); }
    console.log('\n' + ok + '/11 OK — C1/C2/C3 + M1/M2/M4 + medias del editor cerrados.');
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
    process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
