'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1253-1517 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function marketingRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    // GET /api/categorias y /api/marcas — lookups de solo lectura para el
    // selector de "Alcance" de Ofertas/Cupones (Producto único / Categoría /
    // Marca / Rango de edad / Todo el inventario). A diferencia de
    // /api/prime/categorias (prime-only, usado para Alta de producto), crear
    // un cupón no es una acción exclusiva de prime -- cualquier sesión
    // logueada que ya pasó requireSession() global puede leer estos lookups.
    if (p === '/api/categorias' && req.method === 'GET') {
        try {
            return json(res, db.prepare('SELECT id, nombre FROM categorias WHERE activa = 1 ORDER BY nombre').all());
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }
    if (p === '/api/marcas' && req.method === 'GET') {
        try {
            return json(res, db.prepare("SELECT DISTINCT brand FROM productos WHERE brand IS NOT NULL AND TRIM(brand) != '' ORDER BY brand").all().map(r => r.brand));
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (p === '/api/cola/historial' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT id, destinatario, asunto, estatus, intentos, creada_en, enviar_despues_de
            FROM cola_notificaciones
            WHERE estatus IN ('enviado','error','cancelado')
            ORDER BY creada_en DESC LIMIT 50
        `).all();
        return json(res, rows);
    }

    // POST /api/reporte — generar y enviar reporte por WhatsApp o email.
    // La lógica real vive en services/reporteService.js, compartida con el
    // envío automático programado de services/stockWatcher.js, para que
    // ambos caminos generen y encolen el reporte de forma idéntica.
    if (p === '/api/reporte' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { destino } = JSON.parse(body); // destino: 'whatsapp'|'email'
                const { status, ...payload } = reporteService.enviarReporte(destino);
                return json(res, payload, status);
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/beta/limpiar
    // Código: variable de entorno BETA_RESET_CODE (ej: godzillatomacafedenoche)
    if (p === '/api/beta/limpiar' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const { codigo, telefono } = JSON.parse(body);
                const BETA_CODE = process.env.BETA_RESET_CODE || '';
                if (!BETA_CODE || !safeEqual(codigo, BETA_CODE)) {
                    return json(res, { ok: false, error: 'Código incorrecto' }, 403);
                }
                if (!telefono) return json(res, { ok: false, error: 'Falta el teléfono' }, 400);

                // Limpiar SOLO datos relacionados con este teléfono/cliente específico
                const tel = telefono.replace(/[^0-9@.]/g, '');
                const borrado = {};

                // Sesión del bot
                borrado.sesion = db.prepare(`DELETE FROM sesiones_bot WHERE id_usuario LIKE ?`).run('%' + tel + '%').changes;
                // Cliente
                const cli = db.prepare(`SELECT id FROM clientes WHERE telefono LIKE ?`).get('%' + tel + '%');
                if (cli) {
                    borrado.lista_espera     = db.prepare(`DELETE FROM lista_espera WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%'+tel+'%').changes;
                    borrado.carritos         = db.prepare(`DELETE FROM carritos_abandonados WHERE telefono LIKE ?`).run('%'+tel+'%').changes;
                    borrado.alertas          = db.prepare(`DELETE FROM alertas_reabasto WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%'+tel+'%').changes;
                    borrado.valoraciones     = db.prepare(`DELETE FROM valoraciones WHERE id_cliente=?`).run(cli.id).changes;
                    borrado.cola_notif       = db.prepare(`DELETE FROM cola_notificaciones WHERE destinatario LIKE ?`).run('%'+tel+'%').changes;
                    borrado.cola_atencion    = db.prepare(`DELETE FROM cola_atencion WHERE id_cliente=?`).run(cli.id).changes;
                    borrado.preventa_cli     = db.prepare(`DELETE FROM preventa_clientes WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%'+tel+'%').changes;
                    // El cliente mismo — al final
                    borrado.cliente          = db.prepare(`DELETE FROM clientes WHERE id=?`).run(cli.id).changes;
                }
                // Log
                log.info('Reset betatestor: ' + JSON.stringify(borrado), { userId: tel });
                return json(res, { ok: true, telefono: tel, borrado });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/metricas — métricas completas del sistema
    if (p === '/api/metricas' && req.method === 'GET') {
        const hoy  = new Date().toISOString().slice(0,10);
        const ayer = new Date(Date.now()-86400000).toISOString().slice(0,10);
        const semana = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
        const mes    = new Date(Date.now()-30*86400000).toISOString().slice(0,10);

        // Pedidos
        const _pHoy   = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)=?").get(hoy);
        const _pAyer  = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)=?").get(ayer);
        const _pSem   = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=?").get(semana);
        const _pMes   = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=?").get(mes);
        const _pTotal = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos").get();

        // Clientes
        const _cHoy  = db.prepare("SELECT COUNT(*) n FROM clientes WHERE date(creado_en)=?").get(hoy)?.n || 0;
        const _cSem  = db.prepare("SELECT COUNT(*) n FROM clientes WHERE date(creado_en)>=?").get(semana)?.n || 0;
        const _cTotal= db.prepare("SELECT COUNT(*) n FROM clientes WHERE activo=1").get()?.n || 0;

        // Pagos
        const _pagPend= db.prepare("SELECT COUNT(*) n, COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='generado'").get();
        const _pagPag = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado'").get();

        // CSAT: promedio de valoraciones post-entrega (escala 1-5)
        const _csat = db.prepare("SELECT AVG(calificacion) promedio, COUNT(*) n FROM valoraciones").get() || {};

        // Ingresos = dinero realmente cobrado (links_pago pagado, por pagado_en)
        const _ingHoy = db.prepare("SELECT COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado' AND date(pagado_en)=?").get(hoy)?.t || 0;
        const _ingSem = db.prepare("SELECT COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado' AND date(pagado_en)>=?").get(semana)?.t || 0;
        const _ingMes = db.prepare("SELECT COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado' AND date(pagado_en)>=?").get(mes)?.t || 0;

        // Escaladas
        const _escHoy = db.prepare("SELECT COUNT(*) n FROM cola_atencion WHERE date(creada_en)=?").get(hoy)?.n || 0;
        const _escSem = db.prepare("SELECT COUNT(*) n FROM cola_atencion WHERE date(creada_en)>=?").get(semana)?.n || 0;

        // Notificaciones enviadas hoy
        const _notifHoy = db.prepare("SELECT COUNT(*) n FROM cola_notificaciones WHERE estatus='enviado' AND date(creada_en)=?").get(hoy)?.n || 0;

        // Pedidos por estatus
        const _porEstatus = db.prepare("SELECT estatus, COUNT(*) n FROM pedidos GROUP BY estatus ORDER BY n DESC").all();

        // Pedidos por día últimos 7 días
        const _porDia = db.prepare("SELECT date(creado_en) AS dia, COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=? GROUP BY dia ORDER BY dia").all(semana);

        // Puntos
        const _puntosTotal = db.prepare("SELECT COALESCE(SUM(puntos_ganados),0) n FROM puntos_cliente").get()?.n || 0;
        const _puntosClientes = db.prepare("SELECT COUNT(*) n FROM puntos_cliente WHERE puntos_ganados > 0").get()?.n || 0;

        return json(res, {
            pedidos: { hoy: _pHoy, ayer: _pAyer, semana: _pSem, mes: _pMes, total: _pTotal },
            clientes: { hoy: _cHoy, semana: _cSem, total: _cTotal },
            pagos: { pendientes: _pagPend, pagados: _pagPag },
            ingresos: { hoy: _ingHoy, semana: _ingSem, mes: _ingMes },
            csat: { promedio: _csat.promedio || null, n: _csat.n || 0 },
            escaladas: { hoy: _escHoy, semana: _escSem },
            notificaciones_hoy: _notifHoy,
            por_estatus: _porEstatus,
            por_dia: _porDia,
            puntos: { total: _puntosTotal, clientes_con_puntos: _puntosClientes },
        });
    }

    // GET /api/conversion — tasa de conversión
    if (p === '/api/conversion' && req.method === 'GET') {
        const pedidos  = db.prepare("SELECT COUNT(*) n FROM pedidos WHERE estatus NOT IN ('cancelado','Cancelado')").get()?.n || 0;
        const clientes = db.prepare("SELECT COUNT(*) n FROM clientes WHERE activo=1").get()?.n || 0;
        const tasa = clientes > 0 ? Number(((pedidos / clientes) * 100).toFixed(1)) : 0;
        const topBusquedas = db.prepare("SELECT valor AS busqueda, COUNT(*) AS veces FROM log_eventos WHERE tipo_evento='busqueda' GROUP BY valor ORDER BY veces DESC LIMIT 10").all();
        // Volumen/ingreso de pedidos agrupado por el tono que tenía el bot al
        // momento de generarse (columna tono_bot, ver migrations/0001_agregar_tono_bot.sql).
        // No es "tasa de conversión" en sentido estricto (no hay conteo de
        // sesiones/leads por tono en ningún lado todavía) — es la comparación
        // de volumen e ingreso que sí es posible con lo que hoy se registra;
        // pedidos anteriores a esta migración caen en 'sin_dato'.
        const porTono = db.prepare(`
            SELECT COALESCE(tono_bot, 'sin_dato') AS tono,
                   COUNT(*) AS pedidos,
                   COALESCE(SUM(total), 0) AS ingresos,
                   COALESCE(AVG(total), 0) AS ticket_promedio
            FROM pedidos
            WHERE estatus NOT IN ('cancelado','Cancelado')
            GROUP BY tono
            ORDER BY pedidos DESC
        `).all();
        // Tasa de conversión REAL por tono (a diferencia de porTono arriba,
        // que es solo volumen/ingreso de pedidos): cruza log_eventos.compro
        // contra el tono que tenía el bot en cada búsqueda registrada. El
        // matching búsqueda→compra que rellena `compro` es por teléfono
        // (LIKE, ver services/stockWatcher.js) — aproximado, no exacto; se
        // expone igual para no ocultar el dato, pero Metricas.jsx debe
        // mostrar la advertencia junto a este número.
        const conversionPorTono = db.prepare(`
            SELECT COALESCE(tono_bot, 'sin_dato') AS tono,
                   COUNT(*) AS total,
                   COALESCE(SUM(compro), 0) AS convertidos
            FROM log_eventos
            WHERE tipo_evento = 'busqueda'
            GROUP BY tono
            ORDER BY total DESC
        `).all().map(r => ({ ...r, tasa: r.total > 0 ? +((r.convertidos / r.total) * 100).toFixed(1) : 0 }));
        return json(res, { busquedas_total: 0, pedidos_total: pedidos, clientes_total: clientes, tasa_conversion: tasa+'%', top_busquedas: topBusquedas, por_tono: porTono, conversion_por_tono: conversionPorTono });
    }

    // GET /api/ofertas — ofertas activas, una fila por PRODUCTO afectado
    // (antes solo soportaba id_producto fijo -- una oferta por categoría/
    // marca/rango de edad/todo el inventario antes simplemente no
    // aparecía aquí porque el JOIN exigía id_producto). El alcance de cada
    // promoción se resuelve en el momento de leer, no al crearla, para que
    // productos nuevos que entren a la categoría/marca queden cubiertos sin
    // tener que re-guardar el cupón.
    if (p === '/api/ofertas' && req.method === 'GET') {
        const hoy = new Date().toISOString().slice(0, 10);
        const promos = db.prepare(`
            SELECT * FROM promociones
            WHERE activa = 1 AND (fecha_fin IS NULL OR fecha_fin >= ?)
        `).all(hoy);

        const out = [];
        for (const pr of promos) {
            let productos;
            if (pr.id_producto) {
                productos = db.prepare('SELECT id, name, price FROM productos WHERE id=? AND activo=1').all(pr.id_producto);
            } else if (pr.id_categoria) {
                productos = db.prepare('SELECT id, name, price FROM productos WHERE id_categoria=? AND activo=1 LIMIT 200').all(pr.id_categoria);
            } else if (pr.brand) {
                productos = db.prepare('SELECT id, name, price FROM productos WHERE brand=? AND activo=1 LIMIT 200').all(pr.brand);
            } else if (pr.edad_min != null || pr.edad_max != null) {
                const min = pr.edad_min ?? 0, max = pr.edad_max ?? 99;
                productos = db.prepare('SELECT id, name, price FROM productos WHERE activo=1 AND edad_min <= ? AND edad_max >= ? LIMIT 200').all(max, min);
            } else {
                productos = db.prepare('SELECT id, name, price FROM productos WHERE activo=1 LIMIT 200').all();
            }
            for (const prod of productos) {
                const precioOferta = pr.tipo === 'monto'
                    ? Math.max(prod.price - pr.valor, 0)
                    : prod.price * (1 - pr.valor / 100.0);
                out.push({
                    id: pr.id, codigo: pr.codigo, tipo: pr.tipo, valor: pr.valor, fecha_fin: pr.fecha_fin,
                    usos_actual: pr.usos_actual, usos_max: pr.usos_max,
                    id_producto: prod.id, nombre: prod.name, precio_original: prod.price,
                    precio_oferta: Math.round(precioOferta * 100) / 100,
                });
            }
        }
        out.sort((a, b) => b.valor - a.valor);
        return json(res, out.slice(0, 200));
    }

    // GET /api/cupon/validar?codigo=X — valida cualquier código de `promociones`
    // (incluye los LEAL-XXXXXX de lealtad y los VUELVE-XXXXX de carrito) para
    // que se pueda cobrar en tienda. Mismo contrato que aplicarCupon del bot.
    if (p === '/api/cupon/validar' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const codigo = (_u.searchParams.get('codigo') || '').trim();
        if (!codigo) return json(res, { ok:false, error:'Falta código' }, 400);
        const hoy = new Date().toISOString().slice(0, 10);
        const promo = db.prepare(`
            SELECT * FROM promociones
            WHERE UPPER(codigo) = UPPER(?)
              AND activa = 1
              AND (fecha_inicio IS NULL OR fecha_inicio <= ?)
              AND (fecha_fin IS NULL OR fecha_fin >= ?)
              AND (usos_max = 0 OR usos_actual < usos_max)
            LIMIT 1
        `).get(codigo, hoy, hoy);
        if (!promo) return json(res, { ok:false, error:'Código no válido o expirado' });
        return json(res, { ok:true, codigo:promo.codigo, tipo:promo.tipo, valor:promo.valor, id_producto:promo.id_producto });
    }

    // POST /api/cupon/redimir — el cajero confirma que ya cobró con el cupón.
    // Body: { codigo, idTicket? }. Marca el uso en promociones (no acumulable
    // si usos_max=1) y, si se manda idTicket, lo liga a tickets_venta.id_promocion.
    if (p === '/api/cupon/redimir' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const parsed = validar(JSON.parse(body), CuponRedimirSchema, res, p);
                if (!parsed) return;
                const { codigo, idTicket } = parsed;
                const hoy = new Date().toISOString().slice(0, 10);
                const promo = db.prepare(`
                    SELECT * FROM promociones
                    WHERE UPPER(codigo) = UPPER(?)
                      AND activa = 1
                      AND (fecha_inicio IS NULL OR fecha_inicio <= ?)
                      AND (fecha_fin IS NULL OR fecha_fin >= ?)
                      AND (usos_max = 0 OR usos_actual < usos_max)
                    LIMIT 1
                `).get(String(codigo).trim(), hoy, hoy);
                if (!promo) return json(res, { ok:false, error:'Código no válido o expirado' });
                // Guarda atómica: evita que dos canjes simultáneos (POS + WhatsApp,
                // o dos cajeros) pasen ambos cuando el cupón es de un solo uso.
                const _upd = db.prepare(
                    'UPDATE promociones SET usos_actual=usos_actual+1 WHERE id=? AND (usos_max=0 OR usos_actual<usos_max)'
                ).run(promo.id);
                if (_upd.changes === 0) return json(res, { ok:false, error:'Ese cupón ya alcanzó su límite de usos' });
                if (idTicket) db.prepare('UPDATE tickets_venta SET id_promocion=? WHERE id=?').run(promo.id, idTicket);
                return json(res, { ok:true, codigo:promo.codigo, tipo:promo.tipo, valor:promo.valor });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/promociones — admin completo (a diferencia de /api/ofertas,
    // que solo muestra las que tienen producto y están vigentes hoy). Agrega
    // `alcance` calculado (en vez de una fila por producto como /api/ofertas
    // -- esta es la vista de gestión, no la de catálogo) para que la tabla
    // de Promociones.jsx pueda mostrar "Categoría: Bebés" en vez de solo el
    // id crudo.
    if (p === '/api/promociones' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const soloActivas = _u.searchParams.get('activa');
        let sql = `
            SELECT pr.*, p.name AS nombre_producto, c.nombre AS nombre_categoria
            FROM promociones pr
            LEFT JOIN productos p ON p.id = pr.id_producto
            LEFT JOIN categorias c ON c.id = pr.id_categoria
        `;
        const params = [];
        if (soloActivas !== null) { sql += ' WHERE pr.activa = ?'; params.push(soloActivas === '1' ? 1 : 0); }
        sql += ' ORDER BY pr.creada_en DESC LIMIT 300';
        const rows = db.prepare(sql).all(...params).map(r => {
            let alcance;
            if (r.id_producto) alcance = 'Producto: ' + (r.nombre_producto || r.id_producto);
            else if (r.id_categoria) alcance = 'Categoría: ' + (r.nombre_categoria || r.id_categoria);
            else if (r.brand) alcance = 'Marca: ' + r.brand;
            else if (r.edad_min != null || r.edad_max != null) alcance = 'Edad: ' + (r.edad_min ?? 0) + ' a ' + (r.edad_max ?? 99);
            else alcance = 'Todo el inventario';
            return { ...r, alcance };
        });
        return json(res, rows);
    }

    // POST /api/promociones — crear un cupón manual desde el dashboard
    // Body: { codigo, descripcion?, tipo:'porcentaje', valor, id_producto?
    //         | id_categoria? | brand? | edad_min?/edad_max?  (alcance,
    //         mutuamente excluyentes -- ninguno = todo el inventario),
    //         fecha_fin (obligatoria), usos_max? }
    if (p === '/api/promociones' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body);
                // tipo:'monto' ya no se acepta en altas nuevas -- permitía dejar
                // el precio en $0.00 si el valor superaba el precio del producto
                // (sin tope porcentual posible). Las filas viejas con 'monto' se
                // siguen leyendo/mostrando normal, solo no se pueden crear más.
                if (!d.codigo || d.tipo !== 'porcentaje' || !d.valor) {
                    return json(res, { ok:false, error:'Faltan codigo o valor, o tipo no es "porcentaje" (el descuento de monto fijo ya no está disponible)' }, 400);
                }
                if (!d.fecha_fin) {
                    return json(res, { ok:false, error:'fecha_fin es obligatoria — toda oferta nueva debe tener vencimiento' }, 400);
                }
                const sesion = obtenerSesion(req);
                if (sesion && sesion.rol !== 'prime') {
                    const _topeRow = db.prepare("SELECT valor FROM configuracion WHERE clave='tope_descuento_pct' LIMIT 1").get();
                    const tope = _topeRow ? Number(_topeRow.valor) : 30;
                    if (tope > 0 && Number(d.valor) > tope) {
                        return json(res, { ok:false, error:`El descuento máximo permitido es ${tope}%. Solo el usuario prime puede crear descuentos mayores.` }, 403);
                    }
                }
                const info = db.prepare(`
                    INSERT INTO promociones (codigo, descripcion, tipo, valor, id_producto, id_categoria,
                                              brand, edad_min, edad_max, creado_por,
                                              activa, fecha_inicio, fecha_fin, usos_max, usos_actual, creada_en)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, datetime('now','localtime'))
                `).run(
                    String(d.codigo).trim().toUpperCase(), d.descripcion || null, d.tipo, Number(d.valor),
                    d.id_producto || null, d.id_categoria || null,
                    d.brand || null, d.edad_min ?? null, d.edad_max ?? null, sesion ? sesion.username : null,
                    d.fecha_inicio || null, d.fecha_fin || null, d.usos_max || 0
                );
                return json(res, { ok:true, id: info.lastInsertRowid });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/promociones/flash — cupón "flash" ligado al disparo de un
    // envío masivo desde Notificaciones: en vez de fecha_inicio/fecha_fin
    // fijas, el operador captura "minutos de validez desde ahora" + tope de
    // redenciones. Se activa en el instante en que se llama este endpoint
    // (pensado para llamarse justo antes de disparar el broadcast en
    // Notificaciones > Masivo). usos_max sigue siendo un tope GLOBAL
    // compartido por código (igual que /api/cupon/redimir ya hace para
    // cupones normales) -- no por cliente.
    if (p === '/api/promociones/flash' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body);
                const minutos = Number(d.minutos_validez);
                if (!d.codigo || d.tipo !== 'porcentaje' || !d.valor || !Number.isFinite(minutos) || minutos <= 0) {
                    return json(res, { ok:false, error:'Faltan codigo, valor o minutos_validez (debe ser > 0)' }, 400);
                }
                const usosMax = Number(d.usos_max) || 0;
                if (usosMax < 1) {
                    return json(res, { ok:false, error:'Un cupón flash debe tener un máximo de redenciones (usos_max >= 1)' }, 400);
                }
                const sesion = obtenerSesion(req);
                if (sesion && sesion.rol !== 'prime') {
                    const _topeRow = db.prepare("SELECT valor FROM configuracion WHERE clave='tope_descuento_pct' LIMIT 1").get();
                    const tope = _topeRow ? Number(_topeRow.valor) : 30;
                    if (tope > 0 && Number(d.valor) > tope) {
                        return json(res, { ok:false, error:`El descuento máximo permitido es ${tope}%. Solo el usuario prime puede crear descuentos mayores.` }, 403);
                    }
                }
                const ahora = new Date();
                const fin = new Date(ahora.getTime() + minutos * 60000);
                const fmtSqlite = (dt) => dt.toISOString().slice(0, 19).replace('T', ' ');
                const info = db.prepare(`
                    INSERT INTO promociones (codigo, descripcion, tipo, valor, id_producto, id_categoria,
                                              brand, edad_min, edad_max, creado_por,
                                              activa, fecha_inicio, fecha_fin, usos_max, usos_actual, creada_en)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, datetime('now','localtime'))
                `).run(
                    String(d.codigo).trim().toUpperCase(), d.descripcion || ('Cupón flash — vence en ' + minutos + ' min'), d.tipo, Number(d.valor),
                    d.id_producto || null, d.id_categoria || null,
                    d.brand || null, d.edad_min ?? null, d.edad_max ?? null, sesion ? sesion.username : null,
                    fmtSqlite(ahora), fmtSqlite(fin), usosMax
                );
                return json(res, { ok:true, id: info.lastInsertRowid, codigo: String(d.codigo).trim().toUpperCase(), fecha_fin: fmtSqlite(fin) });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // PUT /api/promociones/:id — activar/desactivar un cupón
    // Body: { activa: true|false, motivo_baja? } — motivo_baja solo se
    // graba al DESACTIVAR (junto con quién y cuándo); al reactivar se
    // limpian los tres campos de baja, ya que ya no aplican.
    if (req.method === 'PUT' && p.match(/^\/api\/promociones\/\d+$/)) {
        if (!requireSession(req, res, ['gerente'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { activa, motivo_baja } = JSON.parse(body);
                if (activa) {
                    db.prepare("UPDATE promociones SET activa=1, motivo_baja=NULL, baja_por=NULL, baja_en=NULL WHERE id=?").run(id);
                } else {
                    const sesion = obtenerSesion(req);
                    db.prepare("UPDATE promociones SET activa=0, motivo_baja=?, baja_por=?, baja_en=datetime('now','localtime') WHERE id=?")
                        .run(motivo_baja || null, sesion ? sesion.username : null, id);
                }
                return json(res, { ok:true, id, activa: !!activa });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/tono — tono actual del bot (A/B/C/D)
    return next();
};
