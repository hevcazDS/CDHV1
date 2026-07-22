'use strict';
// tests/test_motor_fase5.js — Fase 5: siembra de plantilla por giro (onboarding) +
// la guardia de re-lint que usa PUT /api/prime/motor/nodo (un cambio de params que
// invalidaría el grafo NO se persiste). No monta el server HTTP; prueba la lógica
// que los handlers envuelven (seeder + linter), estilo contract test.
//   node --test tests/test_motor_fase5.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const seeder = require('../bot/flows/motor/seeder');
const grafo = require('../bot/flows/motor/grafo');
const linter = require('../bot/flows/motor/linter');

test('sembrarGiro: barbería siembra su delta activo+válido', () => {
    const r = seeder.sembrarGiro(db, 'barberia');
    assert.strictEqual(r.valido, 1, 'errs: ' + JSON.stringify(r.errs));
    grafo.invalidar();
    const g = grafo.cargarGrafoActivo();
    assert(g && g.giro_base === 'barberia');
    assert(g.nodos.CITA_SERVICIO && !g.nodos.WIZARD_Q1, 'barbería tiene CITA_* y no WIZARD');
});

test('sembrarGiro: un giro sin plantilla propia cae a la base JC', () => {
    const r = seeder.sembrarGiro(db, 'abarrotes');   // mapeado a jugueteria
    assert.strictEqual(r.valido, 1);
    grafo.invalidar();
    assert(grafo.cargarGrafoActivo().nodos.WIZARD_Q1, 'la base JC sí trae wizard');
});

test('sembrar activa uno solo: el nuevo grafo desactiva al anterior', () => {
    const activos = db.prepare('SELECT COUNT(*) n FROM flujo_grafo WHERE activo=1').get().n;
    assert.strictEqual(activos, 1, 'debe haber exactamente 1 grafo activo');
});

test('re-lint (guardia del PUT): porcentaje>0 pasa, porcentaje=0 se rechaza', () => {
    // Grafo mínimo con un cobro de anticipo — la regla anti-"vender gratis".
    const conAnticipo = {
        inicial: 'A',
        nodos: { A: { paso: 'A', tipo: 'conversacion' }, B: { paso: 'B', tipo: 'sistema' } },
        aristas: { A: [{ input: '1', destino: 'B', accion: 'cobrar_anticipo', params: { porcentaje: 30 } }] },
    };
    assert.strictEqual(linter.validar(conAnticipo).ok, true, '30% debe ser válido');

    // Simular el cambio que haría nodoPut y que debe RECHAZARSE (no persistir).
    conAnticipo.aristas.A[0].params = { porcentaje: 0 };
    const val = linter.validar(conAnticipo);
    assert.strictEqual(val.ok, false);
    assert(val.errs.some(e => /anticipo sin porcentaje/.test(e)));
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
