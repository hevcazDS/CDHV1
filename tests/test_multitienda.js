'use strict';
// test_multitienda.js — contract test de la Ola A multitienda (migración 0049).
// Como test_lealtad/test_dashboard_control: BD en memoria con el subset real del
// esquema y el MISMO código de services/sucursalService.js, para fijar el
// contrato "la sesión conoce su tienda" sin tocar producción.
//
//   node tests/test_multitienda.js
const Database = require('better-sqlite3');
const { sucursalFacturacionDefault, sucursalDeSesion } = require('../services/sucursalService');

let pasa = 0, falla = 0;
function test(nombre, fn) {
    try { fn(); pasa++; console.log('  ✅ ' + nombre); }
    catch (e) { falla++; console.log('  ❌ ' + nombre + ': ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'aserción falló'); }

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

console.log(`\nRESULTADO: ${pasa} ✅  |  ${falla} ❌`);
process.exit(falla ? 1 : 0);
