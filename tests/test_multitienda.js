'use strict';
// test_multitienda.js — contract test de la Ola A multitienda (migración 0049).
// Como test_lealtad/test_dashboard_control: BD en memoria con el subset real del
// esquema y el MISMO código de services/sucursalService.js, para fijar el
// contrato "la sesión conoce su tienda" sin tocar producción.
//
//   node tests/test_multitienda.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { sucursalFacturacionDefault, sucursalDeSesion } = require('../services/sucursalService');

const db = new Database(':memory:');
db.exec(`
    CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT, actualizado_en TEXT);
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE);
    CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
        rol TEXT NOT NULL, sucursal TEXT
    );
    CREATE TABLE cortes_caja (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, usuario TEXT,
        total_sistema REAL NOT NULL DEFAULT 0, efectivo_sistema REAL NOT NULL DEFAULT 0,
        efectivo_contado REAL, diferencia REAL, detalle_json TEXT,
        sucursal TEXT, creado_en TEXT
    );
`);
db.prepare("INSERT INTO sucursales (nombre) VALUES ('Centro'), ('Norte')").run();
db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('sucursal_facturacion_default', '1')").run(); // id 1 = Centro
db.prepare("INSERT INTO usuarios (username, rol, sucursal) VALUES ('cajera_norte', 'cajero', 'Norte')").run();
db.prepare("INSERT INTO usuarios (username, rol, sucursal) VALUES ('cajero_viejo', 'cajero', NULL)").run();
db.prepare("INSERT INTO usuarios (username, rol, sucursal) VALUES ('fantasma', 'cajero', 'Sucursal Borrada')").run();

console.log('\n【1】 sucursalFacturacionDefault');
test('resuelve el id guardado al nombre', () => {
    assert(sucursalFacturacionDefault(db) === 'Centro', 'esperaba Centro');
});

console.log('\n【2】 sucursalDeSesion — el contrato de la Ola A');
test('usuario CON sucursal válida → su tienda (no la default)', () => {
    assert(sucursalDeSesion(db, { username: 'cajera_norte' }) === 'Norte', 'esperaba Norte');
});
test('usuario SIN sucursal (pre-multitienda) → default: byte-idéntico', () => {
    assert(sucursalDeSesion(db, { username: 'cajero_viejo' }) === 'Centro', 'esperaba Centro');
});
test('sucursal que ya no existe en el catálogo → default (no truena)', () => {
    assert(sucursalDeSesion(db, { username: 'fantasma' }) === 'Centro', 'esperaba Centro');
});
test('sin sesión → default (no truena)', () => {
    assert(sucursalDeSesion(db, null) === 'Centro', 'esperaba Centro');
});
test('usuario inexistente → default', () => {
    assert(sucursalDeSesion(db, { username: 'nadie' }) === 'Centro', 'esperaba Centro');
});

console.log('\n【3】 cortes_caja por tienda (columna 0049)');
test('el corte persiste la sucursal y se puede filtrar por tienda', () => {
    const ins = db.prepare(`INSERT INTO cortes_caja (fecha, usuario, total_sistema, efectivo_sistema, sucursal)
                            VALUES (?,?,?,?,?)`);
    ins.run('2026-07-11', 'cajera_norte', 500, 500, 'Norte');
    ins.run('2026-07-11', 'cajero_viejo', 300, 300, 'Centro');
    const norte = db.prepare("SELECT COALESCE(SUM(total_sistema),0) t FROM cortes_caja WHERE fecha=? AND sucursal='Norte'").get('2026-07-11').t;
    assert(norte === 500, 'el corte de Norte no debe mezclar el de Centro (esperaba 500, dio ' + norte + ')');
});

console.log('\n【4】 Ola B — compras y mesas por tienda (migración 0050)');
db.exec(`
    CREATE TABLE ordenes_compra (id INTEGER PRIMARY KEY AUTOINCREMENT, folio TEXT, sucursal_destino TEXT);
    CREATE TABLE mesas (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, estatus TEXT DEFAULT 'abierta', sucursal TEXT);
`);
test('recepción de OC: entra a la sucursal DESTINO, no a la default', () => {
    db.prepare("INSERT INTO ordenes_compra (folio, sucursal_destino) VALUES ('OC-1', 'Norte')").run();
    const oc = db.prepare("SELECT * FROM ordenes_compra WHERE folio='OC-1'").get();
    // la semántica de ocRecibir: destino de la OC ‖ tienda de la sesión que recibe
    const donde = oc.sucursal_destino || sucursalDeSesion(db, { username: 'cajero_viejo' });
    assert(donde === 'Norte', 'esperaba Norte, dio ' + donde);
});
test('OC vieja (destino NULL): entra a la tienda de quien recibe → default byte-idéntico', () => {
    db.prepare("INSERT INTO ordenes_compra (folio) VALUES ('OC-2')").run();
    const oc = db.prepare("SELECT * FROM ordenes_compra WHERE folio='OC-2'").get();
    const donde = oc.sucursal_destino || sucursalDeSesion(db, { username: 'cajero_viejo' });
    assert(donde === 'Centro', 'esperaba Centro, dio ' + donde);
});
test('mesas: nacen en el local de quien las abre y el filtro por local no mezcla', () => {
    db.prepare("INSERT INTO mesas (numero, sucursal) VALUES ('M1', ?)").run(sucursalDeSesion(db, { username: 'cajera_norte' }));
    db.prepare("INSERT INTO mesas (numero, sucursal) VALUES ('M2', NULL)").run(); // pre-migración
    // la semántica de listarMesas para no-gerente: mi local + las sin local
    const visibles = db.prepare("SELECT numero FROM mesas WHERE estatus='abierta' AND (sucursal IS NULL OR sucursal=?)").all('Norte').map(m => m.numero);
    assert(visibles.includes('M1') && visibles.includes('M2'), 'la mesera de Norte debe ver M1 y la legacy M2');
    const centro = db.prepare("SELECT numero FROM mesas WHERE estatus='abierta' AND (sucursal IS NULL OR sucursal=?)").all('Centro').map(m => m.numero);
    assert(!centro.includes('M1'), 'la mesa de Norte NO debe verse en Centro');
});

console.log('\n【5】 db/schema.sql declara las columnas de las olas');
test('schema.sql: columnas 0049 (usuarios/cortes) y 0050 (OC/mesas) presentes', () => {
    const fs = require('fs'); const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    const bloque = (tabla) => (sql.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + tabla + '\\s*\\(([\\s\\S]*?)\\n\\);')) || [])[1] || '';
    assert(/\bsucursal\s+TEXT/.test(bloque('usuarios')), 'usuarios.sucursal falta en schema.sql');
    assert(/\bsucursal\s+TEXT/.test(bloque('cortes_caja')), 'cortes_caja.sucursal falta en schema.sql');
    assert(/\bsucursal_destino\s+TEXT/.test(bloque('ordenes_compra')), 'ordenes_compra.sucursal_destino falta en schema.sql');
    assert(/\bsucursal\s+TEXT/.test(bloque('mesas')), 'mesas.sucursal falta en schema.sql');
});

console.log('\n【6】 Ola C — asientos con dimensión tienda (migración 0051)');
db.exec(`
    CREATE TABLE asientos (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL DEFAULT (date('now','localtime')),
        concepto TEXT, referencia_tipo TEXT, referencia_id TEXT, sucursal TEXT, creado_en TEXT);
    CREATE TABLE asientos_detalle (id INTEGER PRIMARY KEY AUTOINCREMENT, id_asiento INTEGER, cuenta TEXT, debe REAL, haber REAL);
    CREATE TABLE plan_cuentas (codigo TEXT PRIMARY KEY, nombre TEXT, tipo TEXT);
    CREATE TABLE pedido_detalle (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, sucursal_origen TEXT);
`);
const conta = require('../services/contabilidadService');
conta._setDb(db); conta._setActivo(() => true);

test('registrarAsiento persiste la sucursal (y NULL cuando no aplica)', () => {
    conta.registrarAsiento({ concepto: 'Venta Norte', partidas: [{ cuenta: '101', debe: 100 }, { cuenta: '401', haber: 100 }], sucursal: 'Norte' });
    conta.registrarAsiento({ concepto: 'Gasto global', partidas: [{ cuenta: '601', debe: 50 }, { cuenta: '101', haber: 50 }] });
    assert(db.prepare("SELECT sucursal FROM asientos WHERE concepto='Venta Norte'").get().sucursal === 'Norte');
    assert(db.prepare("SELECT sucursal FROM asientos WHERE concepto='Gasto global'").get().sucursal === null);
});
test('libroMayor(?, ?, sucursal) filtra por tienda; sin filtro suma todo', () => {
    const todo = conta.libroMayor('2000-01-01', '2999-12-31');
    const norte = conta.libroMayor('2000-01-01', '2999-12-31', 'Norte');
    const c101 = (rows) => rows.find(x => x.cuenta === '101') || { debe: 0, haber: 0 };
    assert(c101(todo).debe === 100 && c101(todo).haber === 50, 'global: debe 100 / haber 50');
    assert(c101(norte).debe === 100 && (c101(norte).haber || 0) === 0, 'Norte: solo su venta, no el gasto global');
});
test('asientoVenta deriva la tienda de pedido_detalle.sucursal_origen', () => {
    db.prepare("INSERT INTO pedido_detalle (id_pedido, sucursal_origen) VALUES (7, 'Norte')").run();
    conta.asientoVenta(7, 100, 'efectivo');
    const a = db.prepare("SELECT sucursal FROM asientos WHERE referencia_tipo='venta' AND referencia_id='7'").get();
    assert(a && a.sucursal === 'Norte', 'el asiento de la venta 7 debe quedar en Norte');
});

console.log('\n【7】 Ola D — espejo sucursal → punto de pickup (migración 0052)');
db.exec(`
    CREATE TABLE cobertura (cp TEXT PRIMARY KEY, estado TEXT, activa INTEGER DEFAULT 1);
    CREATE TABLE puntos_entrega (id INTEGER PRIMARY KEY AUTOINCREMENT, estado TEXT, ciudad TEXT,
        telefono TEXT, horario TEXT, activo INTEGER DEFAULT 1, nombre TEXT, direccion TEXT, maps_url TEXT);
    INSERT INTO cobertura (cp, estado) VALUES ('78', 'San Luis Potosí');
    INSERT INTO puntos_entrega (estado, nombre) VALUES ('San Luis Potosí', 'Sucursal Ya Existente');
`);
// misma lógica que primeCatalogo._espejoPuntoEntrega (contract: fija la semántica)
function espejo(suc) {
    const pref = String(suc.codigo_postal || '').replace(/\D/g, '').slice(0, 2);
    if (pref.length < 2 || !suc.nombre) return;
    const cob = db.prepare('SELECT cp, estado FROM cobertura WHERE activa=1').all().find(r => r.cp && String(r.cp).startsWith(pref));
    if (!cob) return;
    if (db.prepare('SELECT 1 FROM puntos_entrega WHERE nombre=? LIMIT 1').get(suc.nombre)) return;
    db.prepare('INSERT INTO puntos_entrega (estado, activo, nombre, direccion) VALUES (?,1,?,?)').run(cob.estado, suc.nombre, suc.direccion || null);
}
test('sucursal con CP en zona con cobertura → nace su punto de pickup', () => {
    espejo({ nombre: 'Norte', direccion: 'Av. Norte 1', codigo_postal: '78200' });
    const p = db.prepare("SELECT * FROM puntos_entrega WHERE nombre='Norte'").get();
    assert(p && p.estado === 'San Luis Potosí' && p.activo === 1, 'punto espejado con el estado de la cobertura');
});
test('sucursal sin cobertura para su CP → NO espeja (el bot no llega ahí)', () => {
    espejo({ nombre: 'Cancún', codigo_postal: '77500' });
    assert(!db.prepare("SELECT 1 FROM puntos_entrega WHERE nombre='Cancún'").get());
});
test('punto ya existente con ese nombre → no duplica ni toca (JC byte-idéntico)', () => {
    espejo({ nombre: 'Sucursal Ya Existente', codigo_postal: '78000' });
    assert(db.prepare("SELECT COUNT(*) n FROM puntos_entrega WHERE nombre='Sucursal Ya Existente'").get().n === 1);
});
test('sin CP capturado → no espeja (no hay zona que asignar)', () => {
    espejo({ nombre: 'Sin CP' });
    assert(!db.prepare("SELECT 1 FROM puntos_entrega WHERE nombre='Sin CP'").get());
});
