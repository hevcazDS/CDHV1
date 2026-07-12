'use strict';
// Configuración del bot/negocio (tono, módulos, comisiones, zona horaria,
// régimen fiscal, PAC, envío, tope de descuento, contacto, email del bot,
// frases, export LLM). Migrado al patrón declarativo del tronco. Gates mixtos:
// lecturas de config (tono/modulos/negocio/regimen/sucursal-default/tope/
// comisiones-mio/zona-horaria) → gate global; toggles operativos (tono POST,
// wa-link, zonas-cobertura, comisiones) → gerente; todo lo sensible de instancia
// (config/frases/pac/envío/pago-url/contacto/email/palabras-filtro GET) → prime.
// Sin opts.prefijo: mezcla prefijos (/api/tono, /api/modulos, /api/prime/*, …).
const construirModulo = require('./_construirModulo');

const CLAVES_CONTACTO = ['operador_telefono', 'soporte_url', 'soporte_telefono', 'soporte_correo', 'email_backup_destino'];

function tonoGet(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='tono_bot' LIMIT 1").get();
        return json(res, { tono: r && ['A', 'B', 'C', 'D'].includes(r.valor) ? r.valor : 'C' });
    } catch (_) { return json(res, { tono: 'C' }); }
}
function tonoPost(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const tono = String((JSON.parse(body || '{}')).tono || '').toUpperCase();
            if (!['A', 'B', 'C', 'D'].includes(tono)) return json(res, { ok: false, error: 'Tono inválido. Usa A, B, C o D.' }, 400);
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('tono_bot', ?, datetime('now','localtime'))").run(tono);
            return json(res, { ok: true, tono });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/marketing/wa-link?campana= — link wa.me compartible (gerente+)
function waLink(req, res, ctx) {
    const { db, json } = ctx;
    const sp = new URL(req.url, 'http://x').searchParams;
    const campana = (sp.get('campana') || '').trim().slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_') || 'general';
    const num = String(db.prepare("SELECT valor FROM configuracion WHERE clave='operador_telefono'").get()?.valor || process.env.ASESOR_WHATSAPP || '').replace(/\D/g, '');
    if (!num) return json(res, { ok: false, error: 'Configura el teléfono del operador en Prime > General' }, 400);
    const texto = `Hola, quiero información [promo:${campana}]`;
    return json(res, { ok: true, campana, link: `https://wa.me/${num}?text=${encodeURIComponent(texto)}` });
}

// GET /api/modulos — estado de todos los módulos (mapa {clave:activo})
function modulosGet(req, res, ctx) {
    const { db, json } = ctx;
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
function moduloGet(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const clave = params[0];
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        const { DEFAULT_OFF } = require('../../bot/flows/modulosDefaults');
        return json(res, { clave, activo: r ? r.valor !== '0' : !DEFAULT_OFF.includes(clave) });
    } catch (_) { return json(res, { clave, activo: true }); }
}

// ── Zonas de cobertura (gerente+) ──
function zonasGet(req, res, ctx) {
    return ctx.json(res, ctx.db.prepare('SELECT * FROM zonas_cobertura ORDER BY cp').all());
}
function zonasPost(req, res, ctx) {
    const { db, json, readBody } = ctx;
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

// ── Comisiones ──
function comisionesGet(req, res, ctx) {
    const { db, json } = ctx;
    const sp = new URL(req.url, 'http://x').searchParams;
    const hoy = new Date().toISOString().slice(0, 10);
    const desde = (sp.get('desde') || hoy.slice(0, 8) + '01').slice(0, 10);
    const hasta = (sp.get('hasta') || hoy).slice(0, 10);
    const pct = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='comision_pct'").get()?.valor || '0') || 0;
    const filas = db.prepare(`
        SELECT COALESCE(p2.cobrado_por, '(sin registrar)') vendedor, COUNT(*) ventas, ROUND(SUM(lp.monto), 2) total
        FROM links_pago lp JOIN pedidos p2 ON p2.id_pedido = lp.id_pedido
        WHERE lp.estatus='pagado' AND date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ?
        GROUP BY COALESCE(p2.cobrado_por, '(sin registrar)') ORDER BY total DESC`).all(desde, hasta);
    return json(res, { desde, hasta, comision_pct: pct, filas: filas.map(f => ({ ...f, comision: Math.round(f.total * pct) / 100 })) });
}
// GET /api/comisiones/mio — solo las propias (cualquier sesión). Pide sesión aquí.
function comisionesMio(req, res, ctx) {
    const { db, json, requireSession } = ctx;
    const ses = requireSession(req, res);
    if (!ses) return;
    const sp = new URL(req.url, 'http://x').searchParams;
    const hoy = new Date().toISOString().slice(0, 10);
    const desde = (sp.get('desde') || hoy.slice(0, 8) + '01').slice(0, 10);
    const hasta = (sp.get('hasta') || hoy).slice(0, 10);
    const pct = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='comision_pct'").get()?.valor || '0') || 0;
    const row = db.prepare(`
        SELECT COUNT(*) ventas, ROUND(COALESCE(SUM(lp.monto), 0), 2) total
        FROM links_pago lp JOIN pedidos p2 ON p2.id_pedido = lp.id_pedido
        WHERE lp.estatus='pagado' AND p2.cobrado_por = ? AND date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ?`).get(ses.username, desde, hasta);
    return json(res, { desde, hasta, comision_pct: pct, vendedor: ses.username, ventas: row.ventas || 0, total: row.total || 0, comision: Math.round((row.total || 0) * pct) / 100 });
}
function comisionesConfig(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const pct = Math.max(0, Math.min(50, Number(JSON.parse(body || '{}').pct) || 0));
            db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('comision_pct', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(String(pct));
            return json(res, { ok: true, pct });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Zona horaria ──
function zonaHorariaGet(req, res, ctx) {
    const { db, json } = ctx;
    const configurada = db.prepare("SELECT valor FROM configuracion WHERE clave='zona_horaria'").get()?.valor || null;
    return json(res, { configurada, default: 'America/Mexico_City', efectiva: process.env.TZ || 'America/Mexico_City' });
}
function zonaHorariaPut(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const v = String(JSON.parse(body || '{}').zona || '').trim();
            if (!v) return json(res, { ok: false, error: 'Falta la zona horaria (ej. America/Mexico_City)' }, 400);
            try { new Intl.DateTimeFormat('en-US', { timeZone: v }); }
            catch (_) { return json(res, { ok: false, error: 'Zona horaria inválida. Usa formato IANA, ej. America/Mexico_City' }, 400); }
            require('../../services/configAudit').logCambio(db, 'zona_horaria', v, ses.username);
            db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('zona_horaria', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(v);
            return json(res, { ok: true, zona: v, requiere_reinicio: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Editor de frases del bot (prime) ──
function frasesGet(req, res, ctx) {
    const { db, json } = ctx;
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
        clave, descripcion: DESCRIPCION[clave] || clave,
        efectivo: conf.t(clave),
        override: db.prepare('SELECT valor FROM configuracion WHERE clave=?').get('frase_' + clave)?.valor || null,
    }));
    return json(res, { frases: filas, variables: '{negocio} {negocio_corto} {item} {items} {emoji} {nombre}' });
}
function frasesPut(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const conf = require('../../bot/flows/_config');
            if (!conf.FRASES[d.clave]) return json(res, { ok: false, error: 'Frase desconocida: ' + d.clave }, 400);
            const k = 'frase_' + d.clave;
            const texto = String(d.texto || '').trim();
            if (!texto) db.prepare('DELETE FROM configuracion WHERE clave=?').run(k);
            else db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor').run(k, texto);
            conf.invalidarCache();
            return json(res, { ok: true, clave: d.clave, efectivo: conf.t(d.clave) });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/prime/exportar-llm — exporta el dataset por correo (async, prime)
function exportarLlm(req, res, ctx) {
    const { json, log } = ctx;
    return require('../../services/datasetExport').exportarPorCorreo()
        .then(r => json(res, r, r.ok ? 200 : 400))
        .catch(e => { log.error('exportar-llm', e); return json(res, { ok: false, error: e.message }, 500); });
}

// ── APIs reales (prime): pago_real/estafeta_real/reconexion_auto ──
function primeConfigGet(req, res, ctx) {
    const { db, json } = ctx;
    const claves = ['pago_real_activo', 'estafeta_real_activo', 'reconexion_auto_activo'];
    const out = {};
    for (const clave of claves) {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        out[clave] = r ? r.valor === '1' || r.valor === 'true' : false;
    }
    return json(res, out);
}
function primeConfigPost(req, res, ctx) {
    const { db, json, readBody, validar, log, PrimeConfigSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body), PrimeConfigSchema, res, '/api/prime/config');
            if (!datos) return;
            const { clave, activo } = datos;
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))").run(clave, activo ? '1' : '0');
            log.info('[prime] ' + clave + ': ' + (activo ? 'ACTIVADO' : 'DESACTIVADO'));
            return json(res, { ok: true, clave, activo });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// PUT /api/prime/envio/:id_pedido — corregir costo de envío de un pedido (prime)
function envioPut(req, res, ctx, { params }) {
    const { db, json, readBody, validar, CostoEnvioSchema } = ctx;
    const idPedido = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const parsed = validar(JSON.parse(body), CostoEnvioSchema, res, '/api/prime/envio');
            if (!parsed) return;
            const costo = parsed.costo_envio;
            const envio = db.prepare('SELECT id FROM envios WHERE id_pedido=? LIMIT 1').get(idPedido);
            if (!envio) return json(res, { ok: false, error: 'Este pedido no tiene envío registrado' }, 404);
            db.prepare('UPDATE envios SET costo_envio=? WHERE id_pedido=?').run(costo, idPedido);
            const ped = db.prepare('SELECT subtotal, descuento FROM pedidos WHERE id_pedido=?').get(idPedido);
            if (ped) {
                const nuevoTotal = (ped.subtotal || 0) - (ped.descuento || 0) + costo;
                db.prepare("UPDATE pedidos SET total=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(nuevoTotal, idPedido);
            }
            return json(res, { ok: true, id_pedido: idPedido, costo_envio: costo });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}
function envioDefaultGet(req, res, ctx) {
    const { db, json } = ctx;
    const r = db.prepare("SELECT valor FROM configuracion WHERE clave='costo_envio_default' LIMIT 1").get();
    return json(res, { costo_envio_default: r ? Number(r.valor) : 149 });
}
function envioDefaultPut(req, res, ctx) {
    const { db, json, readBody, validar, log, CostoEnvioSchema } = ctx;
    return readBody(req, body => {
        try {
            const parsed = validar(JSON.parse(body), CostoEnvioSchema, res, '/api/prime/envio-default');
            if (!parsed) return;
            const costo = parsed.costo_envio;
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('costo_envio_default', ?, datetime('now','localtime'))").run(String(costo));
            log.info('[prime] costo_envio_default actualizado: ' + costo);
            return json(res, { ok: true, costo_envio_default: costo });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

function estafetaDiasGet(req, res, ctx) {
    const { db, json } = ctx;
    const r = db.prepare("SELECT valor FROM configuracion WHERE clave='estafeta_dias_entrega' LIMIT 1").get();
    return json(res, { dias_entrega: r ? Number(r.valor) : 2 });
}
function estafetaDiasPut(req, res, ctx) {
    const { db, json, readBody, log } = ctx;
    return readBody(req, body => {
        try {
            const dias = Number(JSON.parse(body).dias_entrega);
            if (!Number.isInteger(dias) || dias < 1 || dias > 30) return json(res, { ok: false, error: 'dias_entrega inválido (1-30)' }, 400);
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('estafeta_dias_entrega', ?, datetime('now','localtime'))").run(String(dias));
            log.info('[prime] estafeta_dias_entrega actualizado: ' + dias);
            return json(res, { ok: true, dias_entrega: dias });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/negocio — nombre comercial (cualquier sesión)
function negocioGet(req, res, ctx) {
    const { db, json } = ctx;
    const r = db.prepare("SELECT valor FROM configuracion WHERE clave='nombre_negocio' LIMIT 1").get();
    return json(res, { nombre_negocio: r ? r.valor : 'Julio Cepeda' });
}
function negocioPut(req, res, ctx) {
    const { db, json, readBody, validar, log, NegocioSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), NegocioSchema, res, '/api/prime/negocio');
            if (!datos) return;
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('nombre_negocio', ?, datetime('now','localtime'))").run(datos.nombre_negocio);
            log.info('[prime] nombre_negocio actualizado: ' + datos.nombre_negocio);
            return json(res, { ok: true, nombre_negocio: datos.nombre_negocio });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Régimen fiscal ──
function regimenGet(req, res, ctx) {
    const { db, json } = ctx;
    const r = db.prepare("SELECT valor FROM configuracion WHERE clave='regimen_fiscal' LIMIT 1").get();
    return json(res, { regimen_fiscal: r ? r.valor : null });
}
function regimenPut(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const v = String(JSON.parse(body || '{}').regimen_fiscal || '').trim();
            if (!['resico', 'persona_fisica', 'persona_moral', 'otro'].includes(v)) return json(res, { ok: false, error: 'Régimen inválido' }, 400);
            require('../../services/configAudit').logCambio(db, 'regimen_fiscal', v, ses.username);
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('regimen_fiscal', ?, datetime('now','localtime'))").run(v);
            return json(res, { ok: true, regimen_fiscal: v });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── PAC (timbrado CFDI, prime) — GET no devuelve secretos ──
function pacGet(req, res, ctx) {
    const { db, json } = ctx;
    const g = (k) => db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(k)?.valor || '';
    const pac = require('../../services/pacService');
    return json(res, {
        proveedor: g('pac_proveedor'), rfc: g('pac_rfc'), ambiente: g('pac_ambiente') || 'sandbox',
        usuario: g('pac_usuario'), serie: g('pac_serie'),
        // Modelo key-only (Facturapi/Facturama): el PAC guarda el CSD, nosotros
        // solo la API key. NUNCA se devuelve la key, solo si está puesta.
        key_only: pac.esKeyOnly(g('pac_proveedor')), tiene_api_key: !!g('pac_api_key'),
        cp_receptor: g('pac_cp_receptor'), uso_cfdi: g('pac_uso_cfdi') || 'G03', registro_patronal: g('pac_registro_patronal'),
        regimen_receptor: g('pac_regimen_receptor') || '616',
        clave_prod_sat: g('pac_clave_prod_sat') || '01010101', clave_unidad: g('pac_clave_unidad') || 'H87',
        tiene_password: !!g('pac_password'), tiene_csd_cer: !!g('pac_csd_cer'),
        tiene_csd_key: !!g('pac_csd_key'), tiene_csd_pass: !!g('pac_csd_pass'),
        cifrado_activo: pac.cifradoActivo(db), configurado: pac.estaConfigurado(db), activo: pac.activo(db),
    });
}
function pacPut(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const pac = require('../../services/pacService');
            const set = (k, v) => db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))").run(k, String(v));
            if (d.cifrado_activo !== undefined) set('pac_cifrado_activo', d.cifrado_activo ? '1' : '0');
            const cifra = (d.cifrado_activo !== undefined ? !!d.cifrado_activo : pac.cifradoActivo(db));
            if (d.proveedor !== undefined) set('pac_proveedor', String(d.proveedor).trim());
            if (d.rfc !== undefined) set('pac_rfc', String(d.rfc).trim().toUpperCase());
            if (d.ambiente !== undefined) set('pac_ambiente', d.ambiente === 'produccion' ? 'produccion' : 'sandbox');
            if (d.usuario !== undefined) set('pac_usuario', String(d.usuario).trim());
            if (d.serie !== undefined) set('pac_serie', String(d.serie).trim());
            if (d.registro_patronal !== undefined) set('pac_registro_patronal', String(d.registro_patronal).trim());
            // Claves SAT del receptor/producto (no secretas)
            for (const [campo, clave] of [['cp_receptor', 'pac_cp_receptor'], ['uso_cfdi', 'pac_uso_cfdi'], ['regimen_receptor', 'pac_regimen_receptor'], ['clave_prod_sat', 'pac_clave_prod_sat'], ['clave_unidad', 'pac_clave_unidad']]) {
                if (d[campo] !== undefined) set(clave, String(d[campo]).trim());
            }
            // La API key (Facturapi sk_.../Facturama user:pass) SIEMPRE cifrada (secreto)
            if (d.api_key && String(d.api_key).trim()) set('pac_api_key', pac.cifrarSecreto(String(d.api_key).trim()));
            for (const [campo, clave] of [['password', 'pac_password'], ['csd_cer', 'pac_csd_cer'], ['csd_key', 'pac_csd_key'], ['csd_pass', 'pac_csd_pass']]) {
                if (d[campo] && String(d[campo]).trim()) {
                    const val = String(d[campo]).trim();
                    set(clave, cifra ? pac.cifrarSecreto(val) : val);
                }
            }
            require('../../services/configAudit').logCambio(db, 'pac_config', (d.proveedor || '') + '/' + (d.ambiente || ''), ses.username);
            return json(res, { ok: true, configurado: pac.estaConfigurado(db), activo: pac.activo(db), cifrado_activo: cifra });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Pasarela de pago (key-only + modo demo, prime) — GET no devuelve la key ──
function pasarelaGet(req, res, ctx) {
    const { db, json } = ctx;
    const g = (k) => db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(k)?.valor || '';
    const gw = require('../../services/gatewayService');
    return json(res, {
        proveedor: g('pago_proveedor'), ambiente: g('pago_ambiente') || 'live',
        demo: g('pago_demo') === '1', url_estatico: g('pago_url_base'),
        tiene_api_key: !!g('pago_api_key'),          // nunca se devuelve la key
        configurado: gw.estaConfigurado(db), disponible: gw.disponible(db),
        proveedores: ['stripe', 'mercadopago'],       // key-only soportados hoy
    });
}
function pasarelaPut(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const gw = require('../../services/gatewayService');
            const set = (k, v) => db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))").run(k, String(v));
            if (d.proveedor !== undefined) set('pago_proveedor', String(d.proveedor).trim().toLowerCase());
            if (d.ambiente !== undefined) set('pago_ambiente', d.ambiente === 'sandbox' ? 'sandbox' : 'live');
            if (d.demo !== undefined) set('pago_demo', d.demo ? '1' : '0');
            if (d.url_estatico !== undefined) set('pago_url_base', String(d.url_estatico).trim());
            if (d.return_url !== undefined) set('pago_return_url', String(d.return_url).trim());
            // La API key SIEMPRE cifrada; nunca se devuelve en el GET.
            if (d.api_key && String(d.api_key).trim()) set('pago_api_key', gw.cifrarSecreto(String(d.api_key).trim()));
            require('../../services/configAudit').logCambio(db, 'pasarela_config', (d.proveedor || '') + '/' + (d.demo ? 'demo' : d.ambiente || ''), ses.username);
            return json(res, { ok: true, configurado: gw.estaConfigurado(db), disponible: gw.disponible(db), demo: gw.demoActivo(db) });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Sucursal de facturación default ──
function sucursalDefaultGet(req, res, ctx) {
    const { db, json } = ctx;
    const r = db.prepare("SELECT valor FROM configuracion WHERE clave='sucursal_facturacion_default' LIMIT 1").get();
    return json(res, { id_sucursal: r ? Number(r.valor) : null });
}
function sucursalDefaultPut(req, res, ctx) {
    const { db, json, readBody, log } = ctx;
    return readBody(req, body => {
        try {
            const id = Number(JSON.parse(body || '{}').id_sucursal);
            if (!Number.isInteger(id) || id <= 0) return json(res, { ok: false, error: 'id_sucursal inválido' }, 400);
            if (!db.prepare('SELECT id FROM sucursales WHERE id=?').get(id)) return json(res, { ok: false, error: 'Esa sucursal no existe' }, 404);
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('sucursal_facturacion_default', ?, datetime('now','localtime'))").run(String(id));
            log.info('[prime] sucursal_facturacion_default actualizada: ' + id);
            return json(res, { ok: true, id_sucursal: id });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Tope de descuento ──
function topeGet(req, res, ctx) {
    const { db, json } = ctx;
    const r = db.prepare("SELECT valor FROM configuracion WHERE clave='tope_descuento_pct' LIMIT 1").get();
    return json(res, { tope_descuento_pct: r ? Number(r.valor) : 30 });
}
function topePut(req, res, ctx) {
    const { db, json, readBody, log } = ctx;
    return readBody(req, body => {
        try {
            const tope = Number(JSON.parse(body || '{}').tope_descuento_pct);
            if (!Number.isFinite(tope) || tope < 0 || tope > 100) return json(res, { ok: false, error: 'tope_descuento_pct inválido (0-100, 0 = sin tope)' }, 400);
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('tope_descuento_pct', ?, datetime('now','localtime'))").run(String(tope));
            log.info('[prime] tope_descuento_pct actualizado: ' + tope);
            return json(res, { ok: true, tope_descuento_pct: tope });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Pago URL ──
function pagoUrlGet(req, res, ctx) {
    return ctx.json(res, { pago_url_base: ctx.db.prepare("SELECT valor FROM configuracion WHERE clave='pago_url_base'").get()?.valor || '' });
}
function pagoUrlPut(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const v = String(JSON.parse(body || '{}').pago_url_base || '').trim();
            if (v && !/^https?:\/\//i.test(v)) return json(res, { ok: false, error: 'El link debe empezar con http(s)://' }, 400);
            db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('pago_url_base', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(v);
            return json(res, { ok: true, pago_url_base: v });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Contacto ──
function contactoGet(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const out = {};
        for (const clave of CLAVES_CONTACTO) out[clave] = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave)?.valor || '';
        return json(res, out);
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}
function contactoPut(req, res, ctx) {
    const { db, json, readBody, validar, log, ConfigContactoSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), ConfigContactoSchema, res, '/api/prime/config-contacto');
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

// ── Email del bot (GET nunca devuelve la contraseña) ──
function emailBotGet(req, res, ctx) {
    const { db, json } = ctx;
    try {
        const usuario = db.prepare("SELECT valor FROM configuracion WHERE clave='bot_email_usuario' LIMIT 1").get();
        const pass = db.prepare("SELECT valor FROM configuracion WHERE clave='bot_email_password' LIMIT 1").get();
        return json(res, { bot_email_usuario: usuario ? usuario.valor : '', bot_email_password_configurada: !!(pass && pass.valor) });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}
function emailBotPut(req, res, ctx) {
    const { db, json, readBody, validar, log, ConfigEmailBotSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), ConfigEmailBotSchema, res, '/api/prime/config-email-bot');
            if (!datos) return;
            if (datos.bot_email_usuario !== undefined) db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('bot_email_usuario', ?, datetime('now','localtime'))").run(datos.bot_email_usuario || '');
            if (datos.bot_email_password) db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('bot_email_password', ?, datetime('now','localtime'))").run(datos.bot_email_password);
            log.info('[prime] config-email-bot actualizada');
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/prime/palabras-filtro — lista negra + frases de queja (prime)
function palabrasFiltroGet(req, res, ctx) {
    const { db, json, filtroPalabras } = ctx;
    try { return json(res, { items: filtroPalabras.listarTodas(db) }); }
    catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/tono',                                    handler: tonoGet },
    { metodo: 'POST', path: '/api/tono',                                    roles: ['gerente'], handler: tonoPost },
    { metodo: 'GET',  path: '/api/marketing/wa-link',                       roles: ['gerente'], handler: waLink },
    { metodo: 'GET',  path: '/api/modulos',                                 handler: modulosGet },
    { metodo: 'GET',  path: /^\/api\/modulo\/(.+)$/,                        handler: moduloGet },
    { metodo: 'GET',  path: '/api/zonas-cobertura',                         roles: ['gerente'], handler: zonasGet },
    { metodo: 'POST', path: '/api/zonas-cobertura',                         roles: ['gerente'], handler: zonasPost },
    { metodo: 'GET',  path: '/api/comisiones',                              roles: ['gerente'], handler: comisionesGet },
    { metodo: 'GET',  path: '/api/comisiones/mio',                          handler: comisionesMio },
    { metodo: 'POST', path: '/api/comisiones/config',                       roles: ['gerente'], handler: comisionesConfig },
    { metodo: 'GET',  path: '/api/zona-horaria',                            handler: zonaHorariaGet },
    { metodo: 'PUT',  path: '/api/zona-horaria',                            roles: ['prime'], handler: zonaHorariaPut },
    { metodo: 'GET',  path: '/api/prime/frases',                            roles: ['prime'], handler: frasesGet },
    { metodo: 'PUT',  path: '/api/prime/frases',                            roles: ['prime'], handler: frasesPut },
    { metodo: 'POST', path: '/api/prime/exportar-llm',                      roles: ['prime'], handler: exportarLlm },
    { metodo: 'GET',  path: '/api/prime/config',                            roles: ['prime'], handler: primeConfigGet },
    { metodo: 'POST', path: '/api/prime/config',                            roles: ['prime'], handler: primeConfigPost },
    { metodo: 'PUT',  path: /^\/api\/prime\/envio\/(\d+)$/,                 roles: ['prime'], handler: envioPut },
    { metodo: 'GET',  path: '/api/prime/envio-default',                     roles: ['prime'], handler: envioDefaultGet },
    { metodo: 'PUT',  path: '/api/prime/envio-default',                     roles: ['prime'], handler: envioDefaultPut },
    { metodo: 'GET',  path: '/api/prime/estafeta-dias-entrega',             roles: ['prime'], handler: estafetaDiasGet },
    { metodo: 'PUT',  path: '/api/prime/estafeta-dias-entrega',             roles: ['prime'], handler: estafetaDiasPut },
    { metodo: 'GET',  path: '/api/negocio',                                 handler: negocioGet },
    { metodo: 'PUT',  path: '/api/prime/negocio',                           roles: ['prime'], handler: negocioPut },
    { metodo: 'GET',  path: '/api/regimen-fiscal',                          handler: regimenGet },
    { metodo: 'PUT',  path: '/api/regimen-fiscal',                          roles: ['prime'], handler: regimenPut },
    { metodo: 'GET',  path: '/api/prime/pac',                               roles: ['prime'], handler: pacGet },
    { metodo: 'PUT',  path: '/api/prime/pac',                               roles: ['prime'], handler: pacPut },
    { metodo: 'GET',  path: '/api/prime/pasarela',                          roles: ['prime'], handler: pasarelaGet },
    { metodo: 'PUT',  path: '/api/prime/pasarela',                          roles: ['prime'], handler: pasarelaPut },
    { metodo: 'GET',  path: '/api/prime/sucursal-facturacion-default',      handler: sucursalDefaultGet },
    { metodo: 'PUT',  path: '/api/prime/sucursal-facturacion-default',      roles: ['prime'], handler: sucursalDefaultPut },
    { metodo: 'GET',  path: '/api/prime/tope-descuento',                    handler: topeGet },
    { metodo: 'PUT',  path: '/api/prime/tope-descuento',                    roles: ['prime'], handler: topePut },
    { metodo: 'GET',  path: '/api/prime/pago-url',                          roles: ['prime'], handler: pagoUrlGet },
    { metodo: 'PUT',  path: '/api/prime/pago-url',                          roles: ['prime'], handler: pagoUrlPut },
    { metodo: 'GET',  path: '/api/prime/config-contacto',                   roles: ['prime'], handler: contactoGet },
    { metodo: 'PUT',  path: '/api/prime/config-contacto',                   roles: ['prime'], handler: contactoPut },
    { metodo: 'GET',  path: '/api/prime/config-email-bot',                  roles: ['prime'], handler: emailBotGet },
    { metodo: 'PUT',  path: '/api/prime/config-email-bot',                  roles: ['prime'], handler: emailBotPut },
    { metodo: 'GET',  path: '/api/prime/palabras-filtro',                   roles: ['prime'], handler: palabrasFiltroGet },
];

module.exports = construirModulo(RUTAS);
