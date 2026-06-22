'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1681-1853 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
// db/schema.sql declara `inventarios.id` como PK autoincrement (instalación
// nueva), pero la base de producción real tiene `id_inventory` como PK
// verdadero y un `id` separado que quedó NULL en las 13,926 filas existentes
// -- drift real de esquema, no un typo. Se detecta una sola vez por proceso
// (PRAGMA es barato, pero no hay necesidad de repetirlo en cada request) y
// se usa esa columna tanto para leer como para el WHERE del PUT.
let _pkInventarios = null;
function pkInventarios(db) {
    if (_pkInventarios) return _pkInventarios;
    try {
        const cols = db.prepare('PRAGMA table_info(inventarios)').all().map(c => c.name);
        _pkInventarios = cols.includes('id_inventory') ? 'id_inventory' : 'id';
    } catch (_) { _pkInventarios = 'id'; }
    return _pkInventarios;
}

module.exports = function primeCatalogoRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/prime/palabras-filtro' && req.method === 'POST') {
        const ses = requireSession(req, res, ['prime']);
        if (!ses) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), PalabraFiltroSchema, res, p);
                if (!datos) return;
                const id = filtroPalabras.agregarPalabra(db, { ...datos, creado_por: ses.username });
                return json(res, { ok: true, id });
            } catch (e) {
                if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Esa palabra ya está en la lista' }, 400);
                return json(res, { ok: false, error: e.message }, 500);
            }
        });
    }

    // PUT /api/prime/palabras-filtro/:id — activar/desactivar una palabra
    // agregada desde el panel (las de código fuente no se pueden tocar).
    if (req.method === 'PUT' && p.match(/^\/api\/prime\/palabras-filtro\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { activo } = JSON.parse(body || '{}');
                const r = filtroPalabras.togglePalabra(db, id, !!activo);
                return json(res, r, r.ok ? 200 : 400);
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // DELETE /api/prime/palabras-filtro/:id
    if (req.method === 'DELETE' && p.match(/^\/api\/prime\/palabras-filtro\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        try {
            const r = filtroPalabras.eliminarPalabra(db, id);
            return json(res, r, r.ok ? 200 : 400);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // ── Sucursales (registro de tiendas/bodegas) — solo prime ──────────────
    if (p === '/api/prime/sucursales' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            return json(res, db.prepare('SELECT * FROM sucursales ORDER BY nombre').all());
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (p === '/api/prime/sucursales' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), SucursalSchema, res, p);
                if (!datos) return;
                const { nombre, codigo, direccion } = datos;
                const r = db.prepare('INSERT INTO sucursales (nombre, codigo, direccion) VALUES (?, ?, ?)').run(nombre, codigo || null, direccion || null);
                log.info('[prime] sucursal creada: ' + nombre);
                return json(res, { ok: true, id: r.lastInsertRowid });
            } catch (e) {
                if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Ya existe una sucursal con ese código' }, 400);
                return json(res, { ok: false, error: e.message }, 500);
            }
        });
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/sucursales\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), SucursalUpdateSchema, res, p);
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

    if (req.method === 'DELETE' && p.match(/^\/api\/prime\/sucursales\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        try {
            db.prepare('DELETE FROM sucursales WHERE id=?').run(id);
            return json(res, { ok: true });
        } catch (e) {
            if (String(e.message).includes('FOREIGN KEY')) return json(res, { ok: false, error: 'No se puede borrar: tiene movimientos de inventario asociados. Desactívala en vez de borrarla.' }, 400);
            return json(res, { ok: false, error: e.message }, 500);
        }
    }

    // ── Productos — listado con búsqueda y paginación (para la pestaña
    // Catálogo del Prime: antes solo había alta, sin forma de ver/editar los
    // productos que ya existen). ────────────────────────────────────────────
    if (p === '/api/prime/productos' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            const u2 = new URL(req.url, 'http://x');
            const q = (u2.searchParams.get('q') || '').trim();
            const pagina = Math.max(1, parseInt(u2.searchParams.get('pagina') || '1', 10) || 1);
            const porPagina = 20;
            const offset = (pagina - 1) * porPagina;
            const whereSql = q ? 'WHERE name LIKE ?' : '';
            const params = q ? ['%' + q + '%'] : [];
            const total = db.prepare(`SELECT COUNT(*) AS n FROM productos ${whereSql}`).get(...params).n;
            const items = db.prepare(`
                SELECT id, name, cat, price, stock_tienda, stock_cedis, stock_san_luis_potosi
                FROM productos ${whereSql} ORDER BY name LIMIT ? OFFSET ?
            `).all(...params, porPagina, offset);
            return json(res, { items, total, pagina, porPagina });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // ── Productos — alta y edición (solo prime; la carga masiva del catálogo
    // sigue siendo aparte, esto es para agregar/corregir productos puntuales).
    // Al crear, además de las 3 columnas fijas que usa bot/flows/_shared.js
    // para buscar/recomendar, se siembra una fila en `inventarios` por cada
    // sucursal activa (red de 11 sucursales reales) con el stock inicial que
    // se haya capturado en stock_sucursales -- sin esto, un producto nuevo
    // queda invisible para services/stockService.js (red nacional) y
    // services/stockWatcher.js (alerta de stock mínimo) en las otras 11
    // sucursales, aunque sí se pueda comprar en tienda/CEDIS/SLP. ───────────
    if (p === '/api/prime/productos' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const d = validar(JSON.parse(body || '{}'), ProductoSchema, res, p);
                if (!d) return;
                const crear = db.transaction((datos) => {
                    const r = db.prepare(`
                        INSERT INTO productos (name, cat, price, url_imagen, tags, seo_description, edad_recomendada, edad_min, genero, stock_tienda, stock_cedis, stock_san_luis_potosi)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(datos.name, datos.cat || '', datos.price, datos.url_imagen || null, datos.tags || null, datos.seo_description || null, datos.edad_recomendada || null, datos.edad_min ?? null, datos.genero || null, datos.stock_tienda, datos.stock_cedis, datos.stock_san_luis_potosi);
                    const idProducto = r.lastInsertRowid;
                    const sucursales = db.prepare('SELECT nombre FROM sucursales WHERE activa = 1').all();
                    const insertInv = db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock, stock_minimo) VALUES (?, ?, ?, 0)');
                    for (const s of sucursales) {
                        const stock = (datos.stock_sucursales && datos.stock_sucursales[s.nombre]) || 0;
                        insertInv.run(idProducto, s.nombre, stock);
                    }
                    return idProducto;
                });
                const id = crear(d);
                log.info('[prime] producto creado: ' + d.name);
                return json(res, { ok: true, id });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/productos\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), ProductoUpdateSchema, res, p);
                if (!datos) return;
                if (!db.prepare('SELECT id FROM productos WHERE id=?').get(id)) return json(res, { ok: false, error: 'Producto no encontrado' }, 404);
                if (!actualizarCampos('productos', id, datos)) return json(res, { ok: false, error: 'Nada que actualizar' }, 400);
                return json(res, { ok: true, id });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── Stock mínimo por producto+sucursal (tabla `inventarios`) — umbral que
    // dispara la alerta de services/stockWatcher.js:checkStockMinimo(). La
    // columna stock_minimo existe desde Fase JIUA 2 pero no tenía UI para
    // editarla (default 0 = alerta desactivada para esa fila). ──────────────
    // Antes devolvía hasta 300 filas de golpe sin paginar y sin poder filtrar
    // por sucursal (con 13,926 filas reales, esas 300 ya eran una tabla
    // enorme de desplazar, y siempre las mismas ~27 productos por orden
    // alfabético). Ahora pagina de verdad y permite acotar a una sucursal --
    // patrón estándar de un sistema de inventario real: elegir ubicación
    // primero, después buscar/paginar dentro de ella.
    if (p === '/api/prime/inventarios' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            const pk = pkInventarios(db);
            const u2 = new URL(req.url, 'http://x');
            const q = (u2.searchParams.get('q') || '').trim();
            const sucursal = (u2.searchParams.get('sucursal') || '').trim();
            const pagina = Math.max(1, parseInt(u2.searchParams.get('pagina') || '1', 10) || 1);
            const porPagina = 30;
            const offset = (pagina - 1) * porPagina;
            const cond = [];
            const params = [];
            if (q) { cond.push('p.name LIKE ?'); params.push('%' + q + '%'); }
            if (sucursal) { cond.push('i.sucursal = ?'); params.push(sucursal); }
            const whereSql = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
            const total = db.prepare(`
                SELECT COUNT(*) AS n FROM inventarios i JOIN productos p ON p.id = i.id_producto ${whereSql}
            `).get(...params).n;
            const items = db.prepare(`
                SELECT i.${pk} AS id, i.id_producto, p.name AS producto, i.sucursal, i.stock, i.stock_minimo
                FROM inventarios i JOIN productos p ON p.id = i.id_producto
                ${whereSql} ORDER BY p.name, i.sucursal LIMIT ? OFFSET ?
            `).all(...params, porPagina, offset);
            return json(res, { items, total, pagina, porPagina });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/inventarios\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), InventarioMinimoSchema, res, p);
                if (!datos) return;
                const pk = pkInventarios(db);
                if (!db.prepare(`SELECT ${pk} FROM inventarios WHERE ${pk}=?`).get(id)) return json(res, { ok: false, error: 'Registro de inventario no encontrado' }, 404);
                actualizarCampos('inventarios', id, datos, pk);
                return json(res, { ok: true, id, stock_minimo: datos.stock_minimo });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── Usuarios del dashboard — alta/edición/baja, solo prime. No se puede
    // borrar la propia cuenta ni dejar al sistema sin ningún usuario 'prime'
    // (se quedaría sin nadie que pueda volver a entrar aquí). ──────────────
    if (p === '/api/prime/usuarios' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            return json(res, db.prepare('SELECT id, username, rol, creado_en FROM usuarios ORDER BY id').all());
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    return next();
};
