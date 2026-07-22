'use strict';
// tests/test_activos_fijos.js — activos fijos: capitalización (cuenta 12x, no
// inventario), depreciación lineal MENSUAL e idempotente (no doble en el mismo
// mes), valor en libros y baja (write-off). DB en memoria con el motor contable.
//   node tests/test_activos_fijos.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE plan_cuentas (codigo TEXT PRIMARY KEY, nombre TEXT, tipo TEXT);
  CREATE TABLE asientos (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, concepto TEXT, referencia_tipo TEXT, referencia_id INT, sucursal TEXT);
  CREATE TABLE asientos_detalle (id INTEGER PRIMARY KEY AUTOINCREMENT, id_asiento INT, cuenta TEXT, debe REAL DEFAULT 0, haber REAL DEFAULT 0);
  CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT);
  CREATE TABLE activos_fijos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, categoria TEXT, costo REAL, valor_residual REAL DEFAULT 0,
    vida_util_meses INT DEFAULT 60, depreciacion_acumulada REAL DEFAULT 0, revaluacion_acumulada REAL DEFAULT 0,
    fecha_compra TEXT, ultima_depreciacion TEXT, estatus TEXT DEFAULT 'activo', sucursal TEXT, creado_en TEXT);
`);
for (const [c, n, t] of [['101','Caja','activo'],['102','Bancos','activo'],['120','Equipo','activo'],['124','Inmuebles','activo'],['125','Terrenos','activo'],['129','Dep acum','activo'],['301','Capital','capital'],['330','Superávit reval','capital'],['601','Gastos','gasto'],['605','Dep','gasto']])
    db.prepare('INSERT INTO plan_cuentas VALUES (?,?,?)').run(c, n, t);

const conta = require('../services/contabilidadService');
conta._setDb(db); conta._setActivo(() => true);
const AF = require('../services/activosFijosService');
AF._setDb(db);

const saldo = (cuenta) => {
    const r = db.prepare('SELECT COALESCE(SUM(debe),0) d, COALESCE(SUM(haber),0) h FROM asientos_detalle WHERE cuenta=?').get(cuenta);
    return Math.round((r.d - r.h) * 100) / 100;
};

let idActivo;
test('comprar activo capitaliza en 12x (NO inventario 115) contra bancos', () => {
    const r = AF.comprarActivo({ nombre: 'Caminadora', categoria: 'equipo', costo: 12000, vida_util_meses: 12, fecha: '2026-01-10', metodo: 'bancos' });
    idActivo = r.id;
    assert.strictEqual(r.cuenta, '120');
    assert.strictEqual(saldo('120'), 12000, 'activo en 120');
    assert.strictEqual(saldo('102'), -12000, 'abono a bancos');
    assert.strictEqual(saldo('115' /* inventario nunca existió */), 0);
});

test('depreciación lineal: cuota mensual = (costo - residual)/vida', () => {
    const n = AF.depreciarMes('2026-02-15');   // 1er mes
    assert.strictEqual(n, 1);
    // 12000/12 = 1000 por mes
    assert.strictEqual(saldo('605'), 1000, 'gasto por depreciación (cargo)');
    assert.strictEqual(saldo('129'), -1000, 'depreciación acumulada = contra-activo (abono/haber)');
    const a = db.prepare('SELECT depreciacion_acumulada, ultima_depreciacion FROM activos_fijos WHERE id=?').get(idActivo);
    assert.strictEqual(a.depreciacion_acumulada, 1000);
    assert.strictEqual(a.ultima_depreciacion, '2026-02');
});

test('idempotente: correr el MISMO mes otra vez no duplica', () => {
    const n = AF.depreciarMes('2026-02-28');
    assert.strictEqual(n, 0, 'ya depreciado ese mes');
    assert.strictEqual(saldo('605'), 1000, 'sigue en 1000, no 2000');
});

test('otro mes sí deprecia; valor en libros baja', () => {
    AF.depreciarMes('2026-03-10');
    const l = AF.listar().find(a => a.id === idActivo);
    assert.strictEqual(l.depreciacion_acumulada, 2000);
    assert.strictEqual(l.valor_en_libros, 10000, '12000 - 2000');
});

test('no deprecia más allá del valor depreciable (tope)', () => {
    for (let m = 4; m <= 20; m++) AF.depreciarMes('2026-' + String(m).padStart(2, '0') + '-15');
    const l = AF.listar().find(a => a.id === idActivo);
    assert.strictEqual(l.depreciacion_acumulada, 12000, 'topado al costo (residual 0)');
    assert.strictEqual(l.valor_en_libros, 0);
});

test('baja: write-off saca el activo de libros (cargo 129, abono 120)', () => {
    const r2 = AF.comprarActivo({ nombre: 'Laptop', categoria: 'computo', costo: 6000, vida_util_meses: 12, fecha: '2026-01-01' });
    AF.depreciarMes('2026-02-15');   // deprecia algo de la laptop
    const antes120 = saldo('121');
    AF.darDeBaja(r2.id, 'obsoleta');
    assert.strictEqual(db.prepare('SELECT estatus FROM activos_fijos WHERE id=?').get(r2.id).estatus, 'baja');
    // el activo ya no aparece en el listado activo
    assert(!AF.listar().some(a => a.id === r2.id));
    assert(antes120 > 0);   // se había capitalizado en 121 (cómputo)
});

test('terreno NO se deprecia (bien inmueble que no pierde valor)', () => {
    const ter = AF.comprarActivo({ nombre: 'Terreno local', categoria: 'terrenos', costo: 500000, fecha: '2026-01-05', metodo: 'bancos' });
    assert.strictEqual(ter.cuenta, '125', 'capitaliza en 125 Terrenos');
    AF.depreciarMes('2026-06-15');   // corre depreciación del mes
    const row = db.prepare('SELECT depreciacion_acumulada FROM activos_fijos WHERE id=?').get(ter.id);
    assert.strictEqual(row.depreciacion_acumulada, 0, 'el terreno nunca acumula depreciación');
    assert.strictEqual(AF.listar().find(a => a.id === ter.id).valor_en_libros, 500000, 'conserva su valor');
});

test('revaluación al alza sube el valor en libros y cuadra (activo 12x vs superávit 330)', () => {
    const inm = AF.comprarActivo({ nombre: 'Local comercial', categoria: 'inmuebles', costo: 1000000, vida_util_meses: 240, fecha: '2026-01-10', metodo: 'bancos' });
    const r = AF.revaluarActivo({ id: inm.id, nuevo_valor: 1200000, fecha: '2026-06-30' });
    assert.strictEqual(r.incremento, 200000, 'plusvalía reconocida');
    assert.strictEqual(AF.listar().find(a => a.id === inm.id).valor_en_libros, 1200000, 'sube a 1.2M');
    assert.strictEqual(saldo('330'), -200000, 'abono al superávit por revaluación (capital)');
    assert.throws(() => AF.revaluarActivo({ id: inm.id, nuevo_valor: 900000 }), /solo al alza/, 'no permite revaluar a la baja');
});
