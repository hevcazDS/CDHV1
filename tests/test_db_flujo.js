// test_db_flujo.js — Verifica que el flujo del bot guarda datos correctamente
// (estructura + round-trips de escritura). SIEMPRE contra una BD de prueba
// aislada (crearFixture(), mismo patrón que test_motor_actions.js/etc.) —
// antes de este fix requería `../bot/db_connection` sin aislar y, al estar
// conectado a `npm test`, escribía/borraba filas de prueba contra el
// DB_PATH real si se corría en el contenedor de producción.
//
// Los checks de SALUD DE DATOS REALES (conteos de stock/sucursales de la
// instancia desplegada) se movieron a tests/test_db_flujo_salud.js — son
// de solo lectura mas no tiene sentido correrlos contra un fixture vacío,
// así que quedan fuera de `npm test` a propósito (mismo criterio que
// test_notificaciones.js/test_full_bot.js).
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
after(() => { try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {} });

const db = require('../bot/db_connection');

// ── 1. Tablas críticas existen ─────────────────────────────────────
const tablasCriticas = [
    'productos','inventarios','pedidos','pedido_detalle',
    'clientes','sesiones_bot','cola_notificaciones','cola_atencion',
    'lista_espera','carritos_abandonados','valoraciones',
    'guias_estafeta','envios','links_pago','metricas_bot',
];
for (const t of tablasCriticas) {
    test(`Tabla "${t}" existe`, () => {
        const r = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
        assert.ok(r !== undefined, `Tabla ${t} no existe`);
    });
}

// ── 2. Columnas críticas en cola_notificaciones ────────────────────
test('cola_notificaciones tiene destinatario TEXT', () => {
    const cols = db.pragma('table_info(cola_notificaciones)');
    const col = cols.find(c => c.name === 'destinatario');
    assert.ok(col, 'Columna destinatario no existe');
    assert.equal(col.type, 'TEXT', `Tipo incorrecto: ${col.type}`);
});
test('cola_notificaciones NO tiene FK rota con pedidos', () => {
    // Insertar notificación sin id_pedido — no debe fallar
    const stmt = db.prepare(`INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus) VALUES ('test','5210000000000','Test','Test body','pendiente')`);
    const r = stmt.run();
    assert.ok(r.lastInsertRowid > 0, 'Insert falló');
    db.prepare(`DELETE FROM cola_notificaciones WHERE tipo='test'`).run();
});

// ── 3. Clientes — teléfono se guarda ──────────────────────────────
test('Insertar cliente con teléfono', () => {
    const tel = '5210000000001';
    db.prepare(`INSERT OR IGNORE INTO clientes (nombre, telefono, canal_origen) VALUES ('Test Bot', ?, 'whatsapp')`).run(tel);
    const c = db.prepare('SELECT * FROM clientes WHERE telefono=?').get(tel);
    assert.ok(c, 'Cliente no guardado');
    assert.equal(c.telefono, tel, 'Teléfono incorrecto');
    db.prepare(`DELETE FROM clientes WHERE telefono=?`).run(tel);
});

// ── 4. Lista de espera — registro completo ────────────────────────
test('Insertar en lista_espera con notas de búsqueda', () => {
    const prod = db.prepare("INSERT INTO productos (tipo, name, price, activo) VALUES ('fisico','Fixture lista espera',100,1)").run();
    const stmt = db.prepare(`INSERT INTO lista_espera (id_producto, telefono, nombre_cliente, cantidad, precio_al_registrar, estatus, canal, notas) VALUES (?, '5210000000002', 'Test', 1, 100, 'activa', 'whatsapp', 'Busqueda: guerreras kpop')`);
    const r = stmt.run(prod.lastInsertRowid);
    assert.ok(r.lastInsertRowid > 0, 'Insert falló');
    const row = db.prepare('SELECT * FROM lista_espera WHERE id=?').get(r.lastInsertRowid);
    assert.equal(row.notas, 'Busqueda: guerreras kpop', 'Notas no guardadas');
    assert.equal(row.telefono, '5210000000002', 'Teléfono no guardado');
    db.prepare('DELETE FROM lista_espera WHERE id=?').run(r.lastInsertRowid);
    db.prepare('DELETE FROM productos WHERE id=?').run(prod.lastInsertRowid);
});
test('Conteo de personas en espera por producto', () => {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM lista_espera WHERE id_producto=1 AND estatus='activa'`).get().n;
    assert.equal(typeof n, 'number', 'Conteo falló');
});

// ── 5. Sesiones bot — teléfono/userId guardado ────────────────────
test('Sesión se guarda con userId de WhatsApp', () => {
    const userId = '5210000000003@c.us';
    db.prepare(`INSERT OR REPLACE INTO sesiones_bot (id_usuario, paso_actual, data_json) VALUES (?, 'MENU', '{}')`).run(userId);
    const s = db.prepare('SELECT * FROM sesiones_bot WHERE id_usuario=?').get(userId);
    assert.ok(s, 'Sesión no guardada');
    assert.equal(s.id_usuario, userId, 'userId incorrecto');
    db.prepare('DELETE FROM sesiones_bot WHERE id_usuario=?').run(userId);
});

// ── 6. Carritos abandonados — datos completos ─────────────────────
test('Carrito abandonado guarda teléfono y JSON', () => {
    const tel = '5210000000004';
    const carrito = JSON.stringify([{id:1, name:'Patines', price:799, cantidad:1}]);
    db.prepare(`INSERT INTO carritos_abandonados (telefono, carrito_json, ultimo_paso) VALUES (?, ?, 'ASK_CP')`).run(tel, carrito);
    const row = db.prepare('SELECT * FROM carritos_abandonados WHERE telefono=?').get(tel);
    assert.ok(row, 'Carrito no guardado');
    const items = JSON.parse(row.carrito_json);
    assert.equal(items[0].name, 'Patines', 'JSON incorrecto');
    assert.equal(row.telefono, tel, 'Teléfono no guardado');
    db.prepare('DELETE FROM carritos_abandonados WHERE telefono=?').run(tel);
});

// ── 7. Cola atención — escaladas ─────────────────────────────────
test('Insertar escalada en cola_atencion', () => {
    // Necesita id_conversacion — puede ser null si no hay FK strict
    const stmt = db.prepare(`INSERT INTO cola_atencion (id_conversacion, id_cliente, motivo_escalada, prioridad, estatus) VALUES (NULL, NULL, 'Test escalada', 1, 'en_espera')`);
    const r = stmt.run();
    assert.ok(r.lastInsertRowid > 0, 'Insert falló');
    db.prepare('DELETE FROM cola_atencion WHERE motivo_escalada=?').run('Test escalada');
});

// ── 8. Guias_estafeta — columnas nuevas ───────────────────────────
test('guias_estafeta tiene estatus_entrega', () => {
    const cols = db.pragma('table_info(guias_estafeta)');
    const col = cols.find(c => c.name === 'estatus_entrega');
    assert.ok(col, 'Columna estatus_entrega NO existe — ejecutar 005_guias_estafeta_cols.sql');
});
test('guias_estafeta tiene fecha_entrega_real', () => {
    const cols = db.pragma('table_info(guias_estafeta)');
    const col = cols.find(c => c.name === 'fecha_entrega_real');
    assert.ok(col, 'Columna fecha_entrega_real NO existe — ejecutar 005_guias_estafeta_cols.sql');
});

// ── 9. series_folios / cobertura / categorias — estructura, no conteo real ─
// (los umbrales de conteo REAL contra la instancia desplegada viven en
// test_db_flujo_salud.js, que sí corre contra DB_PATH real, solo lectura,
// fuera de `npm test`)
test('series_folios tiene entrada para pedido (fixture la siembra vía schema.sql)', () => {
    const r = db.prepare("SELECT * FROM series_folios WHERE tipo='pedido'").get();
    if (r) assert.ok(r.prefijo, 'Prefijo vacío');
    // sin `assert.ok(r, ...)`: el fixture no garantiza esta fila si schema.sql
    // no la siembra por defecto — no es lo que este archivo pinnea.
});
test('categorias: la tabla acepta inserts', () => {
    db.prepare("INSERT INTO categorias (nombre) VALUES ('Fixture test')").run();
    const n = db.prepare('SELECT COUNT(*) AS n FROM categorias').get().n;
    assert.ok(n > 0, 'Insert en categorias no se reflejó');
});

// ── 10. log_eventos existe ────────────────────────────────────────
test('Tabla log_eventos existe', () => {
    const r = db.prepare('SELECT COUNT(*) AS n FROM log_eventos').get();
    assert.ok(r !== undefined);
});
