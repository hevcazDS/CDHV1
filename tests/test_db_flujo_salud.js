// test_db_flujo_salud.js — Salud de DATOS REALES de esta instancia desplegada
// (no del código). Separado de test_db_flujo.js (que sí es parte de `npm
// test`, corre contra un fixture aislado): estos checks pinnean hechos de
// negocio de la instancia real (ej. "al menos 277 productos con stock"),
// que nunca serán ciertos contra una BD de prueba vacía — no tiene sentido
// aislarlos, y correrlos aislados los haría fallar siempre por diseño.
//
// SOLO LECTURA (ningún INSERT/UPDATE/DELETE) — seguro de correr contra
// DB_PATH real, pero de todos modos NO está en la cadena `npm test` a
// propósito (mismo criterio que test_notificaciones.js/test_full_bot.js/
// test_rutas_smoke.js): es un chequeo operativo de ESTA instancia, no una
// prueba de regresión del código, y no debe bloquear un `npm test` limpio
// en un checkout nuevo o una instancia recién clonada sin catálogo aún.
//
// Uso manual: node --test tests/test_db_flujo_salud.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../bot/db_connection');

test('Productos tienen stock_tienda > 0 (al menos 277)', () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM productos WHERE activo=1 AND stock_tienda > 0').get().n;
    assert.ok(n >= 277, `Solo ${n} productos con stock_tienda > 0`);
});
test('Inventarios tiene registros por sucursal', () => {
    const sucursales = db.prepare('SELECT COUNT(DISTINCT sucursal) AS n FROM inventarios').get().n;
    assert.ok(sucursales >= 11, `Solo ${sucursales} sucursales en inventarios`);
});
test('stock_san_luis_potosi sincronizado en al menos 277 productos', () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM productos WHERE activo=1 AND stock_san_luis_potosi > 0').get().n;
    assert.ok(n >= 277, `Solo ${n} productos con stock SLP`);
});
test('series_folios tiene entrada para pedido', () => {
    const r = db.prepare("SELECT * FROM series_folios WHERE tipo='pedido'").get();
    assert.ok(r, 'No hay serie de folios para pedidos');
    assert.ok(r.prefijo, 'Prefijo vacío');
});
test('series_folios tiene entrada para lista_espera', () => {
    const r = db.prepare("SELECT * FROM series_folios WHERE tipo='lista_espera'").get();
    assert.ok(r, 'No hay serie de folios para lista_espera — stockService no podrá generar folios ESP-');
});
test('cobertura tiene registros activos', () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM cobertura WHERE activa=1').get().n;
    assert.ok(n >= 10, `Solo ${n} registros de cobertura`);
});
test('categorias tiene datos', () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM categorias').get().n;
    assert.ok(n > 0, 'Sin categorías');
});
test('WARN: log_eventos vacío — las búsquedas no se están registrando', () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM log_eventos').get().n;
    if (n === 0) {
        console.log('    ⚠️  log_eventos está vacío — agregar registro de búsquedas en searchProducts()');
    }
    // no falla, solo advierte
});
