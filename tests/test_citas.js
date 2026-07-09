// Contract test del flujo de citas: slots por capacidad/horario, sin
// double-book, día se agota, recordatorio 24h idempotente.
'use strict';
const Database = require('better-sqlite3');
const Module = require('module');
const db = new Database(':memory:');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ok ' + msg); } else { fail++; console.error('  FALLO ' + msg); } };

db.exec(`
CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telefono TEXT NOT NULL, nombre TEXT, servicio TEXT,
    fecha TEXT NOT NULL, hora TEXT NOT NULL,
    estatus TEXT NOT NULL DEFAULT 'pendiente' CHECK(estatus IN ('pendiente','confirmada','completada','cancelada','no_asistio')),
    notas TEXT, recordatorio_enviado INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE clientes (id INTEGER PRIMARY KEY, telefono TEXT, nombre TEXT, tags TEXT);
CREATE TABLE sesiones_bot (id_usuario TEXT PRIMARY KEY, paso_actual TEXT, data TEXT, actualizado_en TEXT);
`);
// horario 10-13, citas de 60 min, capacidad 1 → slots 10:00 11:00 12:00
db.prepare("INSERT INTO configuracion VALUES ('citas_hora_inicio','10'),('citas_hora_fin','13'),('citas_duracion_min','60'),('citas_capacidad','1')").run();

// interceptar db_connection para que citasFlow use la BD en memoria
const orig = Module._load;
Module._load = function (r, ...a) {
    if (typeof r === 'string' && r.includes('db_connection')) return db;
    return orig.apply(this, [r, ...a]);
};
const citas = require('../bot/flows/citasFlow');
Module._load = orig;

const manana = new Date(Date.now() + 86400000);
const F = new Date(manana.getTime() - manana.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// 1. slots del horario configurado
let slots = citas.slotsLibres(F);
ok(slots.join(',') === '10:00,11:00,12:00', `slots 10-13/60min: ${slots.join(',')}`);

// 2. una cita ocupa su slot (capacidad 1)
db.prepare("INSERT INTO citas (telefono, fecha, hora) VALUES ('521', ?, '11:00')").run(F);
slots = citas.slotsLibres(F);
ok(slots.join(',') === '10:00,12:00', 'slot 11:00 ocupado desaparece');

// 3. cancelada libera el slot
db.prepare("UPDATE citas SET estatus='cancelada' WHERE hora='11:00'").run();
ok(citas.slotsLibres(F).length === 3, 'cancelar libera el slot');

// 4. capacidad 2 admite dos citas en la misma hora
db.prepare("UPDATE configuracion SET valor='2' WHERE clave='citas_capacidad'").run();
db.prepare("INSERT INTO citas (telefono, fecha, hora) VALUES ('522', ?, '10:00'), ('523', ?, '10:00')").run(F, F);
ok(!citas.slotsLibres(F).includes('10:00'), 'capacidad 2: dos citas llenan el slot');
db.prepare("UPDATE configuracion SET valor='1' WHERE clave='citas_capacidad'").run();

// 5. día lleno desaparece de diasDisponibles
db.prepare("INSERT INTO citas (telefono, fecha, hora) VALUES ('524', ?, '11:00'), ('525', ?, '12:00')").run(F, F);
ok(!citas.diasDisponibles().some(d => d.iso === F), 'día lleno no se ofrece');
ok(citas.diasDisponibles().length > 0, 'pero hay otros días disponibles');

// 6. recordatorio 24h: consulta del watcher encuentra solo mañana+no enviadas
const porRecordar = db.prepare(`
    SELECT id FROM citas WHERE estatus IN ('pendiente','confirmada') AND recordatorio_enviado=0
    AND fecha = date('now','localtime','+1 day')`).all();
ok(porRecordar.length === 4, `recordatorio: encuentra las ${porRecordar.length} de mañana`);
db.prepare('UPDATE citas SET recordatorio_enviado=1').run();
ok(db.prepare(`SELECT COUNT(*) c FROM citas WHERE recordatorio_enviado=0 AND fecha=date('now','localtime','+1 day')`).get().c === 0,
   'marcadas → no se duplica el recordatorio');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
