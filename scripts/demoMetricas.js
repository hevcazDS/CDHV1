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

        // Mes completo: 1-4 pedidos POR DÍA (cobertura diaria para % y gráficas)
        let folioN = 1;
        const plan = [];
        for (let d = 0; d < 30; d++) for (let k = 0, n = entre(1, 4); k < n; k++) plan.push(d);
        for (let i = 0; i < plan.length; i++) {
            const cli = rnd(idsCli);
            const dias = plan[i];
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

        // Embudo DIARIO: búsquedas → vistos → carrito → checkout → pagos
        for (let d = 0; d < 30; d++) {
            const porDia = entre(3, 8);
            for (let i = 0; i < porDia; i++) {
                const cli = rnd(idsCli); const cuando = fecha(d);
                const q = rnd(BUSQUEDAS);
                insertarEvento('busqueda', q, cli.tel, cuando);
                if (i % 2 === 0) insertarEvento('producto_visto', q, cli.tel, cuando);
                if (i % 3 === 0) insertarEvento('carrito_agregado', q, cli.tel, cuando);
                if (i % 4 === 0) insertarEvento('checkout_iniciado', String(entre(300, 2000)), cli.tel, cuando);
                if (i % 5 === 0) insertarEvento('pago_confirmado', String(entre(300, 2000)), cli.tel, cuando);
            }
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

// ── Demo POR MÓDULO (idea Odoo): citas / rrhh / gastos ─────────────────
// node scripts/demoMetricas.js aplicar citas|rrhh|gastos · revertir <modulo>
// Todo con marca DEMO reconocible; el revertir general NO los toca (cada
// módulo se siembra/limpia por separado para demostrar solo lo que se vende).
const MODULOS_DEMO = {
    citas: {
        aplicar() {
            const ins = db.prepare("INSERT INTO citas (telefono, nombre, servicio, fecha, hora, estatus) VALUES (?,?,?,?,?,?)");
            const HH = ['10:00', '11:00', '12:00', '16:00', '17:00'];
            const SRV = ['Corte demo', 'Diseño demo', 'Manicure demo', 'Revisión demo'];
            let n = 0;
            for (let d = 0; d < 5; d++) {
                const f = new Date(Date.now() + d * 86400000);
                const iso = new Date(f.getTime() - f.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
                for (let i = 0; i < 2 + (d % 2); i++) {
                    ins.run(TEL_BASE + (i % 8), rnd(NOMBRES), rnd(SRV), iso, HH[(d + i) % HH.length], d === 0 && i === 0 ? 'confirmada' : 'pendiente');
                    n++;
                }
            }
            console.log(`✅ ${n} citas DEMO sembradas (próximos 5 días). Revertir: aplicar el mismo comando con "revertir citas".`);
        },
        revertir() {
            const r = db.prepare("DELETE FROM citas WHERE servicio LIKE '%demo%' OR telefono LIKE ?").run(TEL_BASE + '%');
            console.log(`🧹 ${r.changes} citas DEMO eliminadas.`);
        },
    },
    rrhh: {
        aplicar() {
            const emp = db.prepare("INSERT INTO empleados (nombre, puesto, salario_diario, con_impuestos) VALUES (?,?,?,?)");
            const e1 = emp.run('Empleado Demo Libre', 'Mostrador', 400, 0).lastInsertRowid;
            const e2 = emp.run('Empleado Demo Formal', 'Almacén', 450, 1).lastInsertRowid;
            const hor = db.prepare("INSERT OR IGNORE INTO horarios_empleado (id_empleado, fecha, horas) VALUES (?,?,?)");
            for (let d = 1; d <= 14; d++) {
                const iso = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
                hor.run(e1, iso, 8); hor.run(e2, iso, 8);
            }
            console.log('✅ 2 empleados DEMO + 14 días de horarios. Calcula la nómina en RRHH para ver el ISR/IMSS.');
        },
        revertir() {
            const ids = db.prepare("SELECT id FROM empleados WHERE nombre LIKE 'Empleado Demo%'").all().map(r => r.id);
            for (const id of ids) {
                db.prepare('DELETE FROM nominas WHERE id_empleado=?').run(id);
                db.prepare('DELETE FROM horarios_empleado WHERE id_empleado=?').run(id);
                db.prepare('DELETE FROM empleados WHERE id=?').run(id);
            }
            console.log(`🧹 ${ids.length} empleados DEMO (y sus horarios/nóminas) eliminados.`);
        },
    },
    gastos: {
        aplicar() {
            const conta = require('../services/contabilidadService');
            if (!conta.activo()) { console.log('⚠️ Activa el módulo Contabilidad primero (Módulos).'); return; }
            for (const [c, m, metodo] of [['Renta local (DEMO)', 8000, 'bancos'], ['Luz CFE (DEMO)', 1450, 'bancos'], ['Papelería (DEMO)', 320, 'caja']]) {
                conta.asientoGasto(c, m, metodo, true);
            }
            console.log('✅ 3 gastos DEMO asentados (ver ERP > Gastos e impuestos).');
        },
        revertir() {
            // los asientos son INMUTABLES (0030) — el demo de gastos se anula
            // con asientos inversos, igual que en la vida real
            const conta = require('../services/contabilidadService');
            const filas = db.prepare("SELECT a.id, a.concepto FROM asientos a WHERE a.referencia_tipo='gasto' AND a.concepto LIKE '%(DEMO)%'").all();
            let n = 0;
            for (const f of filas) {
                const parts = db.prepare('SELECT cuenta, debe, haber FROM asientos_detalle WHERE id_asiento=?').all(f.id);
                try {
                    conta.registrarAsiento({
                        concepto: 'REVERSA demo: ' + f.concepto, referencia_tipo: 'reversa', referencia_id: String(f.id),
                        partidas: parts.map(pp => ({ cuenta: pp.cuenta, debe: pp.haber, haber: pp.debe })),
                    });
                    n++;
                } catch (e) { console.log('  no se pudo reversar', f.id, e.message); }
            }
            console.log(`🧹 ${n} gastos DEMO anulados con asiento inverso (el libro queda cuadrado).`);
        },
    },
};

const MODULO = process.argv[3];
if (MODO === 'aplicar' && MODULO && MODULOS_DEMO[MODULO]) MODULOS_DEMO[MODULO].aplicar();
else if (MODO === 'revertir' && MODULO && MODULOS_DEMO[MODULO]) MODULOS_DEMO[MODULO].revertir();
else if (MODO === 'aplicar' && !MODULO) aplicar();
else if (MODO === 'revertir' && !MODULO) revertir();
else { console.log('Uso: node scripts/demoMetricas.js aplicar|revertir [citas|rrhh|gastos]'); process.exit(1); }
