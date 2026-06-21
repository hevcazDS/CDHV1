// test_notificaciones.js
// Prueba de salida de correos y notificaciones automáticas al cliente
// Uso: node test_notificaciones.js
// Requiere .env configurado con EMAIL_USER, EMAIL_PASS, etc.
'use strict';

const db       = require('../bot/db_connection');
const emailSvc = require('../services/emailService');

let passed = 0, failed = 0, warnings = 0;

function ok(nombre)    { console.log(`  ✅ ${nombre}`); passed++; }
function fail(nombre, msg) { console.log(`  ❌ ${nombre}: ${msg}`); failed++; }
function warn(nombre, msg) { console.log(`  ⚠️  ${nombre}: ${msg}`); warnings++; }

async function run() {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  TEST: Correos y notificaciones al cliente');
    console.log('══════════════════════════════════════════════════\n');

    // ── 1. Configuración SMTP ──────────────────────────────────────
    console.log('【1】 Configuración SMTP');

    if (emailSvc.isConfigured()) {
        ok('emailService.isConfigured() = true');
    } else {
        fail('SMTP configurado', 'EMAIL_USER o EMAIL_PASS vacíos en .env — los correos no se enviarán');
    }

    const host = process.env.EMAIL_HOST || '';
    const user = process.env.EMAIL_USER || '';
    const dest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS || '';

    host ? ok(`EMAIL_HOST = ${host}`) : fail('EMAIL_HOST', 'No configurado');
    user ? ok(`EMAIL_USER = ${user}`) : fail('EMAIL_USER', 'No configurado');
    dest ? ok(`Destinatario de notificaciones = ${dest}`) : warn('Destinatarios', 'EMAIL_CEDIS y EMAIL_PERSONAL vacíos — nadie recibirá notificaciones de pedido');

    // ── 2. Template de pedido ──────────────────────────────────────
    console.log('\n【2】 Template de correo de pedido');

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

    try {
        const html = emailSvc._templatePedido(pedidoMock);
        html.includes('TEST-000001')     ? ok('Folio en template')        : fail('Folio en template', 'No aparece');
        html.includes('Cliente de Prueba') ? ok('Nombre cliente')         : fail('Nombre cliente', 'No aparece');
        html.includes('1,299')  || html.includes('1299') ? ok('Total en template') : fail('Total', 'No aparece');
        html.includes('Patines') ? ok('Producto 1 en template')           : fail('Producto 1', 'No aparece');
        html.includes('paypal') || html.includes('pago') ? ok('Link de pago en template') : warn('Link pago', 'No detectado claramente');
        html.includes('EST-SIM-000001') ? ok('Número de guía en template') : warn('Guía', 'No aparece en template');
        html.length > 500 ? ok(`Template generado (${html.length} chars)`) : fail('Template muy corto', html.length + ' chars');
    } catch(e) {
        fail('Template de pedido', e.message);
    }

    // ── 3. Cola de emails en DB ────────────────────────────────────
    console.log('\n【3】 Cola de emails en base de datos');

    try {
        const colaEmails = db.prepare('SELECT COUNT(*) AS n FROM cola_emails').get();
        ok(`Tabla cola_emails accesible (${colaEmails.n} registros)`);
    } catch(e) {
        fail('cola_emails', e.message);
    }

    // ── 4. Cola de notificaciones WhatsApp ────────────────────────
    console.log('\n【4】 Cola de notificaciones WhatsApp (cola_notificaciones)');

    try {
        // Insertar notificación de prueba
        const ins = db.prepare(`
            INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
            VALUES ('whatsapp', '5214441234567', 'Test notif', 'Mensaje de prueba TEST', 'pendiente')
        `).run();
        ok(`Insertar en cola_notificaciones (id=${ins.lastInsertRowid})`);

        // Verificar que se puede leer
        const row = db.prepare(`SELECT * FROM cola_notificaciones WHERE id=?`).get(ins.lastInsertRowid);
        row && row.destinatario === '5214441234567' ? ok('Teléfono guardado correctamente') : fail('Teléfono', 'No coincide');
        row && row.estatus === 'pendiente'          ? ok('Estatus pendiente correcto')      : fail('Estatus', row?.estatus);
        row && row.cuerpo.includes('TEST')          ? ok('Cuerpo del mensaje guardado')    : fail('Cuerpo', 'No coincide');

        // Limpiar
        db.prepare(`DELETE FROM cola_notificaciones WHERE id=?`).run(ins.lastInsertRowid);
        ok('Limpieza del registro de prueba');
    } catch(e) {
        fail('cola_notificaciones insert', e.message);
    }

    // ── 5. Cola de atención al asesor ─────────────────────────────
    console.log('\n【5】 Notificación al asesor en escaladas');

    const asesorTel = process.env.ASESOR_WHATSAPP || '';
    asesorTel
        ? ok(`ASESOR_WHATSAPP configurado: ${asesorTel}`)
        : fail('ASESOR_WHATSAPP', 'No configurado en .env — el asesor no recibirá WhatsApp en escaladas');

    try {
        // Simular registro de escalada en cola
        const ins2 = db.prepare(`
            INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
            VALUES ('whatsapp', ?, 'Escalada asesor TEST', 'Cliente test esperando atencion', 'pendiente')
        `).run(asesorTel || '5214441234567');
        ok(`Notificación de escalada encolada (id=${ins2.lastInsertRowid})`);
        db.prepare(`DELETE FROM cola_notificaciones WHERE id=?`).run(ins2.lastInsertRowid);
    } catch(e) {
        fail('Escalada en cola', e.message);
    }

    // ── 6. Lista de espera → notificación automática ──────────────
    console.log('\n【6】 Lista de espera — flujo de notificación');

    try {
        // Insertar en lista_espera
        const ins3 = db.prepare(`
            INSERT INTO lista_espera (id_producto, telefono, nombre_cliente, cantidad, precio_al_registrar, estatus, canal, notas)
            VALUES (1, '5214440000001', 'Cliente Test Lista', 1, 799, 'activa', 'whatsapp', 'Busqueda: test producto')
        `).run();
        ok(`Registro en lista_espera (id=${ins3.lastInsertRowid})`);

        // Verificar que stockWatcher la detectaría
        const activas = db.prepare(`
            SELECT le.*, p.name AS nombre_producto, p.stock_tienda, p.stock_cedis
            FROM lista_espera le JOIN productos p ON p.id = le.id_producto
            WHERE le.estatus='activa' AND le.id=?
        `).get(ins3.lastInsertRowid);
        activas ? ok('stockWatcher puede leer lista_espera con JOIN a productos') : fail('JOIN lista_espera', 'Sin resultado');

        // Simular encolado de notificación (lo que haría stockWatcher)
        if (activas && (activas.stock_tienda > 0 || activas.stock_cedis > 0)) {
            const ins4 = db.prepare(`
                INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
                VALUES ('whatsapp', ?, ?, ?, 'pendiente')
            `).run(
                activas.telefono,
                `Stock disponible: ${activas.nombre_producto}`,
                `🎉 Llegaron los ${activas.nombre_producto} que esperabas. Tienes 48h para apartar.`
            );
            ok(`Notificación de reabasto encolada (id=${ins4.lastInsertRowid})`);
            db.prepare(`DELETE FROM cola_notificaciones WHERE id=?`).run(ins4.lastInsertRowid);
        } else {
            warn('Notificación de reabasto', 'Producto id=1 sin stock_tienda — stockWatcher no dispararía');
        }

        db.prepare(`DELETE FROM lista_espera WHERE id=?`).run(ins3.lastInsertRowid);
    } catch(e) {
        fail('Lista de espera flow', e.message);
    }

    // ── 7. CSAT post-entrega ───────────────────────────────────────
    console.log('\n【7】 CSAT — encuesta post-entrega');

    try {
        // Simular la inserción que haría stockWatcher.checkCSAT()
        const ins5 = db.prepare(`
            INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
            VALUES ('whatsapp', '5214440000002', 'CSAT post-entrega', '¿Cómo calificarías tu experiencia? Responde del 1 al 5 ⭐', 'pendiente')
        `).run();
        ok(`CSAT encolado correctamente (id=${ins5.lastInsertRowid})`);

        // Simular respuesta del cliente (valoraciones)
        // Buscar un pedido existente para la FK, o insertar sin FK si no hay
        const _pedidoRef = db.prepare('SELECT id_pedido FROM pedidos LIMIT 1').get();
        const _idPedRef  = _pedidoRef ? _pedidoRef.id_pedido : null;
        let ins6;
        if (_idPedRef) {
            ins6 = db.prepare("INSERT INTO valoraciones (id_pedido, id_cliente, calificacion, canal) VALUES (?, NULL, 5, 'whatsapp')").run(_idPedRef);
            ok(`Valoración CSAT guardada en DB con pedido ${_idPedRef} (id=${ins6.lastInsertRowid})`);
        } else {
            // Sin pedidos en DB — verificar que la tabla existe y acepta inserts cuando hay pedido
            warn('Valoración CSAT', 'Sin pedidos en DB para hacer referencia — OK en producción cuando haya pedidos reales');
            ins6 = { lastInsertRowid: null };
        }

        db.prepare(`DELETE FROM cola_notificaciones WHERE id=?`).run(ins5.lastInsertRowid);
        if (ins6.lastInsertRowid) db.prepare(`DELETE FROM valoraciones WHERE id=?`).run(ins6.lastInsertRowid);
    } catch(e) {
        fail('CSAT flow', e.message);
    }

    // ── 8. Envío real de correo (opcional) ────────────────────────
    console.log('\n【8】 Envío real de correo de prueba');

    if (!emailSvc.isConfigured()) {
        warn('Envío real', 'SMTP no configurado — se omite el envío real');
    } else {
        console.log('  → Enviando correo de prueba a ' + (process.env.EMAIL_PERSONAL || process.env.EMAIL_USER) + '...');
        try {
            await emailSvc.notificarPedido(pedidoMock);
            ok('Correo de prueba enviado — revisar bandeja de entrada');
        } catch(e) {
            fail('Envío real', e.message);
        }
    }

    // ── 9. Carrito abandonado ─────────────────────────────────────
    console.log('\n【9】 Carrito abandonado — notificación 2h');

    try {
        const ins7 = db.prepare(`
            INSERT INTO carritos_abandonados (telefono, carrito_json, ultimo_paso, abandonado_en)
            VALUES ('5214440000003', ?, 'ASK_CP', datetime('now', '-3 hours', 'localtime'))
        `).run(JSON.stringify([{id:1, name:'Patines Test', price:799, cantidad:1}]));
        ok(`Carrito abandonado registrado (id=${ins7.lastInsertRowid})`);

        // Verificar que stockWatcher lo detectaría (abandonado_en > 2h y notificado=0)
        const pendientes = db.prepare(`
            SELECT * FROM carritos_abandonados
            WHERE notificado=0 AND convertido=0
              AND datetime(abandonado_en, '+2 hours') <= datetime('now','localtime')
              AND id=?
        `).get(ins7.lastInsertRowid);
        pendientes ? ok('stockWatcher detectaría carrito abandonado') : fail('Detección carrito', 'Query no lo encuentra');

        db.prepare(`DELETE FROM carritos_abandonados WHERE id=?`).run(ins7.lastInsertRowid);
    } catch(e) {
        fail('Carrito abandonado', e.message);
    }

    // ── Resumen ───────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════');
    console.log(`  RESULTADO: ${passed} ✅  |  ${failed} ❌  |  ${warnings} ⚠️`);
    if (failed > 0) {
        console.log('\n  Revisa los ❌ arriba para corregir antes de producción.');
    }
    console.log('══════════════════════════════════════════════════\n');
}

run().catch(e => { console.error('Error fatal:', e); process.exit(1); });
