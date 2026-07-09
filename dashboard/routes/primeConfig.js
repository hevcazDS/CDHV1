'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1518-1680 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function primeConfigRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, ConfigContactoSchema, ConfigEmailBotSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/tono' && req.method === 'GET') {
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='tono_bot' LIMIT 1").get();
            const tono = r && ['A','B','C','D'].includes(r.valor) ? r.valor : 'C';
            return json(res, { tono });
        } catch(_) { return json(res, { tono: 'C' }); }
    }

    // POST /api/tono — cambiar tono del bot {tono:'A'|'B'|'C'|'D'} (gerente+)
    if (p === '/api/tono' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                const tono = String((JSON.parse(body || '{}')).tono || '').toUpperCase();
                if (!['A','B','C','D'].includes(tono)) return json(res, { ok: false, error: 'Tono inválido. Usa A, B, C o D.' }, 400);
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('tono_bot', ?, datetime('now','localtime'))").run(tono);
                return json(res, { ok: true, tono });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/marketing/wa-link?campana=X — link wa.me compartible para
    // redes con la campaña embebida en el texto ([promo:X]); el bot la
    // captura en el primer mensaje → clientes.canal_origen (atribución).
    if (p === '/api/marketing/wa-link' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        const sp = new URL(req.url, 'http://x').searchParams;
        const campana = (sp.get('campana') || '').trim().slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_') || 'general';
        const num = String(db.prepare("SELECT valor FROM configuracion WHERE clave='operador_telefono'").get()?.valor
            || process.env.ASESOR_WHATSAPP || '').replace(/\D/g, '');
        if (!num) return json(res, { ok: false, error: 'Configura el teléfono del operador en Prime > General' }, 400);
        const texto = `Hola, quiero información [promo:${campana}]`;
        return json(res, { ok: true, campana, link: `https://wa.me/${num}?text=${encodeURIComponent(texto)}` });
    }

    // GET /api/modulos — estado de TODOS los módulos en UNA sola llamada
    // (rendimiento: Modulos.jsx hacía 17 requests en serie). Mapa {clave:activo}.
    if (p === '/api/modulos' && req.method === 'GET') {
        try {
            const { DEFAULT_OFF } = require('../../bot/flows/modulosDefaults');
            const filas = db.prepare("SELECT clave, valor FROM configuracion WHERE clave LIKE '%_activo'").all();
            const set = filas.reduce((m, r) => (m[r.clave] = r.valor !== '0', m), {});
            const claves = new URL(req.url, 'http://x').searchParams.get('claves');
            const pedidas = claves ? claves.split(',') : Object.keys(set);
            const out = {};
            for (const k of pedidas) out[k] = (k in set) ? set[k] : !DEFAULT_OFF.includes(k);
            return json(res, out);
        } catch (_) { return json(res, {}); }
    }

    // GET /api/modulo/:clave — estado de un módulo
    if (p.startsWith('/api/modulo/') && req.method === 'GET') {
        const clave = p.split('/').pop();
        try {
            const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
            // Por defecto activo, excepto los flags que arrancan apagados
            // hasta activarse explícitamente. Fuente única compartida con el
            // bot (bot/flows/modulosDefaults.js) para que ambos coincidan —
            // antes esta lista estaba duplicada aquí y se desincronizó.
            const { DEFAULT_OFF } = require('../../bot/flows/modulosDefaults');
            const defecto = !DEFAULT_OFF.includes(clave);
            return json(res, { clave, activo: r ? r.valor !== '0' : defecto });
        } catch(_) { return json(res, { clave, activo: true }); }
    }

    // ── Zonas de cobertura (ISP/servicio local, gerente+) ──────────────
    // Lista de CPs donde el negocio SÍ llega; vacía = sin restricción.
    if (p === '/api/zonas-cobertura' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        return json(res, db.prepare('SELECT * FROM zonas_cobertura ORDER BY cp').all());
    }
    if (p === '/api/zonas-cobertura' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const cps = [...new Set((Array.isArray(d.cps) ? d.cps : []).map(x => String(x).replace(/\D/g, '').slice(0, 5)).filter(x => x.length === 5))];
                db.transaction(() => {
                    db.prepare('DELETE FROM zonas_cobertura').run();
                    const ins = db.prepare('INSERT INTO zonas_cobertura (cp) VALUES (?)');
                    for (const cp of cps) ins.run(cp);
                })();
                return json(res, { ok: true, zonas: cps.length });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── Comisiones por vendedor (quien cobró la venta) — gerente+ ───────
    if (p === '/api/comisiones' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        const sp = new URL(req.url, 'http://x').searchParams;
        const hoy = new Date().toISOString().slice(0, 10);
        const desde = (sp.get('desde') || hoy.slice(0, 8) + '01').slice(0, 10);
        const hasta = (sp.get('hasta') || hoy).slice(0, 10);
        const pct = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='comision_pct'").get()?.valor || '0') || 0;
        const filas = db.prepare(`
            SELECT COALESCE(p2.cobrado_por, '(sin registrar)') vendedor,
                   COUNT(*) ventas, ROUND(SUM(lp.monto), 2) total
            FROM links_pago lp JOIN pedidos p2 ON p2.id_pedido = lp.id_pedido
            WHERE lp.estatus='pagado' AND date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ?
            GROUP BY COALESCE(p2.cobrado_por, '(sin registrar)') ORDER BY total DESC`).all(desde, hasta);
        return json(res, { desde, hasta, comision_pct: pct, filas: filas.map(f => ({ ...f, comision: Math.round(f.total * pct) / 100 })) });
    }
    if (p === '/api/comisiones/config' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                const pct = Math.max(0, Math.min(50, Number(JSON.parse(body || '{}').pct) || 0));
                db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('comision_pct', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(String(pct));
                return json(res, { ok: true, pct });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── Editor del bot (prime): personalizar las respuestas por instancia ──
    // GET lista cada frase editable con su texto EFECTIVO (tono+giro actuales)
    // y el override propio si existe; PUT guarda/borra el override en
    // configuracion ('frase_<clave>') — el bot lo recoge en <=60s (cache TTL).
    if (p === '/api/prime/frases' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const conf = require('../../bot/flows/_config');
        conf.invalidarCache();
        const DESCRIPCION = {
            saludo_nuevo: 'Saludo a cliente nuevo', saludo_recurrente: 'Saludo a cliente que regresa (usa {nombre})',
            menu_opciones: 'Opciones del menu principal', buscar_inicio: 'Al elegir "buscar"',
            wizard_q1: 'Primera pregunta del asistente de regalo', asesor_notificado: 'Al pasar con un asesor',
            agregado_pagar: 'Producto agregado al carrito', disponibilidad_local: 'Cuando hay stock local',
            cancelado: 'Al cancelar/regresar al menu', error_generico: 'Cuando algo falla',
            texto_libre: 'Cuando no entiende el mensaje', lista_espera_oferta: 'Oferta de lista de espera',
            gracias_cierre: 'Despedida al cerrar',
        };
        const filas = Object.keys(conf.FRASES).map(clave => ({
            clave,
            descripcion: DESCRIPCION[clave] || clave,
            efectivo: conf.t(clave),
            override: db.prepare('SELECT valor FROM configuracion WHERE clave=?').get('frase_' + clave)?.valor || null,
        }));
        return json(res, { frases: filas, variables: '{negocio} {negocio_corto} {item} {items} {emoji} {nombre}' });
    }
    if (p === '/api/prime/frases' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const conf = require('../../bot/flows/_config');
                if (!conf.FRASES[d.clave]) return json(res, { ok: false, error: 'Frase desconocida: ' + d.clave }, 400);
                const k = 'frase_' + d.clave;
                const texto = String(d.texto || '').trim();
                if (!texto) {
                    db.prepare('DELETE FROM configuracion WHERE clave=?').run(k);
                } else {
                    db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor').run(k, texto);
                }
                conf.invalidarCache();
                return json(res, { ok: true, clave: d.clave, efectivo: conf.t(d.clave) });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // POST /api/prime/exportar-llm — exporta el dataset conversacional y lo
    // manda por correo (backup) para entrenar un LLM APARTE, fuera de
    // producción. Solo prime. No entrena ni llama a ningún LLM aquí.
    if (p === '/api/prime/exportar-llm' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        const datasetExport = require('../../services/datasetExport');
        return datasetExport.exportarPorCorreo()
            .then(r => json(res, r, r.ok ? 200 : 400))
            .catch(e => { log.error('exportar-llm', e); return json(res, { ok: false, error: e.message }, 500); });
    }

    // ── Rutas exclusivas del usuario prime — encender APIs reales ──────────
    // (pago_real_activo / estafeta_real_activo). Invisibles/inalcanzables
    // para el usuario común: requieren credenciales propias desde .env.
    if (p === '/api/prime/config' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const claves = ['pago_real_activo', 'estafeta_real_activo', 'reconexion_auto_activo'];
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
                const datos = validar(JSON.parse(body), PrimeConfigSchema, res, p);
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
                const parsed = validar(JSON.parse(body), CostoEnvioSchema, res, p);
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
                const parsed = validar(JSON.parse(body), CostoEnvioSchema, res, p);
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
                const datos = validar(JSON.parse(body || '{}'), NegocioSchema, res, p);
                if (!datos) return;
                const { nombre_negocio } = datos;
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('nombre_negocio', ?, datetime('now','localtime'))").run(nombre_negocio);
                log.info('[prime] nombre_negocio actualizado: ' + nombre_negocio);
                return json(res, { ok: true, nombre_negocio });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/sucursal-facturacion-default — qué sucursal de la
    // tabla `sucursales` se usa como default de facturación: Prime > General
    // la elige una vez (Select); Fase 3 la usa en dos lugares -- el modal
    // "Ver ticket" puede mostrarla como referencia, y el alta de producto
    // (primeCatalogo.js) la usa para sembrar `inventarios` en una sola
    // sucursal en vez de las 11 (ver migrations/0005_sucursales_seed.sql).
    if (p === '/api/prime/sucursal-facturacion-default' && req.method === 'GET') {
        if (!requireSession(req, res)) return;
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='sucursal_facturacion_default' LIMIT 1").get();
        return json(res, { id_sucursal: r ? Number(r.valor) : null });
    }
    if (p === '/api/prime/sucursal-facturacion-default' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const { id_sucursal } = JSON.parse(body || '{}');
                const id = Number(id_sucursal);
                if (!Number.isInteger(id) || id <= 0) return json(res, { ok:false, error:'id_sucursal inválido' }, 400);
                const suc = db.prepare('SELECT id FROM sucursales WHERE id=?').get(id);
                if (!suc) return json(res, { ok:false, error:'Esa sucursal no existe' }, 404);
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('sucursal_facturacion_default', ?, datetime('now','localtime'))").run(String(id));
                log.info('[prime] sucursal_facturacion_default actualizada: ' + id);
                return json(res, { ok:true, id_sucursal: id });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/tope-descuento — tope de % de descuento que puede
    // crear un usuario admin en Ofertas/Cupones (validado server-side en
    // marketing.js's POST /api/promociones, no solo deshabilitando el input
    // en la UI). 0 o nunca configurado por debajo = sin tope. El GET es
    // público (cualquier sesión) para que Promociones.jsx pueda mostrar el
    // límite vigente al armar el formulario; solo prime puede cambiarlo.
    if (p === '/api/prime/tope-descuento' && req.method === 'GET') {
        if (!requireSession(req, res)) return;
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='tope_descuento_pct' LIMIT 1").get();
        return json(res, { tope_descuento_pct: r ? Number(r.valor) : 30 });
    }
    if (p === '/api/prime/tope-descuento' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const { tope_descuento_pct } = JSON.parse(body || '{}');
                const tope = Number(tope_descuento_pct);
                if (!Number.isFinite(tope) || tope < 0 || tope > 100) return json(res, { ok:false, error:'tope_descuento_pct inválido (0-100, 0 = sin tope)' }, 400);
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('tope_descuento_pct', ?, datetime('now','localtime'))").run(String(tope));
                log.info('[prime] tope_descuento_pct actualizado: ' + tope);
                return json(res, { ok:true, tope_descuento_pct: tope });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/pago-url — el link de pago que el negocio ya tiene
    // (Clip/Mercado Pago/PayPal.me), que el bot y el POS envían por WhatsApp.
    if (p === '/api/prime/pago-url' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        return json(res, { pago_url_base: db.prepare("SELECT valor FROM configuracion WHERE clave='pago_url_base'").get()?.valor || '' });
    }
    if (p === '/api/prime/pago-url' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const v = String(JSON.parse(body || '{}').pago_url_base || '').trim();
                if (v && !/^https?:\/\//i.test(v)) return json(res, { ok: false, error: 'El link debe empezar con http(s)://' }, 400);
                db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('pago_url_base', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(v);
                return json(res, { ok: true, pago_url_base: v });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/config-contacto — teléfono del operador (antes solo
    // ASESOR_WHATSAPP en .env), contacto de soporte (url/teléfono/correo) y
    // destino(s) de correo de los backups automáticos. Todo vía `bot/flows/
    // _config.js`'s getValor()/cache de 60s en el lado del bot — el dashboard
    // solo escribe la fila en `configuracion`.
    const CLAVES_CONTACTO = ['operador_telefono', 'soporte_url', 'soporte_telefono', 'soporte_correo', 'email_backup_destino'];
    if (p === '/api/prime/config-contacto' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            const out = {};
            for (const clave of CLAVES_CONTACTO) {
                const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
                out[clave] = r ? r.valor : '';
            }
            return json(res, out);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }
    if (p === '/api/prime/config-contacto' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), ConfigContactoSchema, res, p);
                if (!datos) return;
                for (const clave of CLAVES_CONTACTO) {
                    if (datos[clave] === undefined) continue;
                    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))").run(clave, datos[clave] || '');
                }
                log.info('[prime] config-contacto actualizada');
                return json(res, { ok: true });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/config-email-bot — correo + contraseña de aplicación
    // que usa el propio bot para enviar (antes solo EMAIL_USER/EMAIL_PASS en
    // .env, pensado para revender el panel a otra empresa sin tocar código).
    // El GET NUNCA regresa la contraseña -- solo si ya hay una guardada.
    if (p === '/api/prime/config-email-bot' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            const usuario = db.prepare("SELECT valor FROM configuracion WHERE clave='bot_email_usuario' LIMIT 1").get();
            const pass    = db.prepare("SELECT valor FROM configuracion WHERE clave='bot_email_password' LIMIT 1").get();
            return json(res, { bot_email_usuario: usuario ? usuario.valor : '', bot_email_password_configurada: !!(pass && pass.valor) });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }
    if (p === '/api/prime/config-email-bot' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), ConfigEmailBotSchema, res, p);
                if (!datos) return;
                if (datos.bot_email_usuario !== undefined) {
                    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('bot_email_usuario', ?, datetime('now','localtime'))").run(datos.bot_email_usuario || '');
                }
                if (datos.bot_email_password) {
                    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('bot_email_password', ?, datetime('now','localtime'))").run(datos.bot_email_password);
                }
                log.info('[prime] config-email-bot actualizada');
                return json(res, { ok: true });
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
