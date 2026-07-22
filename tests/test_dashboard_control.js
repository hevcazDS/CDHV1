// tests/test_dashboard_control.js — Contrato de los endpoints nuevos de
// control del dashboard: pagos, devoluciones, cola_atencion, promociones.
// Réplica exacta de la lógica SQL de dashboard/server.js (igual que
// test_lealtad.js) — server.js no se puede requerir directo porque levanta
// un servidor HTTP real al cargarse. DB en memoria, no toca producción.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.exec(`
CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, telefono TEXT);
CREATE TABLE pedidos (id_pedido INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT, id_cliente INTEGER,
  estatus TEXT, folio TEXT, actualizado_en TEXT);
CREATE TABLE links_pago (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, monto REAL,
  estatus TEXT, pagado_en TEXT, fecha_expiracion TEXT);
CREATE TABLE cola_notificaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT, destinatario TEXT,
  asunto TEXT, cuerpo TEXT, estatus TEXT, creada_en TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE devoluciones (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, motivo TEXT,
  estatus TEXT DEFAULT 'solicitada', notas TEXT, creada_en TEXT, resuelta_en TEXT);
CREATE TABLE cola_atencion (id INTEGER PRIMARY KEY AUTOINCREMENT, id_cliente INTEGER, motivo_escalada TEXT,
  prioridad INTEGER, estatus TEXT, creada_en TEXT DEFAULT (datetime('now','localtime')), atendida_en TEXT, resuelta_en TEXT);
CREATE TABLE promociones (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, descripcion TEXT, tipo TEXT,
  valor REAL, id_producto INTEGER, id_categoria INTEGER, activa INTEGER DEFAULT 1,
  fecha_inicio TEXT, fecha_fin TEXT, usos_max INTEGER DEFAULT 0, usos_actual INTEGER DEFAULT 0,
  creada_en TEXT DEFAULT (datetime('now','localtime')));
`);

// ── Pagos ─────────────────────────────────────────────────────────
db.prepare("INSERT INTO clientes (nombre,telefono) VALUES ('Ana','5210000000001')").run();
const idCliAna = db.prepare("SELECT id FROM clientes WHERE nombre='Ana'").get().id;
db.prepare("INSERT INTO pedidos (cliente,id_cliente,estatus,folio) VALUES ('Ana',?, 'Pendiente','HEV-PED-1')").run(idCliAna);
const idPedAna = db.prepare("SELECT id_pedido FROM pedidos WHERE folio='HEV-PED-1'").get().id_pedido;
db.prepare("INSERT INTO links_pago (id_pedido,monto,estatus) VALUES (?,599,'generado')").run(idPedAna);
const idLinkAna = db.prepare("SELECT id FROM links_pago WHERE id_pedido=?").get(idPedAna).id;

function marcarPagado(id) {
    db.prepare("UPDATE links_pago SET estatus='pagado', pagado_en=datetime('now','localtime') WHERE id=?").run(id);
    const lp = db.prepare('SELECT * FROM links_pago WHERE id=?').get(id);
    const ped = db.prepare("SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR c.nombre=p.cliente WHERE p.id_pedido=? LIMIT 1").get(lp.id_pedido);
    if (ped && /pendiente/i.test(ped.estatus || '')) {
        db.prepare("UPDATE pedidos SET estatus='confirmado' WHERE id_pedido=?").run(ped.id_pedido);
        if (ped.telefono) db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización pedido','pago recibido','pendiente')").run(ped.telefono);
    }
}

test('marcar-pagado: cambia el link a pagado, avanza el pedido a confirmado y notifica al cliente', () => {
    marcarPagado(idLinkAna);
    assert.ok(db.prepare('SELECT estatus FROM links_pago WHERE id=?').get(idLinkAna).estatus === 'pagado', 'marcar-pagado cambia el link a pagado');
    assert.ok(db.prepare('SELECT estatus FROM pedidos WHERE id_pedido=?').get(idPedAna).estatus === 'confirmado', 'marcar-pagado avanza el pedido a confirmado');
    assert.ok(!!db.prepare("SELECT id FROM cola_notificaciones WHERE destinatario='5210000000001'").get(), 'marcar-pagado notifica al cliente');
});

test('marcar-pagado NO retrocede un pedido que ya iba más adelante (enviado)', () => {
    db.prepare("UPDATE links_pago SET estatus='generado' WHERE id=?").run(idLinkAna);
    db.prepare("UPDATE pedidos SET estatus='enviado' WHERE id_pedido=?").run(idPedAna);
    marcarPagado(idLinkAna);
    assert.ok(db.prepare('SELECT estatus FROM pedidos WHERE id_pedido=?').get(idPedAna).estatus === 'enviado', 'NO retrocede un pedido que ya iba más adelante (enviado)');
});

test('regenerar extiende fecha_expiracion 48h', () => {
    db.prepare("UPDATE links_pago SET estatus='generado', fecha_expiracion='2020-01-01' WHERE id=?").run(idLinkAna);
    const nuevaExp = new Date(Date.now() + 48 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    db.prepare("UPDATE links_pago SET estatus='generado', fecha_expiracion=? WHERE id=?").run(nuevaExp, idLinkAna);
    assert.ok(db.prepare('SELECT fecha_expiracion FROM links_pago WHERE id=?').get(idLinkAna).fecha_expiracion === nuevaExp, 'regenerar extiende fecha_expiracion 48h');
});

test('cancelar marca el link como cancelado', () => {
    db.prepare("UPDATE links_pago SET estatus='cancelado' WHERE id=?").run(idLinkAna);
    assert.ok(db.prepare('SELECT estatus FROM links_pago WHERE id=?').get(idLinkAna).estatus === 'cancelado', 'cancelar marca el link como cancelado');
});

// ── Devoluciones ──────────────────────────────────────────────────
function actualizarDevolucion(id, estatus, notas) {
    const terminal = estatus !== 'solicitada';
    db.prepare("UPDATE devoluciones SET estatus=?, notas=COALESCE(?,notas)" + (terminal ? ", resuelta_en=datetime('now','localtime')" : '') + " WHERE id=?")
      .run(estatus, notas || null, id);
}

test('PUT devoluciones cambia el estatus y marca resuelta_en al pasar a un estatus terminal', () => {
    db.prepare("INSERT INTO devoluciones (id_pedido,motivo,estatus,creada_en) VALUES (?,?,'solicitada',datetime('now','localtime'))").run(idPedAna, 'Producto dañado');
    const idDevAna = db.prepare('SELECT id FROM devoluciones').get().id;
    actualizarDevolucion(idDevAna, 'aprobada', null);
    const devAna = db.prepare('SELECT * FROM devoluciones WHERE id=?').get(idDevAna);
    assert.ok(devAna.estatus === 'aprobada', 'PUT devoluciones cambia el estatus');
    assert.ok(!!devAna.resuelta_en, 'marca resuelta_en al pasar a un estatus terminal');
});

// ── Cola de atención ──────────────────────────────────────────────
test('cola_atencion: GET trae el teléfono del cliente, PUT marca resuelta y desaparece de en_espera', () => {
    db.prepare("INSERT INTO cola_atencion (id_cliente,motivo_escalada,prioridad,estatus) VALUES (?,?,1,'en_espera')").run(idCliAna, 'Quiere hablar con asesor');
    const listaEspera = db.prepare("SELECT ca.*, c.telefono FROM cola_atencion ca LEFT JOIN clientes c ON c.id=ca.id_cliente WHERE ca.estatus='en_espera'").all();
    assert.ok(listaEspera.length === 1 && listaEspera[0].telefono === '5210000000001', 'GET cola_atencion trae el teléfono del cliente');

    const idColaAna = listaEspera[0].id;
    db.prepare("UPDATE cola_atencion SET estatus='resuelta', resuelta_en=datetime('now','localtime') WHERE id=?").run(idColaAna);
    assert.ok(db.prepare('SELECT estatus FROM cola_atencion WHERE id=?').get(idColaAna).estatus === 'resuelta', 'PUT cola_atencion marca resuelta');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM cola_atencion WHERE estatus='en_espera'").get().n === 0, 'ya no aparece en espera');
});

// ── Promociones (admin) ──────────────────────────────────────────
test('promociones: POST crea, PUT desactiva y el filtro ?activa=1 ya no lo incluye', () => {
    db.prepare(`INSERT INTO promociones (codigo,descripcion,tipo,valor,activa,usos_max,usos_actual)
        VALUES ('MANUAL10','Cupón de prueba','porcentaje',10,1,0,0)`).run();
    assert.ok(db.prepare("SELECT COUNT(*) n FROM promociones WHERE codigo='MANUAL10'").get().n === 1, 'POST promociones crea el cupón');

    const idPromoManual = db.prepare("SELECT id FROM promociones WHERE codigo='MANUAL10'").get().id;
    db.prepare('UPDATE promociones SET activa=0 WHERE id=?').run(idPromoManual);
    assert.ok(db.prepare('SELECT activa FROM promociones WHERE id=?').get(idPromoManual).activa === 0, 'PUT promociones desactiva el cupón');

    const activas = db.prepare('SELECT * FROM promociones WHERE activa=1').all();
    assert.ok(!activas.some(p => p.codigo === 'MANUAL10'), 'el filtro ?activa=1 ya no lo incluye tras desactivarlo');
});
