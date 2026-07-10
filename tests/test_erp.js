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
CREATE TABLE nomina_extraordinaria (id INTEGER PRIMARY KEY AUTOINCREMENT, referencia TEXT UNIQUE, id_empleado INTEGER, tipo TEXT, anio INTEGER, monto REAL, id_asiento INTEGER, usuario TEXT, creado_en TEXT);
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
const ag = nomina.pagarAguinaldo(emp, 2025, 6000, 'gerente1');
ok(Number.isInteger(ag.id_asiento) && ag.total === 6000, 'aguinaldo asienta el monto (contabilidad on)');
ok(db.prepare("SELECT usuario FROM nomina_extraordinaria WHERE referencia='aguinaldo_7_2025'").get().usuario === 'gerente1', 'aguinaldo deja registro permanente con usuario');
let agDup = false;
try { nomina.pagarAguinaldo(emp, 2025, 6000, 'gerente1'); } catch (_) { agDup = true; }
ok(agDup, 'aguinaldo idempotente (no se paga dos veces el mismo año)');
// Sin contabilidad: NO se bloquea, queda registrado con id_asiento NULL
conta._setActivo(() => false);
const ag2 = nomina.pagarAguinaldo({ id: 8, nombre: 'Beto', salario_diario: 300 }, 2025, 4500, 'prime1');
ok(ag2.id_asiento === null && ag2.asentado_contable === false && ag2.total === 4500, 'aguinaldo sin contabilidad: pagado y registrado, sin asiento');
ok(!!db.prepare("SELECT 1 FROM nomina_extraordinaria WHERE referencia='aguinaldo_8_2025'").get(), 'aguinaldo sin contabilidad queda en nomina_extraordinaria');
conta._setActivo(() => true);

// 8. Venta a crédito (fiado): devengado (105/401/208) al vender; cobro que
//    salda 105 y pasa el IVA de 208 (no cobrado) a 209 (por pagar).
db.exec("INSERT OR IGNORE INTO plan_cuentas (codigo,nombre,tipo) VALUES ('208','IVA trasladado no cobrado','pasivo')");
const vc = conta.asientoVentaCredito(1001, 116); // IVA 16% → base 100 + iva 16
ok(Number.isInteger(vc), 'venta a crédito asienta (105 Clientes / 401 Ventas + 208 IVA no cobrado)');
ok(conta.asientoVentaCredito(1001, 116) === null, 'venta a crédito idempotente');
const cc = conta.asientoCobroCredito(1001, 116, 'efectivo');
ok(Number.isInteger(cc), 'cobro de crédito asienta (101 Caja / 105 + 208 / 209)');
ok(conta.asientoCobroCredito(1001, 116, 'efectivo') === null, 'cobro de crédito idempotente');
const may2 = conta.libroMayor('2000-01-01', '2999-12-31');
const saldo = (c) => { const r = may2.find(x => x.cuenta === c); return r ? r.saldo : 0; };
ok(Math.abs(saldo('105')) < 0.01, 'CxC (105) queda saldada tras el cobro');
ok(Math.abs(saldo('208')) < 0.01, 'IVA no cobrado (208) queda en cero tras el cobro');
ok(Math.abs(saldo('209') - (-16)) < 0.01, 'IVA por pagar (209) = 16 tras el cobro');
const debe2 = may2.reduce((s, c) => s + c.debe, 0), haber2 = may2.reduce((s, c) => s + c.haber, 0);
ok(Math.abs(debe2 - haber2) < 0.01, 'libro mayor sigue cuadrado con el flujo de crédito');

// 9. Nómina fiscal: séptimo día (semana de 6 días) e incapacidad excluye días
db.exec(`
CREATE TABLE empleados (id INTEGER PRIMARY KEY, nombre TEXT, salario_diario REAL, con_impuestos INTEGER DEFAULT 0, comision_pct REAL DEFAULT 0, username TEXT, activo INTEGER DEFAULT 1, fecha_alta TEXT);
CREATE TABLE horarios_empleado (id INTEGER PRIMARY KEY AUTOINCREMENT, id_empleado INTEGER, fecha TEXT, horas REAL);
CREATE TABLE incapacidades_empleado (id INTEGER PRIMARY KEY AUTOINCREMENT, id_empleado INTEGER, tipo TEXT, desde TEXT, hasta TEXT, folio_imss TEXT);
CREATE TABLE nominas (id INTEGER PRIMARY KEY AUTOINCREMENT, id_empleado INTEGER, desde TEXT, hasta TEXT, horas REAL, horas_extra REAL, comisiones REAL, bruto REAL, isr REAL, imss REAL, neto REAL, prima_dominical REAL DEFAULT 0, imss_patronal REAL DEFAULT 0, septimo_dia REAL DEFAULT 0, estatus TEXT DEFAULT 'calculada', pagada_en TEXT, UNIQUE(id_empleado, desde, hasta));
`);
db.prepare("INSERT INTO configuracion (clave,valor) VALUES ('nomina_fiscal_activo','1')").run();
db.prepare("INSERT INTO empleados (id,nombre,salario_diario,con_impuestos) VALUES (50,'Caro',400,0)").run();
for (const f of ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11']) // Lun–Sáb (6 días)
    db.prepare("INSERT INTO horarios_empleado (id_empleado,fecha,horas) VALUES (50,?,8)").run(f);
const nom = nomina.calcular('2026-07-06', '2026-07-12').find(x => x.id_empleado === 50);
ok(nom && nom.septimo_dia === 400, 'séptimo día = 1 salario por semana de 6 días (dio ' + (nom && nom.septimo_dia) + ')');
ok(nom.prima_dominical === 0, 'sin domingo trabajado → prima dominical 0');
ok(nom.bruto === 2800, 'bruto = 6×día + séptimo día (esperado 2800, dio ' + nom.bruto + ')');
db.prepare("INSERT INTO incapacidades_empleado (id_empleado,tipo,desde,hasta) VALUES (50,'enfermedad_general','2026-07-06','2026-07-07')").run();
const nom2 = nomina.calcular('2026-07-06', '2026-07-12').find(x => x.id_empleado === 50);
ok(nom2.bruto === 1600 && nom2.septimo_dia === 0, 'incapacidad excluye 2 días (bruto 1600, séptimo 0; dio ' + nom2.bruto + '/' + nom2.septimo_dia + ')');

// 10. Asiento de nómina con retenciones + IMSS patronal (601/102/211/210) cuadra
db.exec("INSERT OR IGNORE INTO plan_cuentas (codigo,nombre,tipo) VALUES ('210','IMSS patronal','pasivo'),('211','Retenciones','pasivo')");
db.prepare("INSERT INTO empleados (id,nombre,salario_diario,con_impuestos) VALUES (51,'Fis',400,1)").run();
for (const f of ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']) // Lun-Vie
    db.prepare("INSERT INTO horarios_empleado (id_empleado,fecha,horas) VALUES (51,?,8)").run(f);
nomina.calcular('2026-07-13', '2026-07-17');
nomina.pagar('2026-07-13', '2026-07-17');
const mayN = conta.libroMayor('2000-01-01', '2999-12-31');
const dN = mayN.reduce((s, c) => s + c.debe, 0), hN = mayN.reduce((s, c) => s + c.haber, 0);
ok(Math.abs(dN - hN) < 0.01, 'libro mayor cuadra tras asentar nómina con retenciones/patronal');
ok(!!mayN.find(x => x.cuenta === '210') && !!mayN.find(x => x.cuenta === '211'), 'asiento de nómina usa 210 (IMSS patronal) y 211 (retenciones)');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
