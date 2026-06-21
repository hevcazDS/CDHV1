// tests/test_marketing.js — Contrato de las piezas de marketing/psicología
// agregadas: prueba social en catálogo, cupón de 24h por carrito abandonado,
// y reactivación de clientes dormidos sin chocar con masivos.
// Usa una DB SQLite real en memoria (DB_PATH=':memory:') y llama las
// funciones reales de stockWatcher.js — NO toca la base de producción.
'use strict';
process.env.DB_PATH = ':memory:';

const db = require('../bot/db_connection');
const { formatProducts } = require('../bot/flows/_shared');
const stockWatcher = require('../services/stockWatcher');

db.exec(`
CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, telefono TEXT, tags TEXT, activo INTEGER DEFAULT 1);
CREATE TABLE pedidos (id_pedido TEXT PRIMARY KEY, id_cliente INTEGER, cliente TEXT, creado_en TEXT);
CREATE TABLE promociones (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, tipo TEXT, valor REAL,
  id_producto INTEGER, fecha_inicio TEXT, fecha_fin TEXT, usos_max INTEGER DEFAULT 0, usos_actual INTEGER DEFAULT 0, activa INTEGER DEFAULT 1);
CREATE TABLE cola_notificaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT, destinatario TEXT, asunto TEXT,
  cuerpo TEXT, estatus TEXT, id_pedido TEXT, enviar_despues_de TEXT, creada_en TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE carritos_abandonados (id INTEGER PRIMARY KEY AUTOINCREMENT, telefono TEXT, carrito_json TEXT,
  abandonado_en TEXT, notificado INTEGER DEFAULT 0, notificado_en TEXT, convertido INTEGER DEFAULT 0);
CREATE TABLE tickets_venta (id INTEGER PRIMARY KEY AUTOINCREMENT, id_promocion INTEGER);
`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

console.log('\nSuite: prueba social, cupón 24h y reactivación de dormidos\n');

// ── 1. Prueba social en catálogo (ventas_simuladas) ────────────────
const conVentas = formatProducts([{ name: 'Bici Rodada 16', cat: 'Bicicletas', price: 1200, ventas_simuladas: 45 }]);
ok(conVentas.includes('🔥 45 vendidos'), 'muestra "vendidos" cuando ventas_simuladas > 20');
const sinVentas = formatProducts([{ name: 'Carrito básico', cat: 'Otros', price: 100, ventas_simuladas: 3 }]);
ok(!sinVentas.includes('vendidos'), 'no muestra "vendidos" cuando ventas_simuladas <= 20');
const sinDato = formatProducts([{ name: 'Sin dato', cat: 'Otros', price: 50 }]);
ok(!sinDato.includes('vendidos'), 'no rompe ni muestra "vendidos" si ventas_simuladas no viene en la fila');

// ── 2. Cupón de 5% a las 24h de carrito abandonado ──────────────────
const insCarrito = db.prepare(`INSERT INTO carritos_abandonados (telefono, carrito_json, abandonado_en, notificado, convertido)
    VALUES (?, ?, datetime('now','localtime','-25 hours'), 1, 0)`);
const tel24h = '5214440000001@c.us';
insCarrito.run(tel24h, JSON.stringify([{ name: 'Lego Set', id: 1 }]));

stockWatcher.checkCarritosAbandonados24h();
const promo24h = db.prepare("SELECT * FROM promociones WHERE codigo LIKE 'VUELVE-%'").get();
ok(!!promo24h, 'genera un código de cupón VUELVE-XXXXX');
ok(promo24h && promo24h.valor === 5 && promo24h.tipo === 'porcentaje', 'cupón es 5% porcentaje');
ok(promo24h && promo24h.usos_max === 1, 'cupón de un solo uso');
const notif24h = db.prepare("SELECT * FROM cola_notificaciones WHERE asunto='Carrito abandonado 24h'").get();
ok(!!notif24h && notif24h.cuerpo.includes(promo24h.codigo), 'el mensaje incluye el código generado');

stockWatcher.checkCarritosAbandonados24h();
const totalNotif24h = db.prepare("SELECT COUNT(*) n FROM cola_notificaciones WHERE asunto='Carrito abandonado 24h'").get().n;
ok(totalNotif24h === 1, 'no duplica el cupón/mensaje en una segunda corrida');

const insCarritoTemprano = db.prepare(`INSERT INTO carritos_abandonados (telefono, carrito_json, abandonado_en, notificado, convertido)
    VALUES (?, ?, datetime('now','localtime','-5 hours'), 0, 0)`);
insCarritoTemprano.run('5214440000002@c.us', JSON.stringify([{ name: 'Otro', id: 2 }]));
stockWatcher.checkCarritosAbandonados24h();
const notifTemprano = db.prepare("SELECT COUNT(*) n FROM cola_notificaciones WHERE asunto='Carrito abandonado 24h'").get().n;
ok(notifTemprano === 1, 'no manda el cupón antes de las 24h');

// ── 3. Clientes dormidos (40 días) sin chocar con masivos (15 días) ─
db.prepare("INSERT INTO clientes (nombre, telefono, tags, activo) VALUES ('Juan Perez','5214440000003@c.us','',1)").run();
const idJuan = db.prepare("SELECT id FROM clientes WHERE telefono='5214440000003@c.us'").get().id;
db.prepare("INSERT INTO pedidos (id_pedido, id_cliente, cliente, creado_en) VALUES ('P1', ?, 'Juan Perez', datetime('now','localtime','-45 days'))").run(idJuan);

stockWatcher.checkClientesDormidos();
ok(!!db.prepare("SELECT id FROM cola_notificaciones WHERE asunto='Cliente dormido' AND destinatario LIKE '%5214440000003%'").get(),
    'notifica a cliente con última compra hace 45 días (> 40)');

db.prepare("INSERT INTO clientes (nombre, telefono, tags, activo) VALUES ('Ana Reciente','5214440000004@c.us','',1)").run();
const idAna = db.prepare("SELECT id FROM clientes WHERE telefono='5214440000004@c.us'").get().id;
db.prepare("INSERT INTO pedidos (id_pedido, id_cliente, cliente, creado_en) VALUES ('P2', ?, 'Ana Reciente', datetime('now','localtime','-10 days'))").run(idAna);
stockWatcher.checkClientesDormidos();
ok(!db.prepare("SELECT id FROM cola_notificaciones WHERE asunto='Cliente dormido' AND destinatario LIKE '%5214440000004%'").get(),
    'NO notifica a cliente con compra reciente (10 días)');

db.prepare("INSERT INTO clientes (nombre, telefono, tags, activo) VALUES ('Pedro Masivo','5214440000005@c.us','',1)").run();
const idPedro = db.prepare("SELECT id FROM clientes WHERE telefono='5214440000005@c.us'").get().id;
db.prepare("INSERT INTO pedidos (id_pedido, id_cliente, cliente, creado_en) VALUES ('P3', ?, 'Pedro Masivo', datetime('now','localtime','-50 days'))").run(idPedro);
db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,creada_en)
    VALUES ('whatsapp','5214440000005@c.us','Promocion masiva','hola','pendiente', datetime('now','localtime','-3 days'))`).run();
stockWatcher.checkClientesDormidos();
ok(!db.prepare("SELECT id FROM cola_notificaciones WHERE asunto='Cliente dormido' AND destinatario LIKE '%5214440000005%'").get(),
    'NO notifica si recibió un masivo hace 3 días (evita aturdir)');

stockWatcher.checkClientesDormidos();
const totalDormidoJuan = db.prepare("SELECT COUNT(*) n FROM cola_notificaciones WHERE asunto='Cliente dormido' AND destinatario LIKE '%5214440000003%'").get().n;
ok(totalDormidoJuan === 1, 'no repite la notificación de dormido en corridas siguientes (<15 días)');

// ── 4. Validar/redimir cupón para cobrar en tienda (POS) ────────────
// Réplica exacta de la consulta de /api/cupon/validar y /api/cupon/redimir
// (dashboard/server.js) — mismo contrato que aplicarCupon del bot.
function validarCupon(codigo) {
    const hoy = new Date().toISOString().slice(0, 10);
    return db.prepare(`
        SELECT * FROM promociones
        WHERE UPPER(codigo) = UPPER(?) AND activa = 1
          AND (fecha_inicio IS NULL OR fecha_inicio <= ?)
          AND (fecha_fin IS NULL OR fecha_fin >= ?)
          AND (usos_max = 0 OR usos_actual < usos_max)
        LIMIT 1
    `).get(codigo, hoy, hoy);
}
function redimirCupon(codigo, idTicket) {
    const promo = validarCupon(codigo);
    if (!promo) return { ok: false };
    db.prepare('UPDATE promociones SET usos_actual=usos_actual+1 WHERE id=?').run(promo.id);
    if (idTicket) db.prepare('UPDATE tickets_venta SET id_promocion=? WHERE id=?').run(promo.id, idTicket);
    return { ok: true, promo };
}

const hoyPos = new Date().toISOString().slice(0, 10);
db.prepare(`INSERT INTO promociones (codigo,tipo,valor,fecha_inicio,fecha_fin,usos_max,usos_actual,activa)
    VALUES ('LEAL-POS01','porcentaje',10,?,?,1,0,1)`).run(hoyPos, hoyPos);
ok(!!validarCupon('leal-pos01'), 'valida un cupón vigente (case-insensitive)');

db.prepare(`INSERT INTO promociones (codigo,tipo,valor,fecha_inicio,fecha_fin,usos_max,usos_actual,activa)
    VALUES ('LEAL-VIEJO','porcentaje',10,'2020-01-01','2020-02-01',1,0,1)`).run();
ok(!validarCupon('LEAL-VIEJO'), 'rechaza un cupón expirado');

db.prepare("INSERT INTO tickets_venta (id) VALUES (1)").run();
const r1 = redimirCupon('LEAL-POS01', 1);
ok(r1.ok, 'redime un cupón vigente');
ok(db.prepare("SELECT id_promocion FROM tickets_venta WHERE id=1").get().id_promocion === r1.promo.id,
    'liga el ticket de venta al id_promocion redimido');
const r2 = redimirCupon('LEAL-POS01', 2);
ok(!r2.ok, 'NO permite redimir dos veces un cupón de usos_max=1');

console.log('\nResultado: ' + pass + ' pass, ' + fail + ' fail\n');
process.exit(fail ? 1 : 0);
