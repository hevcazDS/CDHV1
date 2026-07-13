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
    const nodos = Object.values(g.nodos).map(n => ({
        paso: n.paso, tipo: n.tipo, frase_clave: n.frase_clave, render: n.render,
        params: n.params, es_inicial: n.es_inicial, delegar: !!(n.params && n.params.delegar),
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

const RUTAS = [
    { metodo: 'GET',  path: '/api/prime/motor',            roles: ['prime'], handler: motorGet },
    { metodo: 'GET',  path: '/api/prime/motor/plantillas', roles: ['prime'], handler: plantillasGet },
    { metodo: 'POST', path: '/api/prime/motor/activar',    roles: ['prime'], handler: activarPost },
    { metodo: 'PUT',  path: '/api/prime/motor/nodo',       roles: ['prime'], handler: nodoPut },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/prime/motor' });
