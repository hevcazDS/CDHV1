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
                        tipo, name, cat, price, costo, sku, upc, brand, handle, description, url_imagen,
                        tags, seo_description, material, color, target_audience, tipo_juguete,
                        edad_recomendada, edad_min, edad_max, genero, id_categoria,
                        peso_kg, alto_cm, ancho_cm, largo_cm,
                        stock_tienda, stock_cedis, stock_san_luis_potosi, stock_exhibicion,
                        stock_queretaro, stock_monterrey, stock_cdmx_centro, stock_base, creado_por, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`).run(
                    datos.tipo || 'fisico',
                    datos.name, datos.cat || '', datos.price, datos.costo ?? null, datos.sku || null, datos.upc || null,
                    datos.brand || null, datos.handle || null, datos.description || null, datos.url_imagen || null,
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
            const cantidad = parseInt(d.cantidad, 10);
            if (!idProducto || !sucursal || !(cantidad > 0)) return json(res, { ok: false, error: 'id_producto, sucursal y cantidad (>0) son obligatorios' }, 400);
            const prod = db.prepare('SELECT id, name FROM productos WHERE id=?').get(idProducto);
            if (!prod) return json(res, { ok: false, error: 'Producto no encontrado' }, 404);
            const pk = pkInventarios(db);
            const costoNum = (d.costo !== undefined && d.costo !== null && d.costo !== '') ? Number(d.costo) : null;
            const proveedor = String(d.proveedor || '').trim();
            const tx = db.transaction(() => {
                const fila = db.prepare('SELECT * FROM inventarios WHERE id_producto=? AND sucursal=?').get(idProducto, sucursal);
                const anterior = fila ? (fila.stock || 0) : 0;
                const nueva = anterior + cantidad;
                if (costoNum !== null && costoNum >= 0) {
                    try { require('../../services/costeoService').registrarEntrada(idProducto, cantidad, costoNum, 'entrada_manual' + (proveedor ? ':' + proveedor : '')); }
                    catch (_) { db.prepare('UPDATE productos SET costo=? WHERE id=?').run(costoNum, idProducto); }
                }
                if (fila) db.prepare(`UPDATE inventarios SET stock=? WHERE ${pk}=?`).run(nueva, fila[pk]);
                else db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock, stock_minimo) VALUES (?, ?, ?, 0)').run(idProducto, sucursal, nueva);
                const motivo = 'Entrada de mercancía' + (proveedor ? ' — Proveedor: ' + proveedor : '');
                db.prepare(`INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por)
                            VALUES (?, ?, 'entrada', ?, ?, ?, ?)`).run(idProducto, sucursal, anterior, nueva, motivo, ses.username);
                return { anterior, nueva };
            });
            const r = tx();
            if (costoNum !== null && costoNum >= 0) {
                try { require('../../services/contabilidadService').asientoEntradaContado(prod.name + ' ×' + cantidad, costoNum * cantidad); }
                catch (e) { log.debug('Asiento de entrada no registrado: ' + e.message); }
            }
            log.info('[prime] entrada de mercancía: ' + prod.name + ' +' + cantidad + ' (' + sucursal + ')');
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

// GET /api/prime/usuarios — gestión de usuarios "normales" (solo prime)
function usuariosGet(req, res, ctx) {
    const { db, json } = ctx;
    try { return json(res, db.prepare("SELECT id, username, nombre, rol, creado_en FROM usuarios WHERE rol != 'prime' ORDER BY id").all()); }
    catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// entrada-mercancia: area almacén (o admin+ vía permite). El resto gerente+;
// usuarios GET solo prime.
const RUTAS = [
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
    { metodo: 'GET',    path: '/api/prime/inventarios',                    roles: ['gerente'], handler: inventariosGet },
    { metodo: 'PUT',    path: /^\/api\/prime\/inventarios\/(\d+)$/,        roles: ['gerente'], handler: inventariosPut },
    { metodo: 'GET',    path: /^\/api\/prime\/variantes\/(\d+)$/,          roles: ['gerente'], handler: variantesGet },
    { metodo: 'POST',   path: /^\/api\/prime\/variantes\/(\d+)$/,          roles: ['gerente'], handler: variantesPost },
    { metodo: 'POST',   path: '/api/prime/entrada-mercancia',              area: 'almacen', handler: entradaMercancia },
    { metodo: 'GET',    path: '/api/prime/inventario-movimientos',         roles: ['gerente'], handler: inventarioMovimientos },
    { metodo: 'GET',    path: '/api/prime/usuarios',                       roles: ['prime'], handler: usuariosGet },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/prime/' });
