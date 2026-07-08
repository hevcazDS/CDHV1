// Contract test Bloques A/B/C: matriz de permisos, PIN de autorización,
// kardex con saldo corrido y nómina MX (con/sin impuestos).
'use strict';
const Database = require('better-sqlite3');
const db = new Database(':memory:');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ok ' + msg); } else { fail++; console.error('  FALLO ' + msg); } };

// 1. Matriz de permisos
const { permite, rangoDe, ROLES_CREABLES_POR_GERENTE } = require('../dashboard/permisos');
ok(permite('cajero', 'pos') && !permite('cajero', 'finanzas'), 'cajero: pos sí, finanzas no');
ok(permite('operador', 'pos') && permite('operador', 'operacion'), 'operador: pos + operación (vende por ambos canales)');
ok(permite('contabilidad', 'finanzas') && permite('contabilidad', 'rrhh') && permite('contabilidad', 'cortes'), 'contabilidad: finanzas + nómina + cortes');
ok(permite('compras', 'compras') && permite('compras', 'almacen_lectura') && !permite('compras', 'almacen'), 'compras: lectura de almacén, sin escritura');
ok(permite('gerente', 'rrhh') && permite('prime', 'almacen'), 'administrador/prime cubren todas las áreas (pyme mínima opera)');
ok(!ROLES_CREABLES_POR_GERENTE.includes('prime') && !ROLES_CREABLES_POR_GERENTE.includes('gerente'), 'administrador no crea pares ni primes');

// 2. PIN de autorización
db.exec("CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT, actualizado_en TEXT)");
const auth = require('../dashboard/autorizacion');
ok(auth.exigirAutorizacion(db, { rol: 'cajero' }, '1234', rangoDe) !== null, 'sin PIN configurado: cajero bloqueado');
ok(auth.exigirAutorizacion(db, { rol: 'gerente' }, null, rangoDe) === null, 'administrador nunca necesita PIN');
auth.setPin(db, '4321');
ok(auth.exigirAutorizacion(db, { rol: 'cajero' }, '4321', rangoDe) === null, 'cajero con PIN correcto pasa');
ok(auth.exigirAutorizacion(db, { rol: 'cajero' }, '9999', rangoDe) !== null, 'PIN incorrecto rechazado');

// 3. Kardex (movimiento + saldo)
db.exec(`CREATE TABLE inventarios (id_producto INTEGER, sucursal TEXT, stock INTEGER, stock_minimo INTEGER DEFAULT 0);
CREATE TABLE inventario_movimientos (id INTEGER PRIMARY KEY, id_producto INTEGER, sucursal TEXT, tipo TEXT,
  cantidad_anterior INTEGER, cantidad_nueva INTEGER, motivo TEXT, creado_por TEXT, creado_en TEXT DEFAULT (datetime('now')));`);
const kardex = require('../services/kardexService');
kardex._setDb(db);
kardex.movimiento({ id_producto: 1, sucursal: 'A', tipo: 'entrada', delta: 10, motivo: 'OC', usuario: 'alm' });
kardex.movimiento({ id_producto: 1, sucursal: 'A', tipo: 'venta', delta: -3, motivo: 'F-1', usuario: 'caj' });
ok(db.prepare("SELECT stock FROM inventarios WHERE id_producto=1").get().stock === 7, 'kardex actualiza stock 0→10→7');
const hist = kardex.kardex(1, 'A');
ok(hist.length === 2 && hist[0].cantidad_nueva === 7 && hist[0].creado_por === 'caj', 'historial con saldo y usuario');

// 4. Nómina: sin impuestos = bruto; con impuestos retiene ISR+IMSS
db.exec(`CREATE TABLE empleados (id INTEGER PRIMARY KEY, nombre TEXT, puesto TEXT, salario_diario REAL,
  con_impuestos INTEGER DEFAULT 0, rfc TEXT, curp TEXT, nss TEXT, activo INTEGER DEFAULT 1);
CREATE TABLE horarios_empleado (id INTEGER PRIMARY KEY, id_empleado INTEGER, fecha TEXT, horas REAL, UNIQUE(id_empleado, fecha));
CREATE TABLE nominas (id INTEGER PRIMARY KEY, id_empleado INTEGER, desde TEXT, hasta TEXT, horas REAL, bruto REAL,
  isr REAL, imss REAL, neto REAL, estatus TEXT DEFAULT 'calculada', pagada_en TEXT, UNIQUE(id_empleado, desde, hasta));`);
const nomina = require('../services/nominaService');
nomina._setDb(db);
db.prepare("INSERT INTO empleados (nombre, salario_diario, con_impuestos) VALUES ('Libre', 400, 0), ('Formal', 400, 1)").run();
for (let d = 1; d <= 6; d++) {
    db.prepare("INSERT INTO horarios_empleado (id_empleado, fecha, horas) VALUES (1, ?, 8), (2, ?, 8)")
      .run(`2026-07-0${d}`, `2026-07-0${d}`);
}
const rs = nomina.calcular('2026-07-01', '2026-07-06');
const libre = rs.find(x => x.nombre === 'Libre'), formal = rs.find(x => x.nombre === 'Formal');
ok(libre.bruto === 2400 && libre.neto === 2400 && libre.isr === 0, 'sin impuestos: 6 días × $400 = $2400 netos');
ok(formal.bruto === 2400 && formal.isr > 0 && formal.imss > 0 && formal.neto < 2400, `con impuestos: retiene ISR $${formal.isr} + IMSS $${formal.imss} → neto $${formal.neto}`);
const pago = nomina.pagar('2026-07-01', '2026-07-06');
ok(pago.pagadas === 2, 'pagar marca el periodo');
ok(nomina.pagar('2026-07-01', '2026-07-06').pagadas === 0, 'no se paga dos veces el mismo periodo');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
