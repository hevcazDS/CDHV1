'use strict';
// Catálogo/inventario de Prime: palabras-filtro, sucursales, categorías,
// productos (alta/edición/listado), stock mínimo, variantes, entrada de
// mercancía y movimientos. Migrado al patrón declarativo del tronco: casi todo
// gerente+; entrada-mercancia → area:'almacen' (chamba diaria de almacén, sin
// PIN: entrar libre, sacar con PIN); GET usuarios → prime.
//
// db/schema.sql declara `inventarios.id` como PK, pero producción usa
// `id_inventory` (drift real). Se detecta una vez por proceso.
const { sucursalFacturacionDefault } = require('../../services/sucursalService');
const construirModulo = require('./_construirModulo');

let _pkInventarios = null;
function pkInventarios(db) {
    if (_pkInventarios) return _pkInventarios;
    try {
        const cols = db.prepare('PRAGMA table_info(inventarios)').all().map(c => c.name);
        _pkInventarios = cols.includes('id_inventory') ? 'id_inventory' : 'id';
    } catch (_) { _pkInventarios = 'id'; }
    return _pkInventarios;
}

// "{min} a {max} años" o "{min}+ años" cuando el tope es 99 (sin límite real).
function calcularEdadRecomendada(edadMin, edadMax) {
    if (edadMin == null && edadMax == null) return null;
    const min = edadMin ?? 0;
    const max = edadMax ?? 99;
    return max >= 99 ? `${min}+ años` : `${min} a ${max} años`;
}

// ── Palabras-filtro ────────────────────────────────────────────────────────
function palabrasFiltroPost(req, res, ctx, { ses }) {
    const { db, json, readBody, validar, filtroPalabras, PalabraFiltroSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), PalabraFiltroSchema, res, '/api/prime/palabras-filtro');
            if (!datos) return;
            const id = filtroPalabras.agregarPalabra(db, { ...datos, creado_por: ses.username });
            return json(res, { ok: true, id });
        } catch (e) {
            if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Esa palabra ya está en la lista' }, 400);
            return json(res, { ok: false, error: e.message }, 500);
        }
    });
}
function palabrasFiltroPut(req, res, ctx, { params }) {
    const { db, json, readBody, filtroPalabras } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const { activo } = JSON.parse(body || '{}');
            const r = filtroPalabras.togglePalabra(db, id, !!activo);
            return json(res, r, r.ok ? 200 : 400);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}
function palabrasFiltroDelete(req, res, ctx, { params }) {
    const { db, json, filtroPalabras } = ctx;
    try {
        const r = filtroPalabras.eliminarPalabra(db, parseInt(params[0]));
        return json(res, r, r.ok ? 200 : 400);
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// ── Sucursales ──────────────────────────────────────────────────────────────

// multitienda Ola D: espejo sucursal → punto de pickup del bot. Los dos
// catálogos siguen separados a propósito (puntos_entrega es la lista pública,
// sucursales el inventario interno), pero al guardar una sucursal CON código
// postal cuya zona tiene cobertura, se crea su punto de recolección si no
// existe uno con ese nombre — así un negocio nuevo multitienda no captura dos
// catálogos y el bot ofrece pickup en la tienda correcta por CP. JC no cambia:
// sus puntos ya existen por nombre. Nunca borra ni edita puntos existentes.
function _espejoPuntoEntrega(db, log, { nombre, direccion, codigo_postal }) {
    try {
        const pref = String(codigo_postal || '').replace(/\D/g, '').slice(0, 2);
        if (pref.length < 2 || !nombre) return;
        // misma semántica de zona que _shared.buscarCobertura (prefijo 2 dígitos)
        const cob = db.prepare('SELECT cp, estado FROM cobertura WHERE activa=1').all()
            .find(r => r.cp && String(r.cp).startsWith(pref));
        if (!cob) return; // sin cobertura el bot no llega a esa zona de todos modos
        if (db.prepare('SELECT 1 FROM puntos_entrega WHERE nombre=? LIMIT 1').get(nombre)) return;
        db.prepare('INSERT INTO puntos_entrega (estado, activo, nombre, direccion) VALUES (?,1,?,?)')
          .run(cob.estado, nombre, direccion || null);
        log.info('[prime] punto de pickup espejado para sucursal: ' + nombre + ' (' + cob.estado + ')');
    } catch (e) { log.debug('Espejo punto de entrega omitido: ' + e.message); }
}

function sucursalesGet(req, res, ctx) {
    const { db, json } = ctx;
    try { return json(res, db.prepare('SELECT * FROM sucursales ORDER BY nombre').all()); }
    catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}
function sucursalesPost(req, res, ctx) {
    const { db, json, readBody, validar, log, SucursalSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), SucursalSchema, res, '/api/prime/sucursales');
            if (!datos) return;
            const { nombre, codigo, direccion, codigo_postal } = datos;
            const r = db.prepare('INSERT INTO sucursales (nombre, codigo, direccion, codigo_postal) VALUES (?, ?, ?, ?)').run(nombre, codigo || null, direccion || null, codigo_postal || null);
            _espejoPuntoEntrega(db, log, { nombre, direccion, codigo_postal });
            log.info('[prime] sucursal creada: ' + nombre);
            return json(res, { ok: true, id: r.lastInsertRowid });
        } catch (e) {
            if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Ya existe una sucursal con ese código' }, 400);
            return json(res, { ok: false, error: e.message }, 500);
        }
    });
}
function sucursalesPut(req, res, ctx, { params }) {
    const { db, json, readBody, validar, actualizarCampos, SucursalUpdateSchema } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), SucursalUpdateSchema, res, '/api/prime/sucursales');
            if (!datos) return;
            if (!db.prepare('SELECT id FROM sucursales WHERE id=?').get(id)) return json(res, { ok: false, error: 'Sucursal no encontrada' }, 404);
            if (!actualizarCampos('sucursales', id, datos)) return json(res, { ok: false, error: 'Nada que actualizar' }, 400);
            // Si al editar se completó el CP, intentar el espejo de pickup ahora
            const _s = db.prepare('SELECT nombre, direccion, codigo_postal FROM sucursales WHERE id=?').get(id);
            if (_s) _espejoPuntoEntrega(db, ctx.log, _s);
            return json(res, { ok: true, id });
        } catch (e) {
            if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Ya existe una sucursal con ese código' }, 400);
            return json(res, { ok: false, error: e.message }, 500);
        }
    });
}
function sucursalesDelete(req, res, ctx, { params }) {
    const { db, json } = ctx;
    try {
        db.prepare('DELETE FROM sucursales WHERE id=?').run(parseInt(params[0]));
        return json(res, { ok: true });
    } catch (e) {
        if (String(e.message).includes('FOREIGN KEY')) return json(res, { ok: false, error: 'No se puede borrar: tiene movimientos de inventario asociados. Desactívala en vez de borrarla.' }, 400);
        return json(res, { ok: false, error: e.message }, 500);
    }
}

// ── Categorías ──────────────────────────────────────────────────────────────
function categoriasGet(req, res, ctx) {
    const { db, json } = ctx;
    try { return json(res, db.prepare('SELECT id, nombre, descripcion, activa FROM categorias WHERE activa = 1 ORDER BY nombre').all()); }
    catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}
function categoriasPost(req, res, ctx) {
    const { db, json, readBody, validar, CategoriaSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), CategoriaSchema, res, '/api/prime/categorias');
            if (!datos) return;
            const r = db.prepare('INSERT INTO categorias (nombre, descripcion) VALUES (?, ?)').run(datos.nombre, datos.descripcion || null);
            return json(res, { ok: true, id: r.lastInsertRowid, nombre: datos.nombre });
        } catch (e) {
            if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Ya existe una categoría con ese nombre' }, 400);
            return json(res, { ok: false, error: e.message }, 500);
        }
    });
}

// ── Productos ───────────────────────────────────────────────────────────────
function productosGet(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const u2 = new URL(req.url, 'http://x');
        const q = (u2.searchParams.get('q') || '').trim();
        const pagina = Math.max(1, parseInt(u2.searchParams.get('pagina') || '1', 10) || 1);
        const porPagina = 20;
        const offset = (pagina - 1) * porPagina;
        const whereSql = q ? 'WHERE p.name LIKE ? OR p.sku LIKE ?' : '';
        const params = q ? ['%' + q + '%', '%' + q + '%'] : [];
        const total = db.prepare(`SELECT COUNT(*) AS n FROM productos p ${whereSql}`).get(...params).n;
        const items = db.prepare(`
            SELECT p.*, c.nombre AS categoria_nombre FROM productos p LEFT JOIN categorias c ON c.id = p.id_categoria
            ${whereSql} ORDER BY p.name LIMIT ? OFFSET ?`).all(...params, porPagina, offset);
        return json(res, { items, total, pagina, porPagina });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}
function productosPost(req, res, ctx, { ses }) {
    const { db, json, readBody, validar, log, ProductoSchema } = ctx;
    return readBody(req, body => {
        try {
            const d = validar(JSON.parse(body || '{}'), ProductoSchema, res, '/api/prime/productos');
            if (!d) return;
            const sucursalDefault = sucursalFacturacionDefault(db);
            if (!sucursalDefault) {
                return json(res, { ok: false, error: 'Configura la sucursal de facturación default en Prime > General antes de dar de alta productos' }, 400);
            }
            const edadRecomendada = calcularEdadRecomendada(d.edad_min, d.edad_max);
            const crear = db.transaction((datos) => {
                const r = db.prepare(`
                    INSERT INTO productos (
                        tipo, name, cat, price, costo, unidad_medida, unidad_compra, factor_compra, sku, upc, brand, handle, description, url_imagen, video_url, modelo_3d_url,
                        tags, seo_description, material, color, target_audience, tipo_juguete,
                        edad_recomendada, edad_min, edad_max, genero, id_categoria,
                        peso_kg, alto_cm, ancho_cm, largo_cm,
                        stock_tienda, stock_cedis, stock_san_luis_potosi, stock_exhibicion,
                        stock_queretaro, stock_monterrey, stock_cdmx_centro, stock_base, creado_por, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`).run(
                    datos.tipo || 'fisico',
                    datos.name, datos.cat || '', datos.price, datos.costo ?? null, ['pza','kg','g','lt','ml','m'].includes(datos.unidad_medida) ? datos.unidad_medida : 'pza', datos.unidad_compra || null, Number(datos.factor_compra) > 0 ? Number(datos.factor_compra) : 1, datos.sku || null, datos.upc || null,
                    datos.brand || null, datos.handle || null, datos.description || null, datos.url_imagen || null, datos.video_url || null, datos.modelo_3d_url || null,
                    datos.tags || null, datos.seo_description || null, datos.material || null, datos.color || null,
                    datos.target_audience || null, datos.tipo_juguete || null,
                    edadRecomendada, datos.edad_min ?? null, datos.edad_max ?? null, datos.genero || null, datos.id_categoria ?? null,
                    datos.peso_kg ?? null, datos.alto_cm ?? null, datos.ancho_cm ?? null, datos.largo_cm ?? null,
                    datos.stock_tienda, datos.stock_cedis, datos.stock_san_luis_potosi, datos.stock_exhibicion,
                    datos.stock_queretaro, datos.stock_monterrey, datos.stock_cdmx_centro, datos.stock_base ?? null,
                    ses.username);
                const idProducto = r.lastInsertRowid;
                // Limpia filas de inventario huérfanas que pudieran coincidir por id reciclado.
                db.prepare('DELETE FROM inventarios WHERE id_producto = ?').run(idProducto);
                const stock = datos.stock_inicial || 0;
                db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock, stock_minimo) VALUES (?, ?, ?, 0)').run(idProducto, sucursalDefault, stock);
                db.prepare(`INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por)
                            VALUES (?, ?, 'alta', NULL, ?, 'Alta de producto', ?)`).run(idProducto, sucursalDefault, stock, ses.username);
                return idProducto;
            });
            const id = crear(d);
            log.info('[prime] producto creado: ' + d.name);
            return json(res, { ok: true, id });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}
function productosPut(req, res, ctx, { params }) {
    const { db, json, readBody, validar, actualizarCampos, ProductoUpdateSchema } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), ProductoUpdateSchema, res, '/api/prime/productos');
            if (!datos) return;
            if (!db.prepare('SELECT id FROM productos WHERE id=?').get(id)) return json(res, { ok: false, error: 'Producto no encontrado' }, 404);
            if (datos.edad_min !== undefined || datos.edad_max !== undefined) {
                const actual = db.prepare('SELECT edad_min, edad_max FROM productos WHERE id=?').get(id);
                const edadMin = datos.edad_min !== undefined ? datos.edad_min : actual.edad_min;
                const edadMax = datos.edad_max !== undefined ? datos.edad_max : actual.edad_max;
                datos.edad_recomendada = calcularEdadRecomendada(edadMin, edadMax);
            }
            if (!actualizarCampos('productos', id, datos)) return json(res, { ok: false, error: 'Nada que actualizar' }, 400);
            return json(res, { ok: true, id });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Stock mínimo (inventarios) ──────────────────────────────────────────────
function inventariosGet(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const pk = pkInventarios(db);
        const u2 = new URL(req.url, 'http://x');
        const q = (u2.searchParams.get('q') || '').trim();
        const sucursal = (u2.searchParams.get('sucursal') || '').trim();
        const pagina = Math.max(1, parseInt(u2.searchParams.get('pagina') || '1', 10) || 1);
        const porPagina = 30;
        const offset = (pagina - 1) * porPagina;
        const cond = [], params = [];
        if (q) { cond.push('p.name LIKE ?'); params.push('%' + q + '%'); }
        if (sucursal) { cond.push('i.sucursal = ?'); params.push(sucursal); }
        const whereSql = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
        const total = db.prepare(`SELECT COUNT(*) AS n FROM inventarios i JOIN productos p ON p.id = i.id_producto ${whereSql}`).get(...params).n;
        const items = db.prepare(`
            SELECT i.${pk} AS id, i.id_producto, p.name AS producto, i.sucursal, i.stock, i.stock_minimo
            FROM inventarios i JOIN productos p ON p.id = i.id_producto
            ${whereSql} ORDER BY p.name, i.sucursal LIMIT ? OFFSET ?`).all(...params, porPagina, offset);
        return json(res, { items, total, pagina, porPagina });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}
function inventariosPut(req, res, ctx, { params, ses }) {
    const { db, json, readBody, validar, actualizarCampos, InventarioMinimoSchema } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), InventarioMinimoSchema, res, '/api/prime/inventarios');
            if (!datos) return;
            const pk = pkInventarios(db);
            const fila = db.prepare(`SELECT ${pk} AS id, id_producto, sucursal, stock_minimo FROM inventarios WHERE ${pk}=?`).get(id);
            if (!fila) return json(res, { ok: false, error: 'Registro de inventario no encontrado' }, 404);
            actualizarCampos('inventarios', id, datos, pk);
            db.prepare(`INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por)
                        VALUES (?, ?, 'ajuste_minimo', ?, ?, 'Ajuste de stock mínimo', ?)`).run(fila.id_producto, fila.sucursal, fila.stock_minimo, datos.stock_minimo, ses.username);
            return json(res, { ok: true, id, stock_minimo: datos.stock_minimo });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Variantes talla×color ──────────────────────────────────────────────────
function variantesGet(req, res, ctx, { params }) {
    return ctx.json(res, require('../../services/variantesService').matrizDe(parseInt(params[0])));
}
function variantesPost(req, res, ctx, { params, ses }) {
    const { json, readBody } = ctx;
    const idP = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            if (!Array.isArray(d.filas)) return json(res, { ok: false, error: 'Falta filas[]' }, 400);
            const r = require('../../services/variantesService').guardarMatriz(idP, d.filas, ses.username);
            return json(res, { ok: true, ...r });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/prime/entrada-mercancia — recibir stock (area almacén, sin PIN)
function entradaMercancia(req, res, ctx, { ses }) {
    const { db, json, readBody, log } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const idProducto = parseInt(d.id_producto, 10);
            const sucursal = String(d.sucursal || '').trim();
            const cantidad = Math.round((parseFloat(d.cantidad) || 0) * 1000) / 1000;   // decimal: granel (P1)
            if (!idProducto || !sucursal || !(cantidad > 0)) return json(res, { ok: false, error: 'id_producto, sucursal y cantidad (>0) son obligatorios' }, 400);
            const prod = db.prepare('SELECT id, name, unidad_compra, factor_compra FROM productos WHERE id=?').get(idProducto);
            if (!prod) return json(res, { ok: false, error: 'Producto no encontrado' }, 404);
            const pk = pkInventarios(db);
            // P6 (conversión compra↔venta): en_unidad_compra=true → la cantidad
            // viene en cajas/bultos y se convierte a unidades de VENTA con
            // factor_compra; el costo capturado (por caja) se prorratea.
            const factor = Number(prod.factor_compra) > 0 ? Number(prod.factor_compra) : 1;
            const enUC = !!d.en_unidad_compra && factor !== 1;
            const cantidadCompra = cantidad;
            const cantidadEfectiva = enUC ? Math.round(cantidad * factor * 1000) / 1000 : cantidad;
            let costoNum = (d.costo !== undefined && d.costo !== null && d.costo !== '') ? Number(d.costo) : null;
            if (enUC && costoNum !== null && costoNum >= 0) costoNum = Math.round((costoNum / factor) * 10000) / 10000;
            const proveedor = String(d.proveedor || '').trim();
            const tx = db.transaction(() => {
                const fila = db.prepare('SELECT * FROM inventarios WHERE id_producto=? AND sucursal=?').get(idProducto, sucursal);
                const anterior = fila ? (fila.stock || 0) : 0;
                const nueva = anterior + cantidadEfectiva;
                if (costoNum !== null && costoNum >= 0) {
                    try { require('../../services/costeoService').registrarEntrada(idProducto, cantidadEfectiva, costoNum, 'entrada_manual' + (proveedor ? ':' + proveedor : '')); }
                    catch (_) { db.prepare('UPDATE productos SET costo=? WHERE id=?').run(costoNum, idProducto); }
                }
                if (fila) db.prepare(`UPDATE inventarios SET stock=? WHERE ${pk}=?`).run(nueva, fila[pk]);
                else db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock, stock_minimo) VALUES (?, ?, ?, 0)').run(idProducto, sucursal, nueva);
                const motivo = 'Entrada de mercancía'
                    + (enUC ? ' — ' + cantidadCompra + ' ' + (prod.unidad_compra || 'caja') + '(s) × ' + factor : '')
                    + (proveedor ? ' — Proveedor: ' + proveedor : '');
                // lote/caducidad (P4 lean): viven en el movimiento de entrada.
                const lote = String(d.lote || '').trim().slice(0, 40) || null;
                const caducidad = /^\d{4}-\d{2}-\d{2}$/.test(d.caducidad || '') ? d.caducidad : null;
                db.prepare(`INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por, lote, caducidad)
                            VALUES (?, ?, 'entrada', ?, ?, ?, ?, ?, ?)`).run(idProducto, sucursal, anterior, nueva, motivo, ses.username, lote, caducidad);
                return { anterior, nueva };
            });
            const r = tx();
            if (costoNum !== null && costoNum >= 0) {
                try { require('../../services/contabilidadService').asientoEntradaContado(prod.name + ' ×' + cantidadEfectiva, costoNum * cantidadEfectiva); }
                catch (e) { log.debug('Asiento de entrada no registrado: ' + e.message); }
            }
            log.info('[prime] entrada de mercancía: ' + prod.name + ' +' + cantidadEfectiva + ' (' + sucursal + ')');
            return json(res, { ok: true, id_producto: idProducto, sucursal, stock_anterior: r.anterior, stock_nuevo: r.nueva });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/prime/inventario-movimientos — auditoría de altas/ajustes
function inventarioMovimientos(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const u2 = new URL(req.url, 'http://x');
        const q = (u2.searchParams.get('q') || '').trim();
        const sucursal = (u2.searchParams.get('sucursal') || '').trim();
        const pagina = Math.max(1, parseInt(u2.searchParams.get('pagina') || '1', 10) || 1);
        const porPagina = 30;
        const offset = (pagina - 1) * porPagina;
        const cond = [], params = [];
        if (q) { cond.push('p.name LIKE ?'); params.push('%' + q + '%'); }
        if (sucursal) { cond.push('m.sucursal = ?'); params.push(sucursal); }
        const whereSql = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
        const total = db.prepare(`SELECT COUNT(*) AS n FROM inventario_movimientos m LEFT JOIN productos p ON p.id = m.id_producto ${whereSql}`).get(...params).n;
        const items = db.prepare(`
            SELECT m.id, m.id_producto, p.name AS producto, m.sucursal, m.tipo,
                   m.cantidad_anterior, m.cantidad_nueva, m.motivo, m.creado_por, m.creado_en
            FROM inventario_movimientos m LEFT JOIN productos p ON p.id = m.id_producto
            ${whereSql} ORDER BY m.creado_en DESC, m.id DESC LIMIT ? OFFSET ?`).all(...params, porPagina, offset);
        return json(res, { items, total, pagina, porPagina });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// GET /api/prime/usuarios — LISTA de usuarios operativos (gerente+). El
// administrador crea/edita cajero/almacén/compras/rh/contabilidad/operador
// (ROLES_CREABLES_POR_GERENTE) y necesita verlos; antes el listar era prime-only
// mientras el crear (POST) sí era gerente → la pestaña Usuarios se le rompía con
// un 401. La query EXCLUYE las cuentas 'prime', así que el gerente no ve ni toca
// cuentas prime (y el DELETE + tocar admin/prime siguen prime-only aparte).
function usuariosGet(req, res, ctx) {
    const { db, json } = ctx;
    try { return json(res, db.prepare("SELECT id, username, nombre, rol, sucursal, creado_en FROM usuarios WHERE rol != 'prime' ORDER BY id").all()); }
    catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// entrada-mercancia: area almacén (o admin+ vía permite). El resto gerente+;
// usuarios GET solo prime.
// ── Receta / insumos del platillo (P3, gerente) ────────────────────────────
function recetaGet(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
    return json(res, { insumos: require('../../services/recetasService').insumosDe(db, id) });
}
// PUT { insumos: [{ id_insumo, cantidad }] } — reemplaza la receta completa.
function recetaPut(req, res, ctx, { params }) {
    const { db, json, readJson } = ctx;
    const id = parseInt(params[0]);
    return readJson(req, res, d => {
        const lineas = Array.isArray(d.insumos) ? d.insumos : [];
        for (const l of lineas) {
            if (!(Number(l.id_insumo) > 0) || !(Number(l.cantidad) > 0)) return json(res, { ok: false, error: 'Cada insumo requiere id_insumo y cantidad > 0' }, 400);
            if (Number(l.id_insumo) === id) return json(res, { ok: false, error: 'Un platillo no puede ser insumo de sí mismo' }, 400);
        }
        db.transaction(() => {
            db.prepare('DELETE FROM producto_insumos WHERE id_producto=?').run(id);
            const ins = db.prepare('INSERT INTO producto_insumos (id_producto, id_insumo, cantidad) VALUES (?,?,?)');
            for (const l of lineas) ins.run(id, Number(l.id_insumo), Math.round(Number(l.cantidad) * 1000) / 1000);
        })();
        return json(res, { ok: true, insumos: lineas.length });
    });
}

// POST /api/prime/producto-imagen { id_producto, archivo_base64, mimetype } —
// sube una foto de producto (jpg/png), la convierte a WebP y guarda el basename
// local en productos.url_imagen. Ambivalente: el campo URL externo sigue igual
// (ambos escriben la misma columna). Exento del cap de body (server.js) por el
// tamaño en base64. gerente+.
function productoImagen(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, async body => {
        try {
            const d = JSON.parse(body || '{}');
            const id = parseInt(d.id_producto) || 0;
            const prod = id ? db.prepare('SELECT id, url_imagen FROM productos WHERE id=?').get(id) : null;
            if (id && !prod) return json(res, { ok: false, error: 'Producto no encontrado' }, 404);
            const imgP = require('../../services/imagenProducto');
            const basename = await imgP.guardarBase64(id, d.archivo_base64, d.mimetype);
            // En edición: actualiza ya y borra la imagen local anterior. En alta
            // (sin id): solo guarda el archivo y devuelve el basename — la UI lo
            // pone en url_imagen y se persiste al crear el producto.
            if (prod) {
                if (prod.url_imagen && !imgP.esExterna(prod.url_imagen)) { try { imgP.borrar(prod.url_imagen); } catch (_) {} }
                db.prepare('UPDATE productos SET url_imagen=? WHERE id=?').run(basename, id);
            }
            return json(res, { ok: true, url_imagen: basename });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

const RUTAS = [
    { metodo: 'POST',   path: '/api/prime/producto-imagen',                roles: ['gerente'], handler: productoImagen },
    { metodo: 'POST',   path: '/api/prime/palabras-filtro',                roles: ['gerente'], handler: palabrasFiltroPost },
    { metodo: 'PUT',    path: /^\/api\/prime\/palabras-filtro\/(\d+)$/,    roles: ['gerente'], handler: palabrasFiltroPut },
    { metodo: 'DELETE', path: /^\/api\/prime\/palabras-filtro\/(\d+)$/,    roles: ['gerente'], handler: palabrasFiltroDelete },
    { metodo: 'GET',    path: '/api/prime/sucursales',                     roles: ['gerente'], handler: sucursalesGet },
    { metodo: 'POST',   path: '/api/prime/sucursales',                     roles: ['gerente'], handler: sucursalesPost },
    { metodo: 'PUT',    path: /^\/api\/prime\/sucursales\/(\d+)$/,         roles: ['gerente'], handler: sucursalesPut },
    { metodo: 'DELETE', path: /^\/api\/prime\/sucursales\/(\d+)$/,         roles: ['gerente'], handler: sucursalesDelete },
    { metodo: 'GET',    path: '/api/prime/categorias',                     roles: ['gerente'], handler: categoriasGet },
    { metodo: 'POST',   path: '/api/prime/categorias',                     roles: ['gerente'], handler: categoriasPost },
    { metodo: 'GET',    path: '/api/prime/productos',                      roles: ['gerente'], handler: productosGet },
    { metodo: 'POST',   path: '/api/prime/productos',                      roles: ['gerente'], handler: productosPost },
    { metodo: 'PUT',    path: /^\/api\/prime\/productos\/(\d+)$/,          roles: ['gerente'], handler: productosPut },
    { metodo: 'GET',    path: /^\/api\/prime\/productos\/(\d+)\/receta$/,   roles: ['gerente'], handler: recetaGet },
    { metodo: 'PUT',    path: /^\/api\/prime\/productos\/(\d+)\/receta$/,   roles: ['gerente'], handler: recetaPut },
    { metodo: 'GET',    path: '/api/prime/inventarios',                    roles: ['gerente'], handler: inventariosGet },
    { metodo: 'PUT',    path: /^\/api\/prime\/inventarios\/(\d+)$/,        roles: ['gerente'], handler: inventariosPut },
    { metodo: 'GET',    path: /^\/api\/prime\/variantes\/(\d+)$/,          roles: ['gerente'], handler: variantesGet },
    { metodo: 'POST',   path: /^\/api\/prime\/variantes\/(\d+)$/,          roles: ['gerente'], handler: variantesPost },
    { metodo: 'POST',   path: '/api/prime/entrada-mercancia',              area: 'almacen', handler: entradaMercancia },
    { metodo: 'GET',    path: '/api/prime/inventario-movimientos',         roles: ['gerente'], handler: inventarioMovimientos },
    { metodo: 'GET',    path: '/api/prime/usuarios',                       roles: ['gerente'], handler: usuariosGet },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/prime/' });
