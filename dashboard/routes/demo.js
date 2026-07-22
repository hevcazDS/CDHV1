'use strict';
const construirModulo = require('./_construirModulo');

const NOMBRES = [
    'Ana','Carlos','María','Luis','Sofía','Jorge','Valentina','Miguel','Isabella','Alejandro',
    'Fernanda','Ricardo','Camila','Eduardo','Daniela','Roberto','Paola','Arturo','Gabriela','Sergio',
    'Mariana','Héctor','Natalia','Gustavo','Verónica','Pablo','Adriana','Alberto','Patricia','Ernesto',
    'Claudia','Javier','Lorena','Manuel','Rebeca','Óscar','Silvia','Raúl','Diana','Enrique',
];
const APELLIDOS = [
    'García','Rodríguez','Martínez','López','González','Pérez','Sánchez','Ramírez','Torres','Flores',
    'Rivera','Gómez','Díaz','Cruz','Morales','Reyes','Gutiérrez','Ortiz','Delgado','Castro',
    'Vargas','Romero','Núñez','Mendoza','Ruiz','Jiménez','Herrera','Medina','Aguilar','Vega',
    'Cabrera','Ramos','Chávez','Luna','Figueroa','Espinoza','Campos','Ríos','Fuentes','Contreras',
];

const PERIODOS = { '1d': 1, '1w': 7, '1m': 30, '6m': 180, '1y': 365 };
const VOLUMEN  = { bajo: 2, medio: 10, alto: 30 };

// Distribución de ventas: más viernes(5)/sábado(6), menos lunes(1)
const PESO_DIA = [0.7, 0.6, 0.8, 0.9, 1.2, 1.5, 0.9]; // dom=0…sáb=6

function elegir(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

function fechasRetroactivas(dias, totalPedidos) {
    const fechas = [];
    const hoy = new Date();
    for (let i = 0; i < totalPedidos; i++) {
        const diasAtras = rand(1, dias);
        const d = new Date(hoy);
        d.setDate(d.getDate() - diasAtras);
        // peso por día de semana (rechazo simple — máx 3 intentos, luego acepta igual)
        for (let t = 0; t < 3; t++) {
            if (Math.random() < PESO_DIA[d.getDay()]) break;
            const alt = new Date(hoy);
            alt.setDate(alt.getDate() - rand(1, dias));
            d.setTime(alt.getTime());
        }
        d.setHours(rand(9, 21), rand(0, 59), rand(0, 59));
        fechas.push(d.toISOString().replace('T', ' ').slice(0, 19));
    }
    return fechas;
}

function generarHandler(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, raw => {
        try {
            const body = JSON.parse(raw || '{}');
            const giro    = body.giro    || 'jugueteria';
            const periodo = body.periodo || '1m';
            const volumen = body.volumen || 'medio';

            const dias = PERIODOS[periodo] || 30;
            const pxdia = VOLUMEN[volumen] || 10;
            const totalPedidos = Math.max(1, dias * pxdia);

            // Productos activos reales — el generador no funciona sin catálogo
            const productos = db.prepare('SELECT id, price, costo FROM productos WHERE activo=1 LIMIT 200').all();
            if (!productos.length) return json(res, { ok: false, error: 'No hay productos activos en el catálogo. Crea al menos uno antes de generar datos demo.' }, 400);

            const fechas = fechasRetroactivas(dias, totalPedidos);

            // Necesitamos un sucursal para pedido_detalle.sucursal_origen
            const sucursal = db.prepare('SELECT id FROM sucursales WHERE activa=1 ORDER BY id LIMIT 1').get();
            const sucursalId = sucursal ? sucursal.id : 1;

            // Insertar clientes ficticios (aprox 1 por cada 3-5 pedidos)
            const nClientes = Math.max(2, Math.ceil(totalPedidos / rand(3, 5)));
            const telefonosUsados = new Set();
            const clienteIds = [];

            const insCliente = db.prepare(`
                INSERT INTO clientes (nombre, telefono, canal_origen, tags, creado_en, ultima_actividad)
                VALUES (?, ?, 'whatsapp', '_demo_', ?, ?)
            `);

            db.transaction(() => {
                for (let i = 0; i < nClientes; i++) {
                    let tel;
                    do { tel = '521555' + String(Math.floor(1000000 + Math.random() * 9000000)); }
                    while (telefonosUsados.has(tel));
                    telefonosUsados.add(tel);
                    const nombre = `${elegir(NOMBRES)} ${elegir(APELLIDOS)}`;
                    const fecha = elegir(fechas);
                    const { lastInsertRowid } = insCliente.run(nombre, tel, fecha, fecha);
                    clienteIds.push(Number(lastInsertRowid));
                }
            })();

            // Insertar pedidos con detalle, link_pago y asiento contable
            const insPedido = db.prepare(`
                INSERT INTO pedidos (folio, id_cliente, subtotal, descuento, total,
                    estatus, canal_creacion, creado_en, actualizado_en)
                VALUES (?, ?, ?, 0, ?, 'pagado', 'demo', ?, ?)
            `);
            const insDetalle = db.prepare(`
                INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario,
                    descuento_linea, subtotal_linea, sucursal_origen)
                VALUES (?, ?, ?, ?, 0, ?, ?)
            `);
            const insLink = db.prepare(`
                INSERT INTO links_pago (id_pedido, id_metodo, monto, moneda, estatus, pagado_en, creado_en)
                VALUES (?, 1, ?, 'MXN', 'pagado', ?, ?)
            `);
            const insAsiento = db.prepare(`
                INSERT INTO asientos (fecha, concepto, referencia_tipo, referencia_id, creado_en, sucursal)
                VALUES (?, ?, 'pedido', ?, ?, ?)
            `);
            const insDetAsiento = db.prepare(`
                INSERT INTO asientos_detalle (id_asiento, cuenta, debe, haber) VALUES (?, ?, ?, ?)
            `);

            let totalVentas = 0;
            let numFolio = 1;

            db.transaction(() => {
                for (const fecha of fechas) {
                    const folio = 'DEMO-' + String(numFolio++).padStart(6, '0');
                    const idCliente = elegir(clienteIds);

                    // 1-4 productos por pedido
                    const lineas = rand(1, 4);
                    let subtotal = 0;
                    const lineasData = [];
                    for (let l = 0; l < lineas; l++) {
                        const prod = elegir(productos);
                        const cant = rand(1, 3);
                        const precio = prod.price || rand(50, 500);
                        lineasData.push({ id_producto: prod.id, cant, precio, linea: cant * precio });
                        subtotal += cant * precio;
                    }

                    const subtotalR = Math.round(subtotal * 100) / 100;
                    const total = subtotalR;
                    totalVentas += total;

                    const { lastInsertRowid: idPedido } = insPedido.run(folio, idCliente, subtotalR, total, fecha, fecha);

                    for (const l of lineasData) {
                        insDetalle.run(idPedido, l.id_producto, l.cant, l.precio, l.linea, sucursalId);
                    }

                    insLink.run(idPedido, total, fecha, fecha);

                    // Asiento: CARGO 101 Caja = total; ABONO 401 Ventas = subtotal sin IVA; ABONO 209 IVA
                    const fecha10 = fecha.slice(0, 10);
                    const { lastInsertRowid: idAsiento } = insAsiento.run(fecha10, `Venta ${folio}`, idPedido, fecha, sucursalId);
                    const iva = Math.round(total / 1.16 * 0.16 * 100) / 100;
                    const base = Math.round((total - iva) * 100) / 100;
                    insDetAsiento.run(idAsiento, '101', total, 0);
                    insDetAsiento.run(idAsiento, '401', 0, base);
                    insDetAsiento.run(idAsiento, '209', 0, iva);
                }
            })();

            return json(res, {
                ok: true,
                clientes: clienteIds.length,
                pedidos: totalPedidos,
                total_ventas: Math.round(totalVentas * 100) / 100,
                periodo_generado: `${dias} día(s) hacia atrás`,
            });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

function limpiarHandler(req, res, ctx) {
    const { db, json } = ctx;
    try {
        // Hallar pedidos demo antes de borrar nada (para borrar sus dependientes en orden)
        const pedidosDemo = db.prepare("SELECT id_pedido FROM pedidos WHERE canal_creacion='demo'").all().map(r => r.id_pedido);

        let pedidosBorrados = 0;
        let clientesBorrados = 0;

        db.transaction(() => {
            if (pedidosDemo.length) {
                // SQLite no soporta WHERE IN con array directamente en better-sqlite3 con parámetros dinámicos,
                // usamos una temp table implícita con VALUES
                const placeholders = pedidosDemo.map(() => '?').join(',');
                db.prepare(`DELETE FROM asientos_detalle WHERE id_asiento IN (SELECT id FROM asientos WHERE referencia_tipo='pedido' AND referencia_id IN (${placeholders}))`).run(...pedidosDemo);
                db.prepare(`DELETE FROM asientos WHERE referencia_tipo='pedido' AND referencia_id IN (${placeholders})`).run(...pedidosDemo);
                db.prepare(`DELETE FROM pedido_detalle WHERE id_pedido IN (${placeholders})`).run(...pedidosDemo);
                db.prepare(`DELETE FROM links_pago WHERE id_pedido IN (${placeholders})`).run(...pedidosDemo);
            }
            const rPedidos = db.prepare("DELETE FROM pedidos WHERE canal_creacion='demo'").run();
            pedidosBorrados = rPedidos.changes;

            const rClientes = db.prepare("DELETE FROM clientes WHERE tags LIKE '%_demo_%'").run();
            clientesBorrados = rClientes.changes;
        })();

        return json(res, { ok: true, clientes_borrados: clientesBorrados, pedidos_borrados: pedidosBorrados });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

const RUTAS = [
    { metodo: 'POST',   path: '/api/prime/demo/generar', roles: ['prime'], handler: generarHandler },
    { metodo: 'DELETE', path: '/api/prime/demo/limpiar', roles: ['prime'], handler: limpiarHandler },
];

module.exports = construirModulo(RUTAS);
