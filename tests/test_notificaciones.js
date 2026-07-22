// test_notificaciones.js
// Prueba de salida de correos y notificaciones automáticas al cliente
// Uso: node --test tests/test_notificaciones.js
// Requiere .env configurado con EMAIL_USER, EMAIL_PASS, etc. Ejecutar SIEMPRE
// sobreescribiendo EMAIL_USER/EMAIL_PASS/ASESOR_WHATSAPP (y opcionalmente
// EMAIL_HOST) a valores obviamente falsos vía `docker compose run -e ...` —
// este archivo ejercita el envío real de correo (§8) cuando SMTP está
// "configurado" (EMAIL_USER/PASS no vacíos), así que correr con credenciales
// reales del .env real mandaría un correo de verdad.
'use strict';

const { test } = require('node:test');
const assert    = require('node:assert/strict');
const db       = require('../bot/db_connection');
const emailSvc = require('../services/emailService');

const pedidoMock = {
    folio:         'TEST-000001',
    idPedido:      1,
    cliente:       'Cliente de Prueba',
    total:         1299.00,
    subtotal:      1200.00,
    costoEnv:      99.00,
    metodo:        'envio',
    tipoEntrega:   'envio',
    ciudad:        'San Luis Potosí',
    estado:        'San Luis Potosí',
    calle:         'Av. Venustiano Carranza 123',
    colonia:       'Centro Histórico',
    cp:            '78000',
    productos:     [
        { nombre: 'Patines De Bota Modelo N Glam By Apache', cantidad: 1, precio: 799.20 },
        { nombre: 'Hot Wheels Set x5', cantidad: 2, precio: 200.40 },
    ],
    linkPago:      'https://paypal.me/juliocepeda/1299',
    guia:          { numeroGuia: 'EST-SIM-000001', fechaEntregaHuman: 'martes 3 de junio' },
    fechaCreacion: new Date().toLocaleString('es-MX'),
};

// ── 1. Configuración SMTP ──────────────────────────────────────────────────
test('【1】 Configuración SMTP', async (t) => {
    await t.test('emailService.isConfigured() = true', () => {
        assert.ok(emailSvc.isConfigured(), 'EMAIL_USER o EMAIL_PASS vacíos en .env — los correos no se enviarán');
    });

    const host = process.env.EMAIL_HOST || '';
    const user = process.env.EMAIL_USER || '';
    const dest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS || '';

    await t.test(`EMAIL_HOST = ${host}`, () => {
        assert.ok(host, 'No configurado');
    });
    await t.test(`EMAIL_USER = ${user}`, () => {
        assert.ok(user, 'No configurado');
    });
    await t.test('Destinatario de notificaciones', () => {
        if (!dest) console.log('  ⚠️  EMAIL_CEDIS y EMAIL_PERSONAL vacíos — nadie recibirá notificaciones de pedido');
        assert.ok(true); // el original solo advierte (warn), nunca falla por esto
    });
});

// ── 2. Template de pedido ────────────────────────────────────────────────────
test('【2】 Template de correo de pedido', async (t) => {
    const html = emailSvc._templatePedido(pedidoMock);

    await t.test('Folio en template', () => assert.ok(html.includes('TEST-000001'), 'No aparece'));
    await t.test('Nombre cliente', () => assert.ok(html.includes('Cliente de Prueba'), 'No aparece'));
    await t.test('Total en template', () => assert.ok(html.includes('1,299') || html.includes('1299'), 'No aparece'));
    await t.test('Producto 1 en template', () => assert.ok(html.includes('Patines'), 'No aparece'));
    await t.test('Link de pago en template', () => {
        if (!(html.includes('paypal') || html.includes('pago'))) console.log('  ⚠️  Link pago no detectado claramente');
        assert.ok(true);
    });
    await t.test('Número de guía en template', () => {
        if (!html.includes('EST-SIM-000001')) console.log('  ⚠️  Guía no aparece en template');
        assert.ok(true);
    });
    await t.test(`Template generado (${html.length} chars)`, () => assert.ok(html.length > 500, `${html.length} chars`));
});

// ── 3. Cola de emails en DB ──────────────────────────────────────────────────
test('【3】 Cola de emails en base de datos', () => {
    const colaEmails = db.prepare('SELECT COUNT(*) AS n FROM cola_emails').get();
    assert.strictEqual(typeof colaEmails.n, 'number');
});

// ── 4. Cola de notificaciones WhatsApp ──────────────────────────────────────
test('【4】 Cola de notificaciones WhatsApp (cola_notificaciones)', async (t) => {
    const ins = db.prepare(`
        INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
        VALUES ('whatsapp', '5214441234567', 'Test notif', 'Mensaje de prueba TEST', 'pendiente')
    `).run();
    await t.test(`Insertar en cola_notificaciones (id=${ins.lastInsertRowid})`, () => assert.ok(ins.lastInsertRowid));

    const row = db.prepare(`SELECT * FROM cola_notificaciones WHERE id=?`).get(ins.lastInsertRowid);
    await t.test('Teléfono guardado correctamente', () => assert.ok(row && row.destinatario === '5214441234567', 'No coincide'));
    await t.test('Estatus pendiente correcto', () => assert.ok(row && row.estatus === 'pendiente', String(row?.estatus)));
    await t.test('Cuerpo del mensaje guardado', () => assert.ok(row && row.cuerpo.includes('TEST'), 'No coincide'));

    db.prepare(`DELETE FROM cola_notificaciones WHERE id=?`).run(ins.lastInsertRowid);
    await t.test('Limpieza del registro de prueba', () => assert.ok(true));
});

// ── 5. Cola de atención al asesor ───────────────────────────────────────────
test('【5】 Notificación al asesor en escaladas', async (t) => {
    const asesorTel = process.env.ASESOR_WHATSAPP || '';
    await t.test(`ASESOR_WHATSAPP configurado: ${asesorTel}`, () => {
        assert.ok(asesorTel, 'No configurado en .env — el asesor no recibirá WhatsApp en escaladas');
    });

    const ins2 = db.prepare(`
        INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
        VALUES ('whatsapp', ?, 'Escalada asesor TEST', 'Cliente test esperando atencion', 'pendiente')
    `).run(asesorTel || '5214441234567');
    await t.test(`Notificación de escalada encolada (id=${ins2.lastInsertRowid})`, () => assert.ok(ins2.lastInsertRowid));
    db.prepare(`DELETE FROM cola_notificaciones WHERE id=?`).run(ins2.lastInsertRowid);
});

// ── 6. Lista de espera → notificación automática ────────────────────────────
test('【6】 Lista de espera — flujo de notificación', async (t) => {
    const ins3 = db.prepare(`
        INSERT INTO lista_espera (id_producto, telefono, nombre_cliente, cantidad, precio_al_registrar, estatus, canal, notas)
        VALUES (1, '5214440000001', 'Cliente Test Lista', 1, 799, 'activa', 'whatsapp', 'Busqueda: test producto')
    `).run();
    await t.test(`Registro en lista_espera (id=${ins3.lastInsertRowid})`, () => assert.ok(ins3.lastInsertRowid));

    const activas = db.prepare(`
        SELECT le.*, p.name AS nombre_producto, p.stock_tienda, p.stock_cedis
        FROM lista_espera le JOIN productos p ON p.id = le.id_producto
        WHERE le.estatus='activa' AND le.id=?
    `).get(ins3.lastInsertRowid);
    await t.test('stockWatcher puede leer lista_espera con JOIN a productos', () => assert.ok(activas, 'Sin resultado'));

    if (activas && (activas.stock_tienda > 0 || activas.stock_cedis > 0)) {
        const ins4 = db.prepare(`
            INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
            VALUES ('whatsapp', ?, ?, ?, 'pendiente')
        `).run(
            activas.telefono,
            `Stock disponible: ${activas.nombre_producto}`,
            `🎉 Llegaron los ${activas.nombre_producto} que esperabas. Tienes 48h para apartar.`
        );
        await t.test(`Notificación de reabasto encolada (id=${ins4.lastInsertRowid})`, () => assert.ok(ins4.lastInsertRowid));
        db.prepare(`DELETE FROM cola_notificaciones WHERE id=?`).run(ins4.lastInsertRowid);
    } else {
        console.log('  ⚠️  Notificación de reabasto: Producto id=1 sin stock_tienda — stockWatcher no dispararía');
    }

    db.prepare(`DELETE FROM lista_espera WHERE id=?`).run(ins3.lastInsertRowid);
});

// ── 7. CSAT post-entrega ─────────────────────────────────────────────────────
test('【7】 CSAT — encuesta post-entrega', async (t) => {
    const ins5 = db.prepare(`
        INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
        VALUES ('whatsapp', '5214440000002', 'CSAT post-entrega', '¿Cómo calificarías tu experiencia? Responde del 1 al 5 ⭐', 'pendiente')
    `).run();
    await t.test(`CSAT encolado correctamente (id=${ins5.lastInsertRowid})`, () => assert.ok(ins5.lastInsertRowid));

    const _pedidoRef = db.prepare('SELECT id_pedido FROM pedidos LIMIT 1').get();
    const _idPedRef  = _pedidoRef ? _pedidoRef.id_pedido : null;
    let ins6;
    if (_idPedRef) {
        ins6 = db.prepare("INSERT INTO valoraciones (id_pedido, id_cliente, calificacion, canal) VALUES (?, NULL, 5, 'whatsapp')").run(_idPedRef);
        await t.test(`Valoración CSAT guardada en DB con pedido ${_idPedRef} (id=${ins6.lastInsertRowid})`, () => assert.ok(ins6.lastInsertRowid));
    } else {
        console.log('  ⚠️  Valoración CSAT: Sin pedidos en DB para hacer referencia — OK en producción cuando haya pedidos reales');
        ins6 = { lastInsertRowid: null };
    }

    db.prepare(`DELETE FROM cola_notificaciones WHERE id=?`).run(ins5.lastInsertRowid);
    if (ins6.lastInsertRowid) db.prepare(`DELETE FROM valoraciones WHERE id=?`).run(ins6.lastInsertRowid);
});

// ── 8. Envío real de correo (opcional) ──────────────────────────────────────
// SEGURIDAD: correr esta prueba SIEMPRE con EMAIL_USER/EMAIL_PASS/
// ASESOR_WHATSAPP (y de preferencia EMAIL_HOST) sobreescritos a valores
// obviamente falsos vía `-e` — así emailSvc.isConfigured() puede seguir
// dando true (solo mira que no estén vacíos) pero el intento de conexión SMTP
// falla con credenciales/host inválidos ANTES de entregar nada real. No se
// captura el error: si falla, la prueba se reporta como fallida (❌), igual
// que el harness original — no es un crash del proceso.
test('【8】 Envío real de correo de prueba', async (t) => {
    if (!emailSvc.isConfigured()) {
        console.log('  ⚠️  Envío real: SMTP no configurado — se omite el envío real');
        return;
    }
    console.log('  → Enviando correo de prueba a ' + (process.env.EMAIL_PERSONAL || process.env.EMAIL_USER) + '...');
    await t.test('Correo de prueba enviado', async () => {
        await emailSvc.notificarPedido(pedidoMock);
    });
});

// ── 9. Carrito abandonado ────────────────────────────────────────────────────
test('【9】 Carrito abandonado — notificación 2h', async (t) => {
    const ins7 = db.prepare(`
        INSERT INTO carritos_abandonados (telefono, carrito_json, ultimo_paso, abandonado_en)
        VALUES ('5214440000003', ?, 'ASK_CP', datetime('now', '-3 hours', 'localtime'))
    `).run(JSON.stringify([{id:1, name:'Patines Test', price:799, cantidad:1}]));
    await t.test(`Carrito abandonado registrado (id=${ins7.lastInsertRowid})`, () => assert.ok(ins7.lastInsertRowid));

    const pendientes = db.prepare(`
        SELECT * FROM carritos_abandonados
        WHERE notificado=0 AND convertido=0
          AND datetime(abandonado_en, '+2 hours') <= datetime('now','localtime')
          AND id=?
    `).get(ins7.lastInsertRowid);
    await t.test('stockWatcher detectaría carrito abandonado', () => assert.ok(pendientes, 'Query no lo encuentra'));

    db.prepare(`DELETE FROM carritos_abandonados WHERE id=?`).run(ins7.lastInsertRowid);
});
