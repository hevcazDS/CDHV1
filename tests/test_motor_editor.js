'use strict';
// tests/test_motor_editor.js — editor visual del motor (PUT /api/prime/motor/grafo).
// Prueba el handler directo (sin HTTP) con ctx stub: guardado como versión nueva,
// rechazo del linter, y los CANDADOS de la frontera sellada (§D): no borrar ni
// mutar nodos sistema/delegados, no des-delegar.
//   node tests/test_motor_editor.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const seeder = require('../bot/flows/motor/seeder');
const grafo = require('../bot/flows/motor/grafo');
const { grafoPut } = require('../dashboard/routes/motorFlujo')._test;

let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

// ctx stub: readJson invoca el cb con el body directamente; json captura la salida.
function llamar(body) {
    let out = null, status = 200;
    const ctx = {
        db,
        json: (res, data, code) => { out = data; status = code || 200; },
        readJson: (req, res, cb) => cb(body),
    };
    grafoPut(null, null, ctx);
    return { out, status };
}

// Sembrar la base JC (nodos delegados) como grafo activo.
seeder.sembrar(db, seeder.cargarPlantilla('jugueteria'), { activar: true });
grafo.invalidar();
const base = grafo.cargarGrafoActivo();
const nodosBase = Object.values(base.nodos).map(n => ({
    paso: n.paso, tipo: n.tipo, frase_clave: n.frase_clave, accion_entrada: n.accion_entrada,
    render: n.render, params: n.params, es_inicial: n.es_inicial, pos_x: 100, pos_y: 100,
}));

t('guardar el grafo tal cual → versión nueva activa con posiciones', () => {
    const r = llamar({ nodos: nodosBase, aristas: [] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.out.ok, true);
    assert(r.out.version >= 2, 'debe ser versión nueva');
    grafo.invalidar();
    const g = grafo.cargarGrafoActivo();
    assert.strictEqual(g.id, r.out.id, 'el nuevo es el activo');
    assert.strictEqual(g.nodos.MENU.pos_x, 100, 'posición persistida');
});

t('candado: borrar un nodo delegado se rechaza', () => {
    const sinMenu = nodosBase.filter(n => n.paso !== 'MENU');
    const r = llamar({ nodos: sinMenu, aristas: [] });
    assert.strictEqual(r.status, 400);
    assert(/sellado/.test(r.out.error));
});

t('candado: des-delegar un nodo desde el editor se rechaza', () => {
    const mutado = nodosBase.map(n => n.paso === 'SEARCHING' ? { ...n, params: {} } : n);
    const r = llamar({ nodos: mutado, aristas: [] });
    assert.strictEqual(r.status, 400);
    assert(/des-delegar/.test(r.out.error));
});

t('linter: arista a destino inexistente se rechaza (no persiste)', () => {
    const antes = db.prepare('SELECT COUNT(*) n FROM flujo_grafo').get().n;
    const r = llamar({ nodos: nodosBase, aristas: [{ paso: 'MENU', input: '9', destino: 'NOEXISTE' }] });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM flujo_grafo').get().n, antes, 'nada persistido');
});

t('agregar un nodo de conversación nuevo con arista válida → OK', () => {
    const nuevo = [...nodosBase, { paso: 'PROMO_X', tipo: 'conversacion', frase_clave: 'promo_x', params: {}, es_inicial: false, pos_x: 300, pos_y: 300 }];
    const r = llamar({ nodos: nuevo, aristas: [{ paso: 'MENU', input: 'kw:promo', destino: 'PROMO_X' }, { paso: 'PROMO_X', input: '*', destino: 'MENU' }] });
    assert.strictEqual(r.out.ok, true, JSON.stringify(r.out));
    grafo.invalidar();
    const g = grafo.cargarGrafoActivo();
    assert(g.nodos.PROMO_X, 'el nodo nuevo existe en el grafo activo');
    assert.strictEqual(g.aristas.MENU[0].destino, 'PROMO_X');
});

t('pieza final (params.terminal): sin salida NO avisa; sin el flag SÍ avisa', () => {
    const conFin = [...nodosBase,
        { paso: 'DESPEDIDA', tipo: 'conversacion', frase_clave: 'motor_despedida', params: { terminal: true }, es_inicial: false, pos_x: 1, pos_y: 1 },
        { paso: 'ATORADA', tipo: 'conversacion', frase_clave: 'motor_atorada', params: {}, es_inicial: false, pos_x: 1, pos_y: 1 }];
    const r = llamar({ nodos: conFin, aristas: [
        { paso: 'MENU', input: 'kw:adios', destino: 'DESPEDIDA' },
        { paso: 'MENU', input: 'kw:otra', destino: 'ATORADA' },
    ] });
    assert.strictEqual(r.out.ok, true, JSON.stringify(r.out));
    const warns = r.out.warns || [];
    assert(!warns.some(w => /DESPEDIDA/.test(w)), 'la pieza terminal no debe generar aviso de sin-salida');
    assert(warns.some(w => /ATORADA/.test(w)), 'la pieza sin flag sí debe generar el aviso');
});

console.log('\n' + ok + '/6 OK — editor visual: guardado versionado + candados §D + pieza final.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
