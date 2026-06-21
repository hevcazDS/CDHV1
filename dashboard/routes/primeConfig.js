'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1518-1680 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function primeConfigRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/tono' && req.method === 'GET') {
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='tono_bot' LIMIT 1").get();
            const tono = r && ['A','B','C','D'].includes(r.valor) ? r.valor : 'C';
            return json(res, { tono });
        } catch(_) { return json(res, { tono: 'C' }); }
    }

    // POST /api/tono — cambiar tono del bot {tono:'A'|'B'|'C'|'D'}
    if (p === '/api/tono' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const tono = String((JSON.parse(body || '{}')).tono || '').toUpperCase();
                if (!['A','B','C','D'].includes(tono)) return json(res, { ok: false, error: 'Tono inválido. Usa A, B, C o D.' }, 400);
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('tono_bot', ?, datetime('now','localtime'))").run(tono);
                return json(res, { ok: true, tono });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/modulo/:clave — estado de un módulo
    if (p.startsWith('/api/modulo/') && req.method === 'GET') {
        const clave = p.split('/').pop();
        try {
            const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
            // Por defecto activo excepto puntos_activo
            const defecto = clave === 'puntos_activo' ? false : true;
            return json(res, { clave, activo: r ? r.valor !== '0' : defecto });
        } catch(_) { return json(res, { clave, activo: true }); }
    }

    // ── Rutas exclusivas del usuario prime — encender APIs reales ──────────
    // (pago_real_activo / estafeta_real_activo). Invisibles/inalcanzables
    // para el usuario común: requieren credenciales propias desde .env.
    if (p === '/api/prime/config' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const claves = ['pago_real_activo', 'estafeta_real_activo'];
        const out = {};
        for (const clave of claves) {
            const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
            out[clave] = r ? r.valor === '1' || r.valor === 'true' : false;
        }
        return json(res, out);
    }

    if (p === '/api/prime/config' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), PrimeConfigSchema, res);
                if (!datos) return;
                const { clave, activo } = datos;
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))").run(clave, activo ? '1' : '0');
                log.info('[prime] ' + clave + ': ' + (activo ? 'ACTIVADO' : 'DESACTIVADO'));
                return json(res, { ok: true, clave, activo });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // PUT /api/prime/envio/:id_pedido — editar el costo de envío de un pedido
    // ya creado (caso real: Estafeta cotizó distinto a la simulación). Solo
    // usuario prime: cambia el total que se le cobra al cliente.
    if (req.method === 'PUT' && p.match(/^\/api\/prime\/envio\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const idPedido = parseInt(p.split('/')[4]);
        return readBody(req, body => {
            try {
                const parsed = validar(JSON.parse(body), CostoEnvioSchema, res);
                if (!parsed) return;
                const costo = parsed.costo_envio;

                const envio = db.prepare('SELECT id FROM envios WHERE id_pedido=? LIMIT 1').get(idPedido);
                if (!envio) return json(res, { ok:false, error:'Este pedido no tiene envío registrado' }, 404);
                db.prepare('UPDATE envios SET costo_envio=? WHERE id_pedido=?').run(costo, idPedido);

                const ped = db.prepare('SELECT subtotal, descuento FROM pedidos WHERE id_pedido=?').get(idPedido);
                if (ped) {
                    const nuevoTotal = (ped.subtotal || 0) - (ped.descuento || 0) + costo;
                    db.prepare("UPDATE pedidos SET total=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(nuevoTotal, idPedido);
                }
                return json(res, { ok:true, id_pedido: idPedido, costo_envio: costo });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/envio-default — costo de envío default global, sin
    // amarrarlo a un pedido. El pedido sigue siendo opcional: si se quiere
    // corregir uno en concreto se usa /api/prime/envio/:id_pedido (arriba).
    if (p === '/api/prime/envio-default' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='costo_envio_default' LIMIT 1").get();
        return json(res, { costo_envio_default: r ? Number(r.valor) : 149 });
    }
    if (p === '/api/prime/envio-default' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const parsed = validar(JSON.parse(body), CostoEnvioSchema, res);
                if (!parsed) return;
                const costo = parsed.costo_envio;
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('costo_envio_default', ?, datetime('now','localtime'))").run(String(costo));
                log.info('[prime] costo_envio_default actualizado: ' + costo);
                return json(res, { ok:true, costo_envio_default: costo });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/estafeta-dias-entrega — días hábiles que estafetaService.js
    // suma para estimar la fecha de entrega. Hardcodeado en 2 hasta ahora; en
    // fechas como navidad los pedidos se retrasan días extra y Estafeta no
    // confirma sábados de forma confiable, así que prime lo ajusta aquí sin tocar código.
    if (p === '/api/prime/estafeta-dias-entrega' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='estafeta_dias_entrega' LIMIT 1").get();
        return json(res, { dias_entrega: r ? Number(r.valor) : 2 });
    }
    if (p === '/api/prime/estafeta-dias-entrega' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const { dias_entrega } = JSON.parse(body);
                const dias = Number(dias_entrega);
                if (!Number.isInteger(dias) || dias < 1 || dias > 30) return json(res, { ok:false, error:'dias_entrega inválido (1-30)' }, 400);
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('estafeta_dias_entrega', ?, datetime('now','localtime'))").run(String(dias));
                log.info('[prime] estafeta_dias_entrega actualizado: ' + dias);
                return json(res, { ok:true, dias_entrega: dias });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/negocio — nombre comercial mostrado en el sidebar. Cualquier
    // sesión logueada puede leerlo (lo necesita el shell de React al cargar);
    // solo prime puede cambiarlo (abajo) — pensado para revender el panel a
    // otra juguetería sin editar código.
    if (p === '/api/negocio' && req.method === 'GET') {
        if (!requireSession(req, res)) return;
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='nombre_negocio' LIMIT 1").get();
        return json(res, { nombre_negocio: r ? r.valor : 'Julio Cepeda' });
    }
    if (p === '/api/prime/negocio' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), NegocioSchema, res);
                if (!datos) return;
                const { nombre_negocio } = datos;
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('nombre_negocio', ?, datetime('now','localtime'))").run(nombre_negocio);
                log.info('[prime] nombre_negocio actualizado: ' + nombre_negocio);
                return json(res, { ok: true, nombre_negocio });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/prime/palabras-filtro — lista negra + frases de queja: las BASE
    // (fijas en código, no editables) más las agregadas desde este panel.
    if (p === '/api/prime/palabras-filtro' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            return json(res, { items: filtroPalabras.listarTodas(db) });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // POST /api/prime/palabras-filtro — agregar palabra/frase personalizada.
    return next();
};
