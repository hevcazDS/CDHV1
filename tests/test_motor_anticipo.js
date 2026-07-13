'use strict';
// tests/test_motor_anticipo.js — contract test del anticipo de cita (Fase 4, §E.1).
// Prueba la ruta de dinero SELLADA directamente: crear_cita + cobrar_anticipo →
// un pedido normal + link_pago + columnas citas.anticipo/saldo, sin tocar
// inventario. También la barbería-sin-anticipo (porcentaje ausente → sin cobro).
//   node tests/test_motor_anticipo.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const { ACTIONS } = require('../bot/flows/motor/actions');
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

// El fixture trae un servicio 'Corte de cabello' ($150).
const servicio = db.prepare("SELECT id, name, price FROM productos WHERE tipo='servicio' LIMIT 1").get();
const ctxBase = () => ({ userId: 'cita@c.us', tel: '5218110000000', raw: '', data: {
    cita_servicio: servicio.name, cita_servicio_id: servicio.id, cita_servicio_precio: servicio.price,
    cita_fecha: '2025-01-16', cita_hora: '11:00',
} });

t('crear_cita: inserta la cita y devuelve su id', () => {
    const ctx = ctxBase();
    const r = ACTIONS.crear_cita(ctx);
    assert.strictEqual(r.resultado, 'ok');
    assert(r.data.cita_id > 0);
    const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(r.data.cita_id);
    assert.strictEqual(cita.servicio, servicio.name);
    assert.strictEqual(cita.servicio_precio, servicio.price);
});

t('cobrar_anticipo: pedido + link + columnas anticipo/saldo (sin tocar inventario)', () => {
    const ctx = ctxBase();
    ctx.data.cita_id = ACTIONS.crear_cita(ctx).data.cita_id;
    const invAntes = db.prepare("SELECT SUM(stock) s FROM inventarios").get().s;

    const r = ACTIONS.cobrar_anticipo(ctx, { porcentaje: 50 });
    assert.strictEqual(r.resultado, 'cobrar');
    assert.strictEqual(r.data.anticipo, +(servicio.price * 0.5).toFixed(2));
    assert.strictEqual(r.data.saldo, +(servicio.price * 0.5).toFixed(2));
    assert(r.data.link, 'debe devolver un link de pago');

    // El pedido existe con total = anticipo y su link está 'generado'.
    const ped = db.prepare("SELECT p.id_pedido, p.total, p.estatus FROM pedidos p ORDER BY p.id_pedido DESC LIMIT 1").get();
    assert.strictEqual(ped.total, r.data.anticipo);
    const link = db.prepare('SELECT estatus, monto FROM links_pago WHERE id_pedido=?').get(ped.id_pedido);
    assert.strictEqual(link.estatus, 'generado');
    assert.strictEqual(link.monto, r.data.anticipo);

    // La cita quedó ligada por anticipo/saldo (NO por id_pedido — ese es el cobro de mostrador).
    const cita = db.prepare('SELECT anticipo, saldo_pendiente, id_pedido FROM citas WHERE id=?').get(ctx.data.cita_id);
    assert.strictEqual(cita.anticipo, r.data.anticipo);
    assert.strictEqual(cita.saldo_pendiente, r.data.saldo);
    assert.strictEqual(cita.id_pedido, null, 'el anticipo NO debe usar id_pedido');

    // Inventario intacto (es un servicio).
    assert.strictEqual(db.prepare("SELECT SUM(stock) s FROM inventarios").get().s, invAntes);
});

t('barbería sin anticipo: porcentaje ausente → sin_cobro, sin pedido', () => {
    const ctx = ctxBase();
    ctx.data.cita_id = ACTIONS.crear_cita(ctx).data.cita_id;
    const pedAntes = db.prepare('SELECT COUNT(*) n FROM pedidos').get().n;
    const r = ACTIONS.cobrar_anticipo(ctx, {});           // sin porcentaje
    assert.strictEqual(r.resultado, 'sin_cobro');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM pedidos').get().n, pedAntes);
});

console.log('\n' + ok + '/3 OK — anticipo de cita reusa la ruta de dinero sellada.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
