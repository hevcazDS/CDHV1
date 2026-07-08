// Datos DEMO reversibles para ver métricas/gráficas con vida.
//   node scripts/demoMetricas.js aplicar    → siembra ~30 días de actividad
//   node scripts/demoMetricas.js revertir   → borra TODO lo sembrado
// Todo lo insertado lleva marca reconocible (folio DEMO-, teléfonos
// 5215550000xx) y NO dispara campañas: clientes con marketing_opt_out=1 y
// carritos abandonados fuera de la ventana de 24-48h.
'use strict';
require('dotenv').config();
const db = require('../bot/db_connection');

const MODO = process.argv[2];
const TEL_BASE = '52155500000'; // + índice → 5215550000000..09
const NOMBRES = ['Ana Demo', 'Luis Demo', 'Marta Demo', 'Pedro Demo', 'Sofía Demo', 'Jorge Demo', 'Elena Demo', 'Raúl Demo'];
const BUSQUEDAS = ['lego', 'barbie', 'pelota', 'nerf', 'rompecabezas', 'dinosaurio', 'bicicleta', 'peluche'];
const METODOS = ['efectivo', 'transferencia', 'tarjeta'];
const TONOS = ['A', 'B', 'C', 'D'];

function fecha(diasAtras, hora = 12) {
    const d = new Date(Date.now() - diasAtras * 86400000);
    d.setHours(hora, Math.floor(Math.random() * 60), 0, 0);
    return d.toISOString().replace('T', ' ').slice(0, 19);
}
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const entre = (a, b) => Math.round(a + Math.random() * (b - a));

function insertarEvento(tipo, valor, tel, cuando) {
    try {
        db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono, creado_en) VALUES (?,'whatsapp',?,?,?)").run(tipo, valor, tel, cuando);
    } catch (_) {
        db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES (?,'whatsapp',?,?)").run(tipo, valor, tel);
    }
}

function aplicar() {
    const t = db.transaction(() => {
        // Clientes demo (opt-out de marketing: jamás les llega una campaña)
        const idsCli = [];
        NOMBRES.forEach((nombre, i) => {
            const tel = TEL_BASE + i;
            const r = db.prepare("INSERT INTO clientes (nombre, telefono, canal_origen, activo, marketing_opt_out) VALUES (?,?,'whatsapp',1,1)").run(nombre, tel);
            idsCli.push({ id: r.lastInsertRowid, nombre, tel });
        });

        // 40 pedidos repartidos en 30 días, con pagos reales espaciados
        let folioN = 1;
        for (let i = 0; i < 40; i++) {
            const cli = rnd(idsCli);
            const dias = entre(0, 29);
            const creado = fecha(dias, entre(10, 19));
            const total = entre(280, 2600);
            const estatus = i % 9 === 0 ? 'cancelado' : (i % 4 === 0 ? 'generado' : (i % 3 === 0 ? 'confirmado' : 'entregado'));
            const folio = 'DEMO-' + String(folioN++).padStart(4, '0');
            const rp = db.prepare(`
                INSERT INTO pedidos (cliente, id_cliente, estatus, folio, creado_en, subtotal, total, metodo_pago, tono_bot, canal_creacion)
                VALUES (?,?,?,?,?,?,?,?,?, 'whatsapp')
            `).run(cli.nombre, cli.id, estatus, folio, creado, total, total, rnd(METODOS), rnd(TONOS));
            const pagado = estatus === 'entregado' || estatus === 'confirmado';
            db.prepare(`
                INSERT INTO links_pago (id_pedido, url_link, monto, moneda, estatus, pagado_en, creado_en)
                VALUES (?,?,?,'MXN',?,?,?)
            `).run(rp.lastInsertRowid, 'https://demo.local/pago/' + folio, total, pagado ? 'pagado' : 'generado', pagado ? creado : null, creado);
            if (estatus === 'entregado' && i % 2 === 0) {
                db.prepare("INSERT INTO valoraciones (id_pedido, id_cliente, calificacion, canal, creada_en) VALUES (?,?,?,'whatsapp',?)")
                  .run(rp.lastInsertRowid, cli.id, entre(1, 10) > 2 ? entre(4, 5) : 3, creado);
            }
        }

        // Embudo: búsquedas → vistos → carrito → checkout → pagos + fallbacks
        for (let i = 0; i < 60; i++) {
            const cli = rnd(idsCli); const dias = entre(0, 29); const cuando = fecha(dias);
            const q = rnd(BUSQUEDAS);
            insertarEvento('busqueda', q, cli.tel, cuando);
            if (i % 2 === 0) insertarEvento('producto_visto', q, cli.tel, cuando);
            if (i % 3 === 0) insertarEvento('carrito_agregado', q, cli.tel, cuando);
            if (i % 4 === 0) insertarEvento('checkout_iniciado', String(entre(300, 2000)), cli.tel, cuando);
            if (i % 5 === 0) insertarEvento('pago_confirmado', String(entre(300, 2000)), cli.tel, cuando);
        }
        ['¿tienen sillas para bebé?', 'factura porfa', '¿hacen envolturas?', 'quiero apartar', '¿abren domingo?']
            .forEach((txt, i) => insertarEvento('fallback', txt, TEL_BASE + (i % 8), fecha(entre(0, 10))));

        // Chats iniciados: histórico de 30 días + varios de HOY (KPI del día)
        try {
            for (let d = 0; d < 30; d++) {
                const cuantos = d === 0 ? 5 : entre(1, 6);
                for (let k = 0; k < cuantos && k < idsCli.length; k++) {
                    db.prepare("INSERT OR IGNORE INTO chats_iniciados (telefono, fecha) VALUES (?, date('now','localtime', ?))")
                      .run(idsCli[k].tel, `-${d} days`);
                }
            }
        } catch (_) {}

        // Carritos abandonados con motivo — FUERA de la ventana de campañas (5-20 días)
        ['precio', 'precio', 'envio', 'envio', 'otro', 'precio'].forEach((motivo, i) => {
            const cli = idsCli[i % idsCli.length];
            db.prepare(`
                INSERT INTO carritos_abandonados (telefono, carrito_json, ultimo_paso, notificado, convertido, abandonado_en, motivo)
                VALUES (?,?,'SHOW_CART',1,0,?,?)
            `).run(cli.tel, JSON.stringify([{ name: 'DEMO ' + rnd(BUSQUEDAS), price: entre(200, 900), cantidad: 1 }]), fecha(entre(5, 20)), motivo);
        });
    });
    t();
    console.log('✅ Datos DEMO sembrados (8 clientes, 40 pedidos, embudo de 30 días).');
    console.log('   Para quitarlos: node scripts/demoMetricas.js revertir');
}

function revertir() {
    const t = db.transaction(() => {
        const ids = db.prepare("SELECT id_pedido FROM pedidos WHERE folio LIKE 'DEMO-%'").all().map(r => r.id_pedido);
        for (const id of ids) {
            db.prepare('DELETE FROM valoraciones WHERE id_pedido=?').run(id);
            db.prepare('DELETE FROM links_pago WHERE id_pedido=?').run(id);
            db.prepare('DELETE FROM pedido_detalle WHERE id_pedido=?').run(id);
        }
        db.prepare("DELETE FROM pedidos WHERE folio LIKE 'DEMO-%'").run();
        db.prepare("DELETE FROM log_eventos WHERE telefono LIKE ?").run(TEL_BASE + '%');
        db.prepare("DELETE FROM carritos_abandonados WHERE telefono LIKE ?").run(TEL_BASE + '%');
        try { db.prepare("DELETE FROM chats_iniciados WHERE telefono LIKE ?").run(TEL_BASE + '%'); } catch (_) {}
        db.prepare("DELETE FROM cola_notificaciones WHERE destinatario LIKE ?").run(TEL_BASE + '%');
        db.prepare("DELETE FROM valoraciones WHERE id_cliente IN (SELECT id FROM clientes WHERE telefono LIKE ?)").run(TEL_BASE + '%');
        db.prepare("DELETE FROM clientes WHERE telefono LIKE ?").run(TEL_BASE + '%');
    });
    t();
    console.log('🧹 Datos DEMO eliminados por completo.');
}

if (MODO === 'aplicar') aplicar();
else if (MODO === 'revertir') revertir();
else { console.log('Uso: node scripts/demoMetricas.js aplicar|revertir'); process.exit(1); }
