'use strict';
// ─────────────────────────────────────────────────────────────────────────
// SEEDER DE DEMO — un año de datos por giro, REVERSIBLE.
//
//   node scripts/demo/seed.js <dbPath> <giro> [--revertir]
//
// Clave del diseño: fija process.env.DB_PATH ANTES de requerir los módulos,
// así _shared/contabilidadService/puntosService/kardexService se ligan a la
// BD demo y siembran con EL MISMO código que usa la app → los reportes salen
// consistentes con producción. No toca la BD real (opera sobre un clon que
// crea scripts/demo/generar.js).
//
// 'jugueteria' es especial: conserva los datos reales de Julio Cepeda; solo
// asegura los usuarios demo (clave 123) y deja los módulos de reporte ON.
//
// Reversible: marca configuracion.demo_seed='1' y etiqueta lo sembrado
// (folios 'DEMO-*', clientes/empleados tag 'demo'); --revertir lo borra.
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const crypto = require('crypto');

const dbPath = process.argv[2];
const giro = (process.argv[3] || 'abarrotes').trim();
const revertir = process.argv.includes('--revertir');
if (!dbPath) { console.error('Uso: node scripts/demo/seed.js <dbPath> <giro> [--revertir]'); process.exit(1); }

process.env.DB_PATH = dbPath;              // ← antes de requerir nada que lea la BD
process.env.TZ = process.env.TZ || 'America/Mexico_City';

const db = require('../../bot/db_connection');
const { catalogoDe } = require('./catalogos');

const SUC = 'Centro';                       // sucursal demo única (giros no-juguetería)
const HOY = new Date();
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isoFecha = (d) => d.toISOString().slice(0, 10);
const isoDT = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const diasAtras = (n) => { const d = new Date(HOY); d.setDate(d.getDate() - n); return d; };

function setConfig(clave, valor) {
    db.prepare(`INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?,?,datetime('now','localtime'))
                ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actualizado_en=datetime('now','localtime')`).run(clave, String(valor));
}

// ── Usuarios demo (clave 123) ────────────────────────────────────────────
const USUARIOS_DEMO = [
    ['prime', 'prime'], ['gerente', 'gerente'], ['caja', 'cajero'], ['almacen', 'almacen'],
    ['rh', 'rh'], ['conta', 'contabilidad'], ['compras', 'compras'], ['auditor', 'auditor'],
];
function crearUsuariosDemo() {
    for (const [username, rol] of USUARIOS_DEMO) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync('123', salt, 64).toString('hex');
        const idRol = rol === 'prime' ? 2 : 1;
        const ex = db.prepare('SELECT id FROM usuarios WHERE username=?').get(username);
        if (ex) {
            // Es un clon demo: resetear la clave a 123 aunque el usuario exista
            // (p.ej. 'prime' real) para que el revisor pueda entrar.
            db.prepare('UPDATE usuarios SET password_hash=?, salt=?, rol=?, activo=1 WHERE username=?').run(hash, salt, rol, username);
        } else {
            db.prepare('INSERT INTO usuarios (username, nombre, email, password_hash, id_rol, salt, rol, activo, creado_en) VALUES (?,?,?,?,?,?,?,1,datetime(\'now\',\'localtime\'))')
                .run(username, username, username + '@demo', hash, idRol, salt, rol);
        }
    }
}

// ── Reversión ────────────────────────────────────────────────────────────
function revert() {
    const peds = db.prepare("SELECT id_pedido FROM pedidos WHERE folio LIKE 'DEMO-%'").all().map(r => r.id_pedido);
    const del = db.transaction(() => {
        for (const idp of peds) {
            db.prepare("DELETE FROM pedido_detalle WHERE id_pedido=?").run(idp);
            db.prepare("DELETE FROM links_pago WHERE id_pedido=?").run(idp);
            db.prepare("DELETE FROM valoraciones WHERE id_pedido=?").run(idp);
            for (const rt of ['venta', 'costo_venta', 'venta_credito', 'cobro_credito'])
                { try { db.prepare("DELETE FROM asientos_detalle WHERE id_asiento IN (SELECT id FROM asientos WHERE referencia_tipo=? AND referencia_id=?)").run(rt, String(idp)); db.prepare("DELETE FROM asientos WHERE referencia_tipo=? AND referencia_id=?").run(rt, String(idp)); } catch (_) {} }
        }
        db.prepare("DELETE FROM pedidos WHERE folio LIKE 'DEMO-%'").run();
        try { db.prepare("DELETE FROM log_eventos WHERE valor LIKE 'demo:%' OR canal='demo'").run(); } catch (_) {}
        try { db.prepare("DELETE FROM inventario_movimientos WHERE motivo LIKE 'DEMO %'").run(); } catch (_) {}
        db.prepare("DELETE FROM clientes WHERE tags='demo'").run();
        try { db.prepare("DELETE FROM empleados WHERE rfc LIKE 'DEMO%'").run(); } catch (_) {}
        try { db.prepare("DELETE FROM promociones WHERE codigo LIKE 'DEMO%'").run(); } catch (_) {}
        setConfig('demo_seed', '0');
    });
    del();
    console.log('[seed] revertido: ' + peds.length + ' pedidos demo eliminados.');
}

// ── Catálogo por giro ────────────────────────────────────────────────────
function limpiarCatalogoYTransaccional() {
    // Solo para giros != jugueteria: vaciar catálogo + todo lo transaccional de
    // JC en el clon. Con FK OFF para no pelear con el orden de dependencias
    // (es un clon demo desechable). Lista amplia: cualquier tabla que referencie
    // productos/pedidos/clientes, para que no queden datos de juguetería.
    const tablas = ['pedido_detalle', 'links_pago', 'valoraciones', 'devoluciones', 'devolucion_detalle',
        'envios', 'guias_estafeta', 'estatus_pedido_log', 'estatus_envio_log', 'intentos_pago', 'intentos_entrega',
        'reembolsos', 'tickets_venta', 'ventas_previas', 'pedidos',
        'inventario_movimientos', 'movimientos_inventario', 'inventarios', 'ubicaciones_inventario',
        'alertas_reabasto', 'historial_costos', 'transferencias', 'transferencia_detalle', 'reservas_pickup',
        'productos_similares', 'preventas', 'preventa_clientes', 'lista_espera', 'promociones', 'regalos_lealtad',
        'ordenes_compra_detalle', 'ordenes_compra', 'solicitudes_compra', 'cuentas_pagar',
        'asientos_detalle', 'asientos', 'movimientos_contables', 'facturas', 'calculo_impuestos',
        'carritos_abandonados', 'conversaciones', 'mensajes', 'log_eventos', 'metricas_bot', 'chats_iniciados',
        'cola_atencion', 'cola_notificaciones', 'notificaciones_enviadas',
        'movimientos_puntos', 'puntos_cliente', 'referidos', 'cortes_caja',
        'nominas', 'horarios_empleado', 'empleados', 'productos', 'categorias', 'clientes'];
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
        for (const t of tablas) { try { db.prepare('DELETE FROM ' + t).run(); } catch (_) {} }
    });
    tx();
    db.pragma('foreign_keys = ON');
}

function sembrarCatalogo(cat) {
    const cats = [...new Set(cat.productos.map(p => p.cat))];
    const catId = {};
    for (const c of cats) {
        const r = db.prepare("INSERT INTO categorias (nombre, activa, creada_en) VALUES (?,1,datetime('now','localtime'))").run(c);
        catId[c] = r.lastInsertRowid;
    }
    db.prepare("INSERT OR IGNORE INTO sucursales (nombre, activa, creada_en) VALUES (?,1,datetime('now','localtime'))").run(SUC);
    const ids = [];
    let i = 0;
    for (const p of cat.productos) {
        const esServicio = p.costo === 0;
        const r = db.prepare(`INSERT INTO productos (sku, name, cat, price, costo, activo, id_categoria, tipo, creado_en, creado_por)
            VALUES (?,?,?,?,?,1,?,?,datetime('now','localtime'),'demo')`)
            .run('DEMO-' + (++i), p.name, p.cat, p.price, p.costo, catId[p.cat], esServicio ? 'servicio' : 'fisico');
        const idp = r.lastInsertRowid;
        ids.push({ id: idp, ...p, esServicio });
        if (!esServicio) {
            // stock inicial; algunos por debajo del mínimo (report stock bajo) y
            // algunos que nunca venderemos (report productos muertos).
            const stock = rnd(3, 60), minimo = rnd(5, 12);
            db.prepare("INSERT INTO inventarios (id_producto, sucursal, stock, stock_minimo, stock_maximo) VALUES (?,?,?,?,?)")
                .run(idp, SUC, stock, minimo, 100);
        }
    }
    return ids;
}

// ── Un año de operación ──────────────────────────────────────────────────
function sembrarAnio(productos) {
    const conta = tryReq('../../services/contabilidadService');
    const kardex = tryReq('../../services/kardexService');
    const metodos = db.prepare("SELECT id, nombre FROM metodos_pago WHERE activo=1").all();
    const metodoNombre = pick(metodos)?.nombre || 'efectivo';

    // Clientes demo
    const clientes = [];
    const nombres = ['María López', 'Juan Pérez', 'Ana Torres', 'Luis Ramírez', 'Sofía Cruz', 'Carlos Díaz',
        'Elena Ruiz', 'Miguel Ángel', 'Paty Núñez', 'Roberto Gil', 'Lucía Mora', 'Diego Vega',
        'Carmen Ríos', 'Jorge Luna', 'Fer Solís', 'Andrés Rojo', 'Bere Campos', 'Toño Salas'];
    const gens = ['F', 'M'], edades = ['0-2', '3-5', '6-8', '9-12', 'adulto'], presu = ['bajo', 'medio', 'alto'];
    nombres.forEach((n, k) => {
        const r = db.prepare(`INSERT INTO clientes (nombre, telefono, canal_origen, activo, creado_en, tags, lead_score, edad_pref, genero_pref, presupuesto_pref, codigo_referido)
            VALUES (?,?, ?,1,?, 'demo', ?,?,?,?,?)`)
            .run(n, '521' + rnd(3000000000, 3999999999), pick(['whatsapp', 'directo', 'promo:verano']),
                isoDT(diasAtras(rnd(30, 360))), rnd(10, 95), pick(edades), pick(gens), pick(presu),
                crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5));
        clientes.push({ id: r.lastInsertRowid, telefono: '521' + rnd(3000000000, 3999999999) });
    });

    const vendibles = productos.length ? productos : db.prepare("SELECT id, price, costo, tipo FROM productos WHERE activo=1 LIMIT 200").all().map(p => ({ id: p.id, price: p.price, costo: p.costo, esServicio: p.tipo === 'servicio' }));
    // Reserva ~15% de productos como "muertos" (nunca se venden)
    const activosVenta = vendibles.slice(0, Math.max(1, Math.floor(vendibles.length * 0.85)));

    let folioN = 1000, pedidosCreados = 0;
    const tx = db.transaction(() => {
        for (let d = 360; d >= 0; d--) {                 // recorre el año
            const fecha = diasAtras(d);
            const nPed = rnd(0, 3);                        // 0-3 pedidos/día
            for (let k = 0; k < nPed; k++) {
                const cli = pick(clientes);
                const nItems = rnd(1, 3);
                const carrito = [];
                for (let it = 0; it < nItems; it++) { const p = pick(activosVenta); carrito.push({ ...p, cantidad: rnd(1, 3) }); }
                const subtotal = carrito.reduce((s, x) => s + x.price * x.cantidad, 0);
                const metodo = pick(metodos);
                const folio = 'DEMO-' + (++folioN);
                const dt = isoDT(new Date(fecha.getTime() + rnd(8, 20) * 3600000));
                const rP = db.prepare(`INSERT INTO pedidos (cliente, id_cliente, estatus, folio, creado_en, actualizado_en, subtotal, total, descuento, canal, canal_creacion, metodo_pago, metodo_entrega, cobrado_por, puntos_acreditados)
                    VALUES (?,?, 'entregado', ?, ?, ?, ?, ?, 0, 'whatsapp', ?, ?, 'pickup', 'caja', 0)`)
                    .run('Cliente demo', cli.id, folio, dt, dt, subtotal, subtotal, pick(['whatsapp', 'mostrador']), metodo?.nombre || 'efectivo');
                const idPed = rP.lastInsertRowid;
                for (const x of carrito) {
                    db.prepare("INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal_linea, sucursal_origen) VALUES (?,?,?,?,?,?)")
                        .run(idPed, x.id, x.cantidad, x.price, x.price * x.cantidad, SUC);
                    if (!x.esServicio && kardex) { try { kardex.movimiento({ id_producto: x.id, sucursal: SUC, tipo: 'venta', delta: -x.cantidad, motivo: 'DEMO venta ' + folio, usuario: 'demo' }); } catch (_) {} }
                }
                db.prepare("INSERT INTO links_pago (id_pedido, id_metodo, url_link, monto, moneda, estatus, creado_en, pagado_en) VALUES (?,?,?,?, 'MXN','pagado',?,?)")
                    .run(idPed, metodo?.id || 1, 'demo', subtotal, dt, dt);
                // CSAT ~40%
                if (Math.random() < 0.4)
                    db.prepare("INSERT INTO valoraciones (id_pedido, id_cliente, calificacion, canal, creada_en) VALUES (?,?,?, 'whatsapp', ?)").run(idPed, cli.id, rnd(3, 5), dt);
                // Embudo
                db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono, resultados, registrado_en) VALUES ('busqueda','demo',?,?,?,?)").run('demo:busqueda', cli.telefono, rnd(1, 8), dt);
                db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono, registrado_en) VALUES ('pago_confirmado','demo',?,?,?)").run(String(subtotal), cli.telefono, dt);
                // Contabilidad (backdate del asiento a la fecha del pedido)
                if (conta) {
                    try {
                        conta.asientoVenta(idPed, subtotal, metodo?.nombre || 'efectivo');
                        conta.asientoCostoVenta(idPed);
                        db.prepare("UPDATE asientos SET fecha=? WHERE referencia_id=? AND referencia_tipo IN ('venta','costo_venta')").run(isoFecha(fecha), String(idPed));
                    } catch (_) {}
                }
                pedidosCreados++;
            }
        }
        // Búsquedas sin resultado (report embudos) + carritos convertidos
        for (let i = 0; i < 25; i++) {
            const dt = isoDT(diasAtras(rnd(1, 60)));
            const r = db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono, resultados, registrado_en) VALUES ('busqueda','demo',?,?,0,?)").run(pick(['producto que no hay', 'marca inexistente', 'talla especial', 'color raro']), '5210000000000', dt);
            db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono, registrado_en) VALUES ('busqueda_abandonada','demo',?, '5210000000000', ?)").run(String(r.lastInsertRowid), dt);
        }
    });
    tx();
    return { pedidosCreados, clientes: clientes.length };
}

function sembrarEmpleados() {
    const puestos = [['Encargado', 450], ['Cajero', 320], ['Almacén', 300], ['Vendedor', 350]];
    for (const [p, s] of puestos)
        db.prepare("INSERT INTO empleados (nombre, puesto, salario_diario, con_impuestos, rfc, activo, creado_en) VALUES (?,?,?,1,?,1,datetime('now','localtime'))")
            .run('Empleado ' + p, p, s, 'DEMO' + rnd(100000, 999999));
}

function sembrarPromo() {
    db.prepare(`INSERT INTO promociones (codigo, descripcion, tipo, valor, activa, fecha_inicio, fecha_fin, usos_max, usos_actual, creada_en)
        VALUES ('DEMO10','Demo 10% de descuento','porcentaje',10,1,date('now','-30 days'),date('now','+60 days'),0,3,datetime('now','localtime'))`).run();
}

function tryReq(p) { try { return require(p); } catch (e) { console.warn('[seed] módulo no disponible ' + p + ': ' + e.message); return null; } }

// ── Módulos ON para que todos los reportes tengan de dónde salir ──────────
function activarModulos() {
    for (const m of ['contabilidad_activo', 'pos_activo', 'facturacion_activo', 'rrhh_activo',
        'nomina_fiscal_activo', 'puntos_activo', 'inventario_activo', 'ofertas_activo', 'ventas_credito_activo'])
        setConfig(m, '1');
}

// ── Main ─────────────────────────────────────────────────────────────────
function main() {
    if (revertir) { revert(); return; }
    const cat = catalogoDe(giro);
    setConfig('giro', giro);
    setConfig('negocio_configurado', '1');
    setConfig('iva_pct', '16');
    if (cat) { setConfig('nombre_negocio', cat.negocio); setConfig('nombre_negocio_corto', cat.corto); }
    activarModulos();
    crearUsuariosDemo();

    let resumen;
    if (giro === 'jugueteria') {
        // Conserva datos reales de Julio Cepeda; solo usuarios + módulos + marca.
        resumen = { pedidosCreados: 'datos reales conservados', clientes: '—' };
    } else {
        limpiarCatalogoYTransaccional();
        const productos = sembrarCatalogo(cat);
        sembrarEmpleados();
        sembrarPromo();
        resumen = sembrarAnio(productos);
    }
    setConfig('demo_seed', '1');
    console.log('[seed] giro=' + giro + ' OK — ' + JSON.stringify(resumen));
}

main();
