'use strict';
// tests/test_suscripcion_job.js — F6: cobro recurrente automático de suscripciones.
// Prueba services/suscripcionCobro.generarCobrosVencidos (lo que llama el tick de
// stockWatcher): genera pedido + links_pago 'generado', avanza proximo_cobro, y NO
// re-cobra en el siguiente tick.
//   node tests/test_suscripcion_job.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const { generarCobrosVencidos } = require('../services/suscripcionCobro');
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
db.prepare(`INSERT INTO suscripciones (nombre, telefono, concepto, monto, dia_corte, estatus, proximo_cobro)
    VALUES ('Cliente Sub','5218110000000','Plan mensual',300,15,'activa',?)`).run(ayer);

t('genera cargo de la vencida: pedido canal suscripcion + link generado', () => {
    const r = generarCobrosVencidos(db, { username: 'auto' });
    assert.strictEqual(r.generados, 1);
    assert.strictEqual(r.total, 300);
    assert.strictEqual(r.cargos[0].telefono, '5218110000000');

    const ped = db.prepare("SELECT id_pedido, total, canal_creacion FROM pedidos ORDER BY id_pedido DESC LIMIT 1").get();
    assert.strictEqual(ped.canal_creacion, 'suscripcion');
    assert.strictEqual(ped.total, 300);
    const link = db.prepare('SELECT estatus, monto FROM links_pago WHERE id_pedido=?').get(ped.id_pedido);
    assert.strictEqual(link.estatus, 'generado');
    assert.strictEqual(link.monto, 300);
});

t('avanza proximo_cobro un mes (no vuelve a estar vencida)', () => {
    const sub = db.prepare('SELECT proximo_cobro FROM suscripciones LIMIT 1').get();
    const hoy = new Date().toISOString().slice(0, 10);
    assert(sub.proximo_cobro > hoy, 'proximo_cobro debe quedar en el futuro: ' + sub.proximo_cobro);
});

t('segundo tick: no re-cobra (idempotente por proximo_cobro)', () => {
    const pedAntes = db.prepare('SELECT COUNT(*) n FROM pedidos').get().n;
    const r = generarCobrosVencidos(db, { username: 'auto' });
    assert.strictEqual(r.generados, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM pedidos').get().n, pedAntes);
});

t('suscripción suspendida no se cobra', () => {
    db.prepare("INSERT INTO suscripciones (nombre, monto, estatus, proximo_cobro) VALUES ('Suspendida',100,'suspendida',?)").run(ayer);
    const r = generarCobrosVencidos(db, { username: 'auto' });
    assert.strictEqual(r.generados, 0);
});

console.log('\n' + ok + '/4 OK — cobro recurrente automático de suscripciones.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
