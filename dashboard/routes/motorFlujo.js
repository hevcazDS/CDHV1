'use strict';
// dashboard/routes/motorFlujo.js — editor del motor de flujo (Prime, Fase 5).
// Lee el grafo ACTIVO de la instancia y permite ajustar los PARÁMETROS de un
// nodo (ej. porcentaje de anticipo 30↔50) sin deploy, re-corriendo el linter
// antes de conservar el grafo activo. La topología/aristas y la lógica sellada
// NO se editan aquí (eso es la frontera de seguridad, §D). Ver DISENO_MOTOR_FLUJO.md §B.1.
const fs = require('fs');
const path = require('path');
const construirModulo = require('./_construirModulo');
const grafo = require('../../bot/flows/motor/grafo');
const linter = require('../../bot/flows/motor/linter');
const seeder = require('../../bot/flows/motor/seeder');

const DIR_PLANTILLAS = path.join(__dirname, '..', '..', 'bot', 'flows', 'motor', 'plantillas');

// M3: qué ES cada pieza del flujo base, en lenguaje humano (subtítulo del nodo
// y panel del lienzo). Solo las piezas que aparecen en plantillas/grafos reales.
const DESCRIPCIONES_PASO = {
    MENU:          'El menú principal. Aquí empieza y regresa la conversación.',
    SEARCHING:     'El cliente busca un producto escribiendo lo que quiere.',
    VIEW_PRODUCT:  'El cliente ve el detalle de un producto y decide si lo lleva.',
    VARIANTE:      'El cliente elige talla/color/variante del producto.',
    ADD_MORE:      '¿Agregar algo más o pasar a pagar?',
    WIZARD_Q1:     'Asistente de regalo: pregunta 1 (edad).',
    WIZARD_Q2:     'Asistente de regalo: pregunta 2 (género).',
    WIZARD_Q3:     'Asistente de regalo: pregunta 3 (presupuesto).',
    REFERIDOS:     'El cliente ve su código de referidos y lo comparte.',
    SHOW_CART:     'El carrito: ver, quitar o confirmar. Pieza del checkout.',
    CONFIRM_ORDER: 'Confirmación final del pedido. Pieza del checkout.',
    ASK_CP:        'Pide el código postal para calcular la entrega.',
    ASESOR:        'Relevo a humano: el bot guarda silencio y avisa al equipo.',
    CITA_SERVICIO: 'El cliente elige qué servicio quiere agendar.',
    CITA_FECHA:    'El cliente elige el día de su cita.',
    CITA_HORA:     'El cliente elige la hora de su cita.',
    CITA_CONFIRMA: 'Confirmación de la cita (y anticipo si está configurado).',
    MESA_ABRIR:    'Abre la cuenta de una mesa (restaurante).',
    MESA_CONSUMO:  'La mesa pide artículos a su cuenta (restaurante).',
};

// GET /api/prime/motor/acciones — M2: paleta de acciones con metadata humana.
function accionesGet(req, res, ctx) {
    const { CATALOGO } = require('../../bot/flows/motor/actions');
    return ctx.json(res, { acciones: Object.entries(CATALOGO).map(([id, m]) => ({ id, ...m })) });
}

// GET /api/prime/motor/plantillas — presets de flujo "congelados" disponibles.
function plantillasGet(req, res, ctx) {
    const { json } = ctx;
    let nombres = [];
    try { nombres = fs.readdirSync(DIR_PLANTILLAS).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort(); }
    catch (_) {}
    return json(res, { plantillas: nombres });
}

// POST /api/prime/motor/activar — { plantilla } siembra ese preset y lo deja
// ACTIVO (desactiva el anterior). Es cómo se "sustituye el flujo actual por otro
// congelado". Rechaza si el preset no pasa el linter (fail-closed).
function activarPost(req, res, ctx) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, body => {
        const nombre = String(body.plantilla || '').trim();
        if (!/^[a-z0-9_]+$/i.test(nombre)) return json(res, { ok: false, error: 'Plantilla inválida' }, 400);
        let plantilla;
        try { plantilla = seeder.cargarPlantilla(nombre); }
        catch (_) { return json(res, { ok: false, error: 'No existe la plantilla ' + nombre }, 404); }
        const r = seeder.sembrar(db, plantilla, { activar: true });
        if (!r.valido) {
            // No dejar un grafo inválido "activo": eliminarlo.
            try { db.prepare('DELETE FROM flujo_grafo WHERE id=?').run(r.id); grafo.invalidar(); } catch (_) {}
            return json(res, { ok: false, error: 'La plantilla no pasó el linter', errs: r.errs }, 400);
        }
        grafo.invalidar();
        return json(res, { ok: true, id: r.id, giro_base: plantilla.giro_base });
    });
}

// GET /api/prime/motor — el grafo activo + estado del flag del motor.
function motorGet(req, res, ctx) {
    const { db, json } = ctx;
    const g = grafo.cargarGrafoActivo();
    const flag = (() => {
        try { return db.prepare("SELECT valor FROM configuracion WHERE clave='motor_flujo_activo'").get()?.valor === '1'; }
        catch (_) { return false; }
    })();
    if (!g) return json(res, { activo: false, motor_activo: flag, giro_base: null, nodos: [], aristas: [] });
    // M1: texto efectivo de cada pieza (t() resuelve overrides frase_<clave>) para
    // que el lienzo lo muestre/edite sin ir a otra pestaña.
    const conf = require('../../bot/flows/_config');
    conf.invalidarCache();
    const nodos = Object.values(g.nodos).map(n => ({
        paso: n.paso, tipo: n.tipo, frase_clave: n.frase_clave, render: n.render,
        params: n.params, es_inicial: n.es_inicial, delegar: !!(n.params && n.params.delegar),
        pos_x: n.pos_x, pos_y: n.pos_y,
        texto: n.frase_clave ? conf.t(n.frase_clave) : null,
        descripcion: DESCRIPCIONES_PASO[n.paso] || null,
    }));
    const aristas = Object.entries(g.aristas).flatMap(([paso, arr]) =>
        arr.map(a => ({ paso, orden: a.orden, label: a.label, input: a.input, destino: a.destino, accion: a.accion, params: a.params })));
    return json(res, { activo: true, motor_activo: flag, giro_base: g.giro_base, id: g.id, nodos, aristas });
}

// PUT /api/prime/motor/nodo — { paso, params } ajusta params_json de un nodo del
// grafo activo. Re-lintea con el cambio aplicado: si el grafo dejaría de ser
// válido, NO persiste y devuelve los errores (fail-closed, el grafo bueno queda intacto).
function nodoPut(req, res, ctx) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, body => {
        const paso = String(body.paso || '').trim();
        const params = body.params;
        if (!paso || params == null || typeof params !== 'object') return json(res, { ok: false, error: 'paso y params requeridos' }, 400);

        const g = grafo.cargarGrafoActivo();
        if (!g || !g.nodos[paso]) return json(res, { ok: false, error: 'nodo no encontrado en el grafo activo' }, 404);

        // Lintear una COPIA con el cambio aplicado antes de tocar la BD.
        const copia = { inicial: g.inicial, aristas: g.aristas,
            nodos: { ...g.nodos, [paso]: { ...g.nodos[paso], params } } };
        const val = linter.validar(copia);
        if (!val.ok) return json(res, { ok: false, error: 'el cambio invalidaría el grafo', errs: val.errs }, 400);

        db.prepare('UPDATE flujo_nodo SET params_json=? WHERE id_grafo=? AND paso=?').run(JSON.stringify(params), g.id, paso);
        grafo.invalidar();
        return json(res, { ok: true });
    });
}

// PUT /api/prime/motor/grafo — guarda el grafo COMPLETO del editor visual como
// VERSIÓN NUEVA (la anterior queda inactiva, para revertir). Body:
//   { nodos: [{paso,tipo,frase_clave,accion_entrada,render,params,es_inicial,pos_x,pos_y}],
//     aristas: [{paso,orden,label,input,destino,accion,params}] }
// Candados de la frontera sellada (§D), aplicados en el SERVIDOR (el lienzo solo
// los refleja): un nodo 'sistema' o delegado existente no puede cambiar su
// tipo/accion_entrada/render ni borrarse — solo posición, frase_clave y params
// whitelisted. Lintea ANTES de activar; si falla, no persiste nada.
function grafoPut(req, res, ctx) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, body => {
        const nodos = Array.isArray(body.nodos) ? body.nodos : null;
        const aristas = Array.isArray(body.aristas) ? body.aristas : [];
        if (!nodos || !nodos.length) return json(res, { ok: false, error: 'nodos requeridos' }, 400);

        const actual = grafo.cargarGrafoActivo();
        const porPaso = {};
        for (const n of nodos) {
            const paso = String(n.paso || '').trim();
            if (!/^[A-Z0-9_]+$/i.test(paso)) return json(res, { ok: false, error: 'paso inválido: ' + n.paso }, 400);
            if (porPaso[paso]) return json(res, { ok: false, error: 'paso duplicado: ' + paso }, 400);
            porPaso[paso] = n;
        }

        // Candados contra el grafo activo actual (si existe).
        if (actual) {
            for (const [paso, na] of Object.entries(actual.nodos)) {
                const sellado = na.tipo === 'sistema' || (na.params && na.params.delegar);
                if (!sellado) continue;
                const nn = porPaso[paso];
                if (!nn) return json(res, { ok: false, error: 'no se puede borrar el nodo sellado ' + paso }, 400);
                if ((nn.tipo || 'conversacion') !== na.tipo) return json(res, { ok: false, error: 'no se puede cambiar el tipo del nodo sellado ' + paso }, 400);
                if ((nn.accion_entrada || null) !== (na.accion_entrada || null) || (nn.render || null) !== (na.render || null)) {
                    return json(res, { ok: false, error: 'no se puede cambiar la acción/render del nodo sellado ' + paso }, 400);
                }
                if (na.params && na.params.delegar && !(nn.params && nn.params.delegar)) {
                    return json(res, { ok: false, error: 'no se puede des-delegar ' + paso + ' desde el editor' }, 400);
                }
            }
        }

        // Lintear la forma en memoria ANTES de tocar la BD.
        const mem = { inicial: (nodos.find(n => n.es_inicial) || {}).paso || null, nodos: {}, aristas: {} };
        for (const n of nodos) mem.nodos[n.paso] = { paso: n.paso, tipo: n.tipo || 'conversacion', accion_entrada: n.accion_entrada || null, params: n.params || {}, es_inicial: !!n.es_inicial };
        // M2: una acción desconocida truena mejor al GUARDAR que en runtime.
        const { ACTIONS } = require('../../bot/flows/motor/actions');
        for (const n of nodos) {
            if (n.accion_entrada && !ACTIONS[n.accion_entrada]) return json(res, { ok: false, error: 'acción desconocida en ' + n.paso + ': ' + n.accion_entrada }, 400);
        }
        for (const a of aristas) {
            if (!porPaso[a.paso]) return json(res, { ok: false, error: 'arista desde nodo inexistente: ' + a.paso }, 400);
            if (a.accion && !ACTIONS[a.accion]) return json(res, { ok: false, error: 'acción desconocida en el cable ' + a.paso + ' → ' + a.destino + ': ' + a.accion }, 400);
            (mem.aristas[a.paso] = mem.aristas[a.paso] || []).push({ input: String(a.input || ''), destino: String(a.destino || ''), accion: a.accion || null, params: a.params || {} });
        }
        const val = linter.validar(mem);
        if (!val.ok) return json(res, { ok: false, error: 'el grafo no pasa el linter', errs: val.errs }, 400);

        // Persistir como versión nueva activa (transaccional).
        const tx = db.transaction(() => {
            const ver = (db.prepare('SELECT MAX(version) v FROM flujo_grafo').get().v || 0) + 1;
            db.prepare('UPDATE flujo_grafo SET activo=0').run();
            const gid = db.prepare('INSERT INTO flujo_grafo (version, giro_base, activo, valido) VALUES (?,?,1,1)')
                .run(ver, actual?.giro_base || null).lastInsertRowid;
            const insN = db.prepare('INSERT INTO flujo_nodo (id_grafo, paso, tipo, render, frase_clave, accion_entrada, params_json, es_inicial, pos_x, pos_y) VALUES (?,?,?,?,?,?,?,?,?,?)');
            const insA = db.prepare('INSERT INTO flujo_arista (id_grafo, paso, orden, label, input, destino, accion, params_json) VALUES (?,?,?,?,?,?,?,?)');
            for (const n of nodos) {
                insN.run(gid, n.paso, n.tipo || 'conversacion', n.render || null, n.frase_clave || null,
                    n.accion_entrada || null, JSON.stringify(n.params || {}), n.es_inicial ? 1 : 0,
                    Number.isFinite(n.pos_x) ? n.pos_x : null, Number.isFinite(n.pos_y) ? n.pos_y : null);
            }
            // Orden determinista: el comodín '*' SIEMPRE al final por paso — si se
            // dibujara antes que "opción 1", el matching (aristas.find) se lo tragaría todo.
            const esComodin = a => a.input === '*' ? 1 : 0;
            const ordenadas = [...aristas].sort((x, y) => (x.paso < y.paso ? -1 : x.paso > y.paso ? 1 : esComodin(x) - esComodin(y)));
            const ordenPor = {};
            for (const a of ordenadas) {
                const o = (ordenPor[a.paso] = (ordenPor[a.paso] || 0) + 1);
                insA.run(gid, a.paso, o, a.label || null, String(a.input), String(a.destino), a.accion || null, JSON.stringify(a.params || {}));
            }
            return { gid, ver };
        });
        const r = tx();
        grafo.invalidar();
        // media #4: avisar si el motor está APAGADO (guardas y el bot no cambia)
        const flag = (() => { try { return db.prepare("SELECT valor FROM configuracion WHERE clave='motor_flujo_activo'").get()?.valor === '1'; } catch (_) { return false; } })();
        return json(res, { ok: true, id: r.gid, version: r.ver, motor_activo: flag, warns: val.warns || [] });
    });
}

// ── M4: historial de versiones + revertir ────────────────────────────────────
// Cada guardado del lienzo y cada "Cambiar a este diseño" deja la versión
// anterior inactiva en flujo_grafo — esto la lista y permite restaurarla.
function versionesGet(req, res, ctx) {
    const { db, json } = ctx;
    const filas = db.prepare(`
        SELECT g.id, g.version, g.giro_base, g.activo, g.valido, g.creado_en,
               (SELECT COUNT(*) FROM flujo_nodo n WHERE n.id_grafo = g.id) AS nodos
        FROM flujo_grafo g ORDER BY g.version DESC LIMIT 30`).all();
    return json(res, { versiones: filas });
}

// POST /api/prime/motor/revertir { id } — re-activa una versión anterior,
// re-linteándola primero (fail-closed: una versión que ya no pasa el linter
// no se restaura y el grafo activo actual queda intacto).
function revertirPost(req, res, ctx) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, body => {
        const id = Number(body.id) || 0;
        const g = db.prepare('SELECT * FROM flujo_grafo WHERE id=?').get(id);
        if (!g) return json(res, { ok: false, error: 'Versión no encontrada' }, 404);
        if (g.activo) return json(res, { ok: false, error: 'Esa versión ya es la activa' }, 400);
        // Cargar esa versión a la forma en memoria y re-lintear.
        const nodosRaw = db.prepare('SELECT * FROM flujo_nodo WHERE id_grafo=?').all(id);
        const aristasRaw = db.prepare('SELECT * FROM flujo_arista WHERE id_grafo=? ORDER BY paso, orden').all(id);
        const mem = { inicial: null, nodos: {}, aristas: {} };
        for (const n of nodosRaw) {
            let params = {}; try { params = JSON.parse(n.params_json || '{}'); } catch (_) {}
            mem.nodos[n.paso] = { paso: n.paso, tipo: n.tipo, accion_entrada: n.accion_entrada, params, es_inicial: !!n.es_inicial };
            if (n.es_inicial) mem.inicial = n.paso;
        }
        for (const a of aristasRaw) {
            let params = {}; try { params = JSON.parse(a.params_json || '{}'); } catch (_) {}
            (mem.aristas[a.paso] = mem.aristas[a.paso] || []).push({ input: a.input, destino: a.destino, accion: a.accion, params });
        }
        const val = linter.validar(mem);
        if (!val.ok) return json(res, { ok: false, error: 'esa versión ya no pasa el linter', errs: val.errs }, 400);
        db.transaction(() => {
            db.prepare('UPDATE flujo_grafo SET activo=0').run();
            db.prepare('UPDATE flujo_grafo SET activo=1, valido=1 WHERE id=?').run(id);
        })();
        grafo.invalidar();
        return json(res, { ok: true, id, version: g.version });
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/prime/motor',            roles: ['prime'], handler: motorGet },
    { metodo: 'GET',  path: '/api/prime/motor/versiones',  roles: ['prime'], handler: versionesGet },
    { metodo: 'POST', path: '/api/prime/motor/revertir',   roles: ['prime'], handler: revertirPost },
    { metodo: 'GET',  path: '/api/prime/motor/plantillas', roles: ['prime'], handler: plantillasGet },
    { metodo: 'GET',  path: '/api/prime/motor/acciones',   roles: ['prime'], handler: accionesGet },
    { metodo: 'POST', path: '/api/prime/motor/activar',    roles: ['prime'], handler: activarPost },
    { metodo: 'PUT',  path: '/api/prime/motor/grafo',      roles: ['prime'], handler: grafoPut },
    { metodo: 'PUT',  path: '/api/prime/motor/nodo',       roles: ['prime'], handler: nodoPut },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/prime/motor' });
module.exports._test = { grafoPut, activarPost, versionesGet, revertirPost, accionesGet };   // contract tests (sin HTTP)
