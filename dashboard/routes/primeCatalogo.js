'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1681-1853 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function primeCatalogoRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/prime/palabras-filtro' && req.method === 'POST') {
        const ses = requireSession(req, res, ['prime']);
        if (!ses) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), PalabraFiltroSchema, res);
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
                const datos = validar(JSON.parse(body || '{}'), SucursalSchema, res);
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
                const datos = validar(JSON.parse(body || '{}'), SucursalUpdateSchema, res);
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

    // ── Productos — alta y edición (solo prime; la carga masiva del catálogo
    // sigue siendo aparte, esto es para agregar/corregir productos puntuales) ──
    if (p === '/api/prime/productos' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const d = validar(JSON.parse(body || '{}'), ProductoSchema, res);
                if (!d) return;
                const r = db.prepare(`
                    INSERT INTO productos (name, cat, price, url_imagen, tags, seo_description, edad_recomendada, edad_min, genero, stock_tienda, stock_cedis, stock_san_luis_potosi)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(d.name, d.cat || null, d.price, d.url_imagen || null, d.tags || null, d.seo_description || null, d.edad_recomendada || null, d.edad_min ?? null, d.genero || null, d.stock_tienda, d.stock_cedis, d.stock_san_luis_potosi);
                log.info('[prime] producto creado: ' + d.name);
                return json(res, { ok: true, id: r.lastInsertRowid });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/productos\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), ProductoUpdateSchema, res);
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
    if (p === '/api/prime/inventarios' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim();
            const rows = q
                ? db.prepare(`
                    SELECT i.id, i.id_producto, p.name AS producto, i.sucursal, i.stock, i.stock_minimo
                    FROM inventarios i JOIN productos p ON p.id = i.id_producto
                    WHERE p.name LIKE ? ORDER BY p.name, i.sucursal LIMIT 300
                  `).all('%' + q + '%')
                : db.prepare(`
                    SELECT i.id, i.id_producto, p.name AS producto, i.sucursal, i.stock, i.stock_minimo
                    FROM inventarios i JOIN productos p ON p.id = i.id_producto
                    ORDER BY p.name, i.sucursal LIMIT 300
                  `).all();
            return json(res, rows);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/inventarios\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), InventarioMinimoSchema, res);
                if (!datos) return;
                if (!db.prepare('SELECT id FROM inventarios WHERE id=?').get(id)) return json(res, { ok: false, error: 'Registro de inventario no encontrado' }, 404);
                actualizarCampos('inventarios', id, datos);
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
