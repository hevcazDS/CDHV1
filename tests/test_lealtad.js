// tests/test_lealtad.js — Pruebas del cupón de lealtad de 10%
// Autocontenido: usa una DB SQLite en memoria, NO toca la base de producción.
// Replica el INSERT de recompensa de puntosService.js y la lógica de
// aplicarCupon (_shared.js) para fijar el contrato del cupón de 10%.
'use strict';
const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.exec(`
CREATE TABLE regalos_lealtad (id INTEGER PRIMARY KEY AUTOINCREMENT, id_cliente INTEGER, telefono TEXT,
  codigo_cupon TEXT, valor REAL, puntos_usados INTEGER, expira_en TEXT, estatus TEXT DEFAULT 'activo');
CREATE TABLE promociones (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, tipo TEXT, valor REAL,
  id_producto INTEGER, fecha_inicio TEXT, fecha_fin TEXT, usos_max INTEGER DEFAULT 0, usos_actual INTEGER DEFAULT 0, activa INTEGER DEFAULT 1);
`);

const PCT_DESCUENTO = 10, PUNTOS_REGALO = 2000;

// Réplica EXACTA del bloque de emisión de cupón de puntosService.js
function emitirCupon(idCliente, tel) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let cupon = 'LEAL-';
    for (let i = 0; i < 6; i++) cupon += chars[Math.floor(Math.random() * chars.length)];
    const hoy = new Date().toISOString().slice(0, 10);
    const expira = new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO promociones (codigo, tipo, valor, id_producto, fecha_inicio, fecha_fin, usos_max, usos_actual, activa)
                VALUES (?, 'porcentaje', ?, NULL, ?, ?, 1, 0, 1)`).run(cupon, PCT_DESCUENTO, hoy, expira);
    db.prepare(`INSERT INTO regalos_lealtad (id_cliente, telefono, codigo_cupon, valor, puntos_usados, expira_en)
                VALUES (?, ?, ?, ?, ?, ?)`).run(idCliente, tel, cupon, PCT_DESCUENTO, PUNTOS_REGALO, expira);
    return cupon;
}

// Réplica del cálculo de aplicarCupon (_shared.js)
function aplicarCupon(codigo, subtotal) {
    const hoy = new Date().toISOString().slice(0, 10);
    const promo = db.prepare(`SELECT * FROM promociones WHERE UPPER(codigo)=UPPER(?) AND activa=1
        AND (fecha_inicio IS NULL OR fecha_inicio <= ?) AND (fecha_fin IS NULL OR fecha_fin >= ?)
        AND (usos_max=0 OR usos_actual < usos_max) LIMIT 1`).get(codigo.trim(), hoy, hoy);
    if (!promo) return { ok: false, error: 'Código no válido o expirado' };
    const desc = promo.tipo === 'porcentaje' ? subtotal * (promo.valor / 100) : Math.min(promo.valor, subtotal);
    return { ok: true, promo, descuento: parseFloat(desc.toFixed(2)) };
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

console.log('\nSuite: Cupón de lealtad 10%\n');

const codigo = emitirCupon(1, '5214441234567');
ok(/^LEAL-[A-Z0-9]{6}$/.test(codigo), 'código formato LEAL-XXXXXX: ' + codigo);
const promo = db.prepare('SELECT * FROM promociones WHERE codigo=?').get(codigo);
ok(promo.tipo === 'porcentaje', "tipo = 'porcentaje'");
ok(promo.valor === 10, 'valor = 10');
ok(promo.usos_max === 1, 'usos_max = 1 (no acumulable)');
ok(promo.id_producto === null, 'id_producto NULL (aplica al total)');
const reg = db.prepare('SELECT * FROM regalos_lealtad WHERE codigo_cupon=?').get(codigo);
ok(reg.valor === 10, 'regalos_lealtad.valor = 10');

ok(aplicarCupon(codigo, 1000).descuento === 100, '10% de $1000 = $100');
ok(aplicarCupon(codigo, 599).descuento === 59.9, '10% de $599 = $59.90');

db.prepare('UPDATE promociones SET usos_actual=usos_actual+1 WHERE id=?').run(promo.id);
ok(!aplicarCupon(codigo, 1000).ok, 'segundo uso rechazado (usos_max=1)');

db.prepare(`INSERT INTO promociones (codigo,tipo,valor,fecha_inicio,fecha_fin,usos_max,usos_actual,activa)
            VALUES ('LEAL-EXPIRD','porcentaje',10,'2020-01-01','2020-02-01',1,0,1)`).run();
ok(!aplicarCupon('LEAL-EXPIRD', 1000).ok, 'cupón expirado rechazado');

console.log('\nResultado: ' + pass + ' pass, ' + fail + ' fail\n');
process.exit(fail ? 1 : 0);
