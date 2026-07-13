'use strict';
// bot/flows/motor/interprete.js — el motor de flujo. Se registra como UN flow más
// en actionHandler (detrás del flag motor_flujo_activo, default OFF) y solo posee
// los pasos de tipo 'conversacion' del grafo ACTIVO. Fail-closed en 3 capas (§D.3):
// sin grafo activo, o si una acción lanza, devuelve undefined → router viejo.
// Ver DISENO_MOTOR_FLUJO.md §C.

const G = require('./grafo');
const A = require('./actions');
const { t } = require('../_config');
const sm = require('../../sessionManager');
const log = require('../../logger');

const MAX_REINTENTOS = 3;

// STEPS dinámico: los pasos de conversación del grafo activo. Sin grafo → [] →
// el router nunca despacha al motor y corren los FLOWS de código (byte-idéntico).
function _stepsActivos() {
    const g = G.cargarGrafoActivo();
    if (!g) return [];
    return Object.values(g.nodos).filter(n => n.tipo === 'conversacion').map(n => n.paso);
}

// matchInput(input, action, raw): resuelve un matcher de arista contra el mensaje.
// Cubre los casos que ya existen en código: dígito, keyword, regex, comodín.
// Las aristas 'resultado:' NO se matchean aquí (se eligen tras la acción, §resolverDestino).
function matchInput(input, action, raw) {
    if (!input) return false;
    if (input === '*') return true;
    if (input.startsWith('resultado:')) return false;
    if (input.startsWith('kw:')) return (action || '').includes(input.slice(3).toLowerCase());
    if (input.startsWith('regex:')) { try { return new RegExp(input.slice(6), 'i').test(raw || ''); } catch (_) { return false; } }
    return input === (action || '').trim();   // dígito o literal exacto
}

// Tras ejecutar la acción, ramifica por su `resultado` si hay una arista
// 'resultado:xxx'; si no, usa el destino de la arista de entrada.
function resolverDestino(aristas, aristaEntrada, resultado) {
    const porResultado = aristas.find(a => a.input === 'resultado:' + resultado);
    return (porResultado || aristaEntrada).destino;
}

// slotsToVars: session.data → {vars} que t() interpola. Se pasan tal cual (t
// ignora claves no referenciadas); se oculta el contador interno de reintentos.
function slotsToVars(data) {
    const { _reintentos, ...vars } = data || {};
    return vars;
}

// Render de un nodo: si declara `render` (una acción que ENVUELVE el código de
// render existente, ej. menuPrincipal/formatProducts), se usa esa salida —
// permite reproducir prompts DINÁMICOS byte-idénticos. Si no, el prompt estático
// sale de t(frase_clave). El layout dinámico queda en código (sellado como el
// dinero); solo el texto estático es editable por frase. Ver §A.2 / decisión Fase 3.
async function renderNodo(nodo, ctx, data) {
    if (nodo.render) {
        const r = await A.run(nodo.render, { ...ctx, data });
        return typeof r === 'string' ? r : (r && (r.texto ?? r.text)) || '';
    }
    return t(nodo.frase_clave, slotsToVars(data));
}

// Invoca directamente el flow de CÓDIGO dueño de un paso 'sistema' (handoff C.3),
// para que "conversación → checkout sellado" ocurra en el mismo turno.
let _FLOWS_SISTEMA = null;
function _flowsSistema() {
    if (_FLOWS_SISTEMA) return _FLOWS_SISTEMA;
    _FLOWS_SISTEMA = [
        require('../menuFlow'), require('../cartFlow'), require('../orderFlow'),
        require('../addressFlow'), require('../asesorFlow'),
    ];
    return _FLOWS_SISTEMA;
}
async function dispatchSistema(destino, ctx) {
    for (const f of _flowsSistema()) {
        if (Array.isArray(f.STEPS) && f.STEPS.includes(destino)) {
            return await f.handle({ ...ctx, step: destino });
        }
    }
    return undefined;   // ningún flow lo reclama → router viejo
}

async function handle(ctx) {
    const grafo = G.cargarGrafoActivo();
    const nodo  = grafo && grafo.nodos[ctx.step];
    if (!nodo || nodo.tipo === 'sistema') return undefined;   // no es del motor → router viejo

    // Nodo DELEGADO: el motor lo POSEE (topología en datos, editable por giro) pero
    // su turno lo procesa el flow de código existente → paridad byte GARANTIZADA por
    // correr la misma lógica (usado por la plantilla base jugueteria.json). Un giro
    // reemplaza `delegar` por aristas+render reales para tomar control como datos.
    if (nodo.params && nodo.params.delegar) return await dispatchSistema(ctx.step, ctx);

    // 1. resolver la arista contra el input del usuario
    const aristas = grafo.aristas[ctx.step] || [];
    const arista  = aristas.find(a => matchInput(a.input, ctx.action, ctx.raw));

    // 2. ningún matcher aplicó → reintento con límite y escape a asesor
    if (!arista) {
        const reintentos = (ctx.data._reintentos || 0) + 1;
        if (reintentos >= MAX_REINTENTOS) {
            sm.updateSession(ctx.userId, 'ASESOR', { ...ctx.data, _reintentos: 0 });
            try { A.run('escalar', ctx, { motivo: 'reintentos_motor' }); } catch (_) {}
            return t('escalar_asesor') || t('msg_asesor');
        }
        sm.updateSession(ctx.userId, ctx.step, { ...ctx.data, _reintentos: reintentos });
        return t(nodo.frase_clave + '_invalido') || await renderNodo(nodo, ctx, ctx.data);
    }

    // 3. acción de la transición (fail-closed: si lanza → router viejo)
    let res = { resultado: 'ok', data: {} };
    if (arista.accion) {
        try { res = await A.run(arista.accion, ctx, arista.params); }
        catch (e) { log.error('accion motor ' + arista.accion, e); return undefined; }
    }

    // 4. destino (fijo o ramificado por res.resultado)
    const destino     = resolverDestino(aristas, arista, res.resultado);
    const nodoDestino = grafo.nodos[destino];

    // 5. accion_entrada del destino (calcula slots antes de renderizar)
    let entradaData = {};
    if (nodoDestino && nodoDestino.accion_entrada) {
        try {
            const r = await A.run(nodoDestino.accion_entrada, { ...ctx, data: { ...ctx.data, ...res.data } }, nodoDestino.params);
            entradaData = r.data || {};
        } catch (e) { log.error('accion_entrada motor ' + nodoDestino.accion_entrada, e); return undefined; }
    }

    // 6. persistir slots + avanzar estado
    const nuevaData = { ...ctx.data, ...res.data, ...entradaData, _reintentos: 0 };
    sm.updateSession(ctx.userId, destino, nuevaData);

    // 7. destino de sistema → delega al flow de código (handoff en el mismo turno)
    if (nodoDestino && nodoDestino.tipo === 'sistema') {
        return await dispatchSistema(destino, { ...ctx, step: destino, data: nuevaData });
    }

    // 8. render del prompt del nodo destino (dinámico vía render, o estático vía frase)
    return nodoDestino ? await renderNodo(nodoDestino, ctx, nuevaData) : undefined;
}

module.exports = {
    get STEPS() { return _stepsActivos(); },
    handle, matchInput, resolverDestino,
};
