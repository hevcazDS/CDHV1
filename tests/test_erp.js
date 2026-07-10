// Contract test ERP Fase 6: partida doble cuadra (y rechaza descuadres),
// costeo promedio ponderado correcto, reversa idempotente y libro mayor.
'use strict';
const Database = require('better-sqlite3');
const db = new Database(':memory:');
const fs = require('fs');
const path = require('path');

db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0022_erp_financiero.sql'), 'utf8'));
db.exec(`
CREATE TABLE productos (id INTEGER PRIMARY KEY, name TEXT, price REAL, costo REAL);
CREATE TABLE inventarios (id_producto INTEGER, sucursal TEXT, stock INTEGER);
CREATE TABLE pedido_detalle (id INTEGER PRIMARY KEY, id_pedido INTEGER, id_producto INTEGER, cantidad INTEGER);
CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT);
INSERT INTO configuracion VALUES ('contabilidad_activo','1'), ('iva_pct','16');
`);
db.prepare('INSERT INTO productos VALUES (1, \'Prod\', 100, 40)').run();
db.prepare("INSERT INTO inventarios VALUES (1, 'Centro', 10)").run();
db.prepare('INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad) VALUES (99, 1, 2)').run();

// Servicios con la BD en memoria (mock del módulo de config: activo + IVA 16)
const conta = require('../services/contabilidadService');
const costeo = require('../services/costeoService');
conta._setDb(db); costeo._setDb(db);
conta._setActivo(() => true);

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ok ' + msg); } else { fail++; console.error('  FALLO ' + msg); } };

// 1. Asiento manual cuadrado
const id1 = conta.registrarAsiento({ concepto: 'Capital inicial', partidas: [
    { cuenta: '102', debe: 1000 }, { cuenta: '301', haber: 1000 },
]});
ok(Number.isInteger(id1), 'asiento cuadrado se registra');

// 2. Asiento descuadrado se rechaza
let rechazado = false;
try { conta.registrarAsiento({ concepto: 'Malo', partidas: [{ cuenta: '102', debe: 100 }, { cuenta: '301', haber: 99 }] }); }
catch (_) { rechazado = true; }
ok(rechazado, 'asiento descuadrado se rechaza');

// 3. Costeo promedio ponderado: stock 10 a $40 + entrada 10 a $60 → $50
const r = costeo.registrarEntrada(1, 10, 60, 'test');
ok(r.costo_promedio === 50, `promedio ponderado 10×40 + 10×60 → 50 (dio ${r.costo_promedio})`);
ok(db.prepare('SELECT costo FROM productos WHERE id=1').get().costo === 50, 'productos.costo actualizado');
ok(db.prepare('SELECT COUNT(*) c FROM historial_costos').get().c === 1, 'historial registrado');

// 4. Libro mayor cuadra (suma debe == suma haber)
const mayor = conta.libroMayor('2000-01-01', '2999-12-31');
const debe = mayor.reduce((s, c) => s + c.debe, 0);
const haber = mayor.reduce((s, c) => s + c.haber, 0);
ok(Math.abs(debe - haber) < 0.01, 'libro mayor cuadrado');

// 5. Reversa idempotente: asiento de venta + doble reversa = solo 1 reversa
db.prepare("INSERT INTO asientos (concepto, referencia_tipo, referencia_id) VALUES ('Venta pedido 99','venta','99')").run();
const idA = db.prepare('SELECT last_insert_rowid() i').get().i;
db.prepare('INSERT INTO asientos_detalle (id_asiento, cuenta, debe, haber) VALUES (?,?,?,?)').run(idA, '101', 116, 0);
db.prepare('INSERT INTO asientos_detalle (id_asiento, cuenta, debe, haber) VALUES (?,?,?,?)').run(idA, '401', 0, 100);
db.prepare('INSERT INTO asientos_detalle (id_asiento, cuenta, debe, haber) VALUES (?,?,?,?)').run(idA, '209', 0, 16);
conta.asientoReversa('venta', 99);
conta.asientoReversa('venta', 99);
const reversas = db.prepare("SELECT COUNT(*) c FROM asientos WHERE concepto LIKE 'REVERSA%'").get().c;
ok(reversas === 1, 'reversa idempotente (1 sola aunque se llame 2 veces)');

// 6. Cierre TOTAL de período: un asiento en un mes cerrado se rechaza sin
//    override, y entra con override (backdate a fecha del mes cerrado).
db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('periodo_cerrado','2025-01') ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run();
let cerroBloqueo = false;
try { conta.registrarAsiento({ concepto: 'Gasto ene', fecha: '2025-01-15', partidas: [{ cuenta: '601', debe: 50 }, { cuenta: '101', haber: 50 }] }); }
catch (_) { cerroBloqueo = true; }
ok(cerroBloqueo, 'mes cerrado bloquea sin override');
const idOv = conta.registrarAsiento({ concepto: 'Gasto ene autorizado', fecha: '2025-01-15', override: true, partidas: [{ cuenta: '601', debe: 50 }, { cuenta: '101', haber: 50 }] });
ok(Number.isInteger(idOv), 'mes cerrado admite override autorizado');
ok(db.prepare('SELECT fecha FROM asientos WHERE id=?').get(idOv).fecha === '2025-01-15', 'backdate respeta la fecha capturada');
// un mes NO cerrado (posterior) entra sin override
const idAbierto = conta.registrarAsiento({ concepto: 'Gasto feb', fecha: '2025-02-15', partidas: [{ cuenta: '601', debe: 10 }, { cuenta: '101', haber: 10 }] });
ok(Number.isInteger(idAbierto), 'mes abierto no requiere override');
db.prepare("DELETE FROM configuracion WHERE clave='periodo_cerrado'").run();

// 7. Aguinaldo: asiento 601/102 idempotente por (empleado, año)
const nomina = require('../services/nominaService'); nomina._setDb(db);
const emp = { id: 7, nombre: 'Ana', salario_diario: 400 };
const ag = nomina.pagarAguinaldo(emp, 2025, 6000);
ok(Number.isInteger(ag.id_asiento) && ag.total === 6000, 'aguinaldo asienta el monto');
let agDup = false;
try { nomina.pagarAguinaldo(emp, 2025, 6000); } catch (_) { agDup = true; }
ok(agDup, 'aguinaldo idempotente (no se paga dos veces el mismo año)');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
