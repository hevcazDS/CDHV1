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

// Mismo patrón de redacción que ya existía en el dato real: "{min} a {max}
// años" o "{min}+ años" cuando el tope es 99 (sin límite superior real).
// El cliente nunca manda edad_recomendada directamente (ver ProductoSchema
// en bot/validators.js) -- así no puede quedar texto suelto inconsistente
// con los rangos numéricos que bot/flows/_shared.js usa para filtrar.
function calcularEdadRecomendada(edadMin, edadMax) {
    if (edadMin == null && edadMax == null) return null;
    const min = edadMin ?? 0;
    const max = edadMax ?? 99;
    return max >= 99 ? `${min}+ años` : `${min} a ${max} años`;
}

module.exports = function primeCatalogoRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, CategoriaSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/prime/palabras-filtro' && req.method === 'POST') {
        const ses = requireSession(req, res, ['gerente']);
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
        if (!requireSession(req, res, ['gerente'])) return;
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
        if (!requireSession(req, res, ['gerente'])) return;
        const id = parseInt(p.split('/').pop());
        try {
            const r = filtroPalabras.eliminarPalabra(db, id);
            return json(res, r, r.ok ? 200 : 400);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // ── Sucursales (registro de tiendas/bodegas) — solo prime ──────────────
    if (p === '/api/prime/sucursales' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        try {
            return json(res, db.prepare('SELECT * FROM sucursales ORDER BY nombre').all());
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (p === '/api/prime/sucursales' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), SucursalSchema, res, p);
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

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/sucursales\/\d+$/)) {
        if (!requireSession(req, res, ['gerente'])) return;
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
        if (!requireSession(req, res, ['gerente'])) return;
        const id = parseInt(p.split('/').pop());
        try {
            db.prepare('DELETE FROM sucursales WHERE id=?').run(id);
            return json(res, { ok: true });
        } catch (e) {
            if (String(e.message).includes('FOREIGN KEY')) return json(res, { ok: false, error: 'No se puede borrar: tiene movimientos de inventario asociados. Desactívala en vez de borrarla.' }, 400);
            return json(res, { ok: false, error: e.message }, 500);
        }
    }

    // ── Categorías (tabla `categorias`) — lookup para el Select "crear
    // categoría nueva" del alta/edición de producto, en vez de texto libre
    // suelto en productos.cat. ──────────────────────────────────────────────
    if (p === '/api/prime/categorias' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        try {
            return json(res, db.prepare('SELECT id, nombre, descripcion, activa FROM categorias WHERE activa = 1 ORDER BY nombre').all());
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (p === '/api/prime/categorias' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), CategoriaSchema, res, p);
                if (!datos) return;
                const r = db.prepare('INSERT INTO categorias (nombre, descripcion) VALUES (?, ?)').run(datos.nombre, datos.descripcion || null);
                return json(res, { ok: true, id: r.lastInsertRowid, nombre: datos.nombre });
            } catch (e) {
                if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Ya existe una categoría con ese nombre' }, 400);
                return json(res, { ok: false, error: e.message }, 500);
            }
        });
    }

    // ── Productos — listado con búsqueda y paginación (para la pestaña
    // Catálogo del Prime: antes solo había alta, sin forma de ver/editar los
    // productos que ya existen). ────────────────────────────────────────────
    if (p === '/api/prime/productos' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
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
                SELECT p.*, c.nombre AS categoria_nombre
                FROM productos p LEFT JOIN categorias c ON c.id = p.id_categoria
                ${whereSql} ORDER BY p.name LIMIT ? OFFSET ?
            `).all(...params, porPagina, offset);
            return json(res, { items, total, pagina, porPagina });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // ── Productos — alta y edición (solo prime; la carga masiva del catálogo
    // sigue siendo aparte, esto es para agregar/corregir productos puntuales).
    // Al crear, además de las 3 columnas fijas que usa bot/flows/_shared.js
    // para buscar/recomendar, se siembra UNA fila en `inventarios` -- solo
    // para la sucursal de facturación default (configuracion.
    // sucursal_facturacion_default, Prime > General) con `stock_inicial`.
    // Antes se sembraban las 11 sucursales activas; se simplificó porque la
    // deducción real de stock en una venta multi-sucursal no depende de
    // esto (ya usa pedido_detalle.sucursal_origen, ver
    // dashboard/routes/comunicacionPedidos.js). ───────────────────────────
    if (p === '/api/prime/productos' && req.method === 'POST') {
        const ses = requireSession(req, res, ['gerente']);
        if (!ses) return;
        return readBody(req, body => {
            try {
                const d = validar(JSON.parse(body || '{}'), ProductoSchema, res, p);
                if (!d) return;
                const _sucDefRow = db.prepare("SELECT valor FROM configuracion WHERE clave='sucursal_facturacion_default' LIMIT 1").get();
                const sucursalDefault = _sucDefRow ? db.prepare('SELECT nombre FROM sucursales WHERE id=?').get(Number(_sucDefRow.valor)) : null;
                if (!sucursalDefault) {
                    return json(res, { ok: false, error: 'Configura la sucursal de facturación default en Prime > General antes de dar de alta productos' }, 400);
                }
                const edadRecomendada = calcularEdadRecomendada(d.edad_min, d.edad_max);
                const crear = db.transaction((datos) => {
                    const r = db.prepare(`
                        INSERT INTO productos (
                            name, cat, price, costo, sku, upc, brand, handle, description, url_imagen,
                            tags, seo_description, material, color, target_audience, tipo_juguete,
                            edad_recomendada, edad_min, edad_max, genero, id_categoria,
                            peso_kg, alto_cm, ancho_cm, largo_cm,
                            stock_tienda, stock_cedis, stock_san_luis_potosi, stock_exhibicion,
                            stock_queretaro, stock_monterrey, stock_cdmx_centro, stock_base, creado_por, creado_en
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
                    `).run(
                        datos.name, datos.cat || '', datos.price, datos.costo ?? null, datos.sku || null, datos.upc || null,
                        datos.brand || null, datos.handle || null, datos.description || null, datos.url_imagen || null,
                        datos.tags || null, datos.seo_description || null, datos.material || null, datos.color || null,
                        datos.target_audience || null, datos.tipo_juguete || null,
                        edadRecomendada, datos.edad_min ?? null, datos.edad_max ?? null, datos.genero || null, datos.id_categoria ?? null,
                        datos.peso_kg ?? null, datos.alto_cm ?? null, datos.ancho_cm ?? null, datos.largo_cm ?? null,
                        datos.stock_tienda, datos.stock_cedis, datos.stock_san_luis_potosi, datos.stock_exhibicion,
                        datos.stock_queretaro, datos.stock_monterrey, datos.stock_cdmx_centro, datos.stock_base ?? null,
                        ses.username
                    );
                    const idProducto = r.lastInsertRowid;
                    // Un id de producto recién creado por AUTOINCREMENT puede coincidir con
                    // un id_producto huérfano de un producto borrado hace tiempo (ver memoria
                    // "inventarios-filas-huerfanas" -- ~7,315 filas confirmadas, huecos como
                    // el 601/602 reproducidos en pruebas). Esas filas viejas NUNCA pueden
                    // pertenecer al producto que se está creando ahora, así que se limpian
                    // antes de sembrar el inventario real -- si no, quedarían dos filas por
                    // sucursal (la huérfana "revivida" + la nueva) sin forma de distinguirlas.
                    db.prepare('DELETE FROM inventarios WHERE id_producto = ?').run(idProducto);
                    const stock = datos.stock_inicial || 0;
                    db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock, stock_minimo) VALUES (?, ?, ?, 0)')
                        .run(idProducto, sucursalDefault.nombre, stock);
                    db.prepare(`
                        INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por)
                        VALUES (?, ?, 'alta', NULL, ?, 'Alta de producto', ?)
                    `).run(idProducto, sucursalDefault.nombre, stock, ses.username);
                    return idProducto;
                });
                const id = crear(d);
                log.info('[prime] producto creado: ' + d.name);
                return json(res, { ok: true, id });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/productos\/\d+$/)) {
        if (!requireSession(req, res, ['gerente'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), ProductoUpdateSchema, res, p);
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
        if (!requireSession(req, res, ['gerente'])) return;
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
        const ses = requireSession(req, res, ['gerente']);
        if (!ses) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), InventarioMinimoSchema, res, p);
                if (!datos) return;
                const pk = pkInventarios(db);
                const fila = db.prepare(`SELECT ${pk} AS id, id_producto, sucursal, stock_minimo FROM inventarios WHERE ${pk}=?`).get(id);
                if (!fila) return json(res, { ok: false, error: 'Registro de inventario no encontrado' }, 404);
                actualizarCampos('inventarios', id, datos, pk);
                db.prepare(`
                    INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por)
                    VALUES (?, ?, 'ajuste_minimo', ?, ?, 'Ajuste de stock mínimo', ?)
                `).run(fila.id_producto, fila.sucursal, fila.stock_minimo, datos.stock_minimo, ses.username);
                return json(res, { ok: true, id, stock_minimo: datos.stock_minimo });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── Entrada de mercancía (Bloque 2B) — recibir stock de un proveedor:
    // suma al inventario de una sucursal, opcionalmente actualiza el costo del
    // producto, y deja rastro en inventario_movimientos (tipo='entrada').
    // Body: { id_producto, sucursal, cantidad, costo?, proveedor? }
    if (p === '/api/prime/entrada-mercancia' && req.method === 'POST') {
        const ses = requireSession(req, res, ['gerente']);
        if (!ses) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const idProducto = parseInt(d.id_producto, 10);
                const sucursal = String(d.sucursal || '').trim();
                const cantidad = parseInt(d.cantidad, 10);
                if (!idProducto || !sucursal || !(cantidad > 0)) {
                    return json(res, { ok: false, error: 'id_producto, sucursal y cantidad (>0) son obligatorios' }, 400);
                }
                const prod = db.prepare('SELECT id, name FROM productos WHERE id=?').get(idProducto);
                if (!prod) return json(res, { ok: false, error: 'Producto no encontrado' }, 404);
                const pk = pkInventarios(db);
                const costoNum = (d.costo !== undefined && d.costo !== null && d.costo !== '') ? Number(d.costo) : null;
                const proveedor = String(d.proveedor || '').trim();

                const tx = db.transaction(() => {
                    const fila = db.prepare('SELECT * FROM inventarios WHERE id_producto=? AND sucursal=?').get(idProducto, sucursal);
                    const anterior = fila ? (fila.stock || 0) : 0;
                    const nueva = anterior + cantidad;
                    if (fila) {
                        db.prepare(`UPDATE inventarios SET stock=? WHERE ${pk}=?`).run(nueva, fila[pk]);
                    } else {
                        db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock, stock_minimo) VALUES (?, ?, ?, 0)').run(idProducto, sucursal, nueva);
                    }
                    if (costoNum !== null && costoNum >= 0) {
                        db.prepare('UPDATE productos SET costo=? WHERE id=?').run(costoNum, idProducto);
                    }
                    const motivo = 'Entrada de mercancía' + (proveedor ? ' — Proveedor: ' + proveedor : '');
                    db.prepare(`
                        INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por)
                        VALUES (?, ?, 'entrada', ?, ?, ?, ?)
                    `).run(idProducto, sucursal, anterior, nueva, motivo, ses.username);
                    return { anterior, nueva };
                });
                const r = tx();
                log.info('[prime] entrada de mercancía: ' + prod.name + ' +' + cantidad + ' (' + sucursal + ')');
                return json(res, { ok: true, id_producto: idProducto, sucursal, stock_anterior: r.anterior, stock_nuevo: r.nueva });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── Historial de movimientos de inventario (altas y ajustes de stock
    // mínimo) — auditoría: quién/cuándo se dio de alta o se ajustó cada
    // producto+sucursal (ver migrations/0006_auditoria_productos_inventario.sql).
    if (p === '/api/prime/inventario-movimientos' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        try {
            const u2 = new URL(req.url, 'http://x');
            const q = (u2.searchParams.get('q') || '').trim();
            const sucursal = (u2.searchParams.get('sucursal') || '').trim();
            const pagina = Math.max(1, parseInt(u2.searchParams.get('pagina') || '1', 10) || 1);
            const porPagina = 30;
            const offset = (pagina - 1) * porPagina;
            const cond = [];
            const params = [];
            if (q) { cond.push('p.name LIKE ?'); params.push('%' + q + '%'); }
            if (sucursal) { cond.push('m.sucursal = ?'); params.push(sucursal); }
            const whereSql = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
            const total = db.prepare(`
                SELECT COUNT(*) AS n FROM inventario_movimientos m LEFT JOIN productos p ON p.id = m.id_producto ${whereSql}
            `).get(...params).n;
            const items = db.prepare(`
                SELECT m.id, m.id_producto, p.name AS producto, m.sucursal, m.tipo,
                       m.cantidad_anterior, m.cantidad_nueva, m.motivo, m.creado_por, m.creado_en
                FROM inventario_movimientos m LEFT JOIN productos p ON p.id = m.id_producto
                ${whereSql} ORDER BY m.creado_en DESC, m.id DESC LIMIT ? OFFSET ?
            `).all(...params, porPagina, offset);
            return json(res, { items, total, pagina, porPagina });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // ── Usuarios del dashboard — alta/edición/baja, solo prime. No se puede
    // borrar la propia cuenta ni dejar al sistema sin ningún usuario 'prime'
    // (se quedaría sin nadie que pueda volver a entrar aquí). ──────────────
    // Las cuentas 'prime' no aparecen aquí a propósito -- el operador no
    // debe poder tocar (ni ver) cuentas prime desde esta lista de gestión
    // de usuarios "normales". Las protecciones de no-autoborrado/no-dejar-
    // sin-prime en primeUsuariosPuntos.js se mantienen igual por si alguien
    // intenta apuntarle por id directo a la API.
    if (p === '/api/prime/usuarios' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;  // gestión de usuarios = solo prime
        try {
            return json(res, db.prepare("SELECT id, username, nombre, rol, creado_en FROM usuarios WHERE rol != 'prime' ORDER BY id").all());
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    return next();
};
