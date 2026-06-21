'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1253-1517 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function marketingRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
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
        const tasa = clientes > 0 ? ((pedidos / clientes) * 100).toFixed(1) : 0;
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
        return json(res, { busquedas_total: 0, pedidos_total: pedidos, clientes_total: clientes, tasa_conversion: tasa+'%', top_busquedas: topBusquedas, por_tono: porTono });
    }

    // GET /api/ofertas — ofertas activas con precio original y oferta
    if (p === '/api/ofertas' && req.method === 'GET') {
        const hoy = new Date().toISOString().slice(0, 10);
        const rows = db.prepare(`
            SELECT pr.id, pr.codigo, pr.tipo, pr.valor, pr.fecha_fin,
                   pr.usos_actual, pr.usos_max,
                   p.name AS nombre, p.price AS precio_original,
                   ROUND(CASE WHEN pr.tipo = 'monto'
                              THEN MAX(p.price - pr.valor, 0)
                              ELSE p.price * (1 - pr.valor/100.0)
                         END, 2) AS precio_oferta
            FROM promociones pr
            LEFT JOIN productos p ON p.id = pr.id_producto
            WHERE pr.activa = 1
              AND (pr.fecha_fin IS NULL OR pr.fecha_fin >= ?)
            ORDER BY pr.valor DESC LIMIT 100
        `).all(hoy);
        return json(res, rows);
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
                const parsed = validar(JSON.parse(body), CuponRedimirSchema, res);
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
    // que solo muestra las que tienen producto y están vigentes hoy).
    if (p === '/api/promociones' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const soloActivas = _u.searchParams.get('activa');
        let sql = `
            SELECT pr.*, p.name AS nombre_producto
            FROM promociones pr
            LEFT JOIN productos p ON p.id = pr.id_producto
        `;
        const params = [];
        if (soloActivas !== null) { sql += ' WHERE pr.activa = ?'; params.push(soloActivas === '1' ? 1 : 0); }
        sql += ' ORDER BY pr.creada_en DESC LIMIT 300';
        return json(res, db.prepare(sql).all(...params));
    }

    // POST /api/promociones — crear un cupón manual desde el dashboard
    // Body: { codigo, descripcion?, tipo:'porcentaje'|'monto', valor, id_producto?, id_categoria?, fecha_inicio?, fecha_fin?, usos_max? }
    if (p === '/api/promociones' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body);
                if (!d.codigo || !['porcentaje','monto'].includes(d.tipo) || !d.valor) {
                    return json(res, { ok:false, error:'Faltan codigo, tipo (porcentaje|monto) o valor' }, 400);
                }
                const info = db.prepare(`
                    INSERT INTO promociones (codigo, descripcion, tipo, valor, id_producto, id_categoria,
                                              activa, fecha_inicio, fecha_fin, usos_max, usos_actual, creada_en)
                    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, datetime('now','localtime'))
                `).run(
                    String(d.codigo).trim().toUpperCase(), d.descripcion || null, d.tipo, Number(d.valor),
                    d.id_producto || null, d.id_categoria || null,
                    d.fecha_inicio || null, d.fecha_fin || null, d.usos_max || 0
                );
                return json(res, { ok:true, id: info.lastInsertRowid });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // PUT /api/promociones/:id — activar/desactivar un cupón
    // Body: { activa: true|false }
    if (req.method === 'PUT' && p.match(/^\/api\/promociones\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { activa } = JSON.parse(body);
                db.prepare('UPDATE promociones SET activa=? WHERE id=?').run(activa ? 1 : 0, id);
                return json(res, { ok:true, id, activa: !!activa });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/tono — tono actual del bot (A/B/C/D)
    return next();
};
