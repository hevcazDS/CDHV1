'use strict';
// bot/flows/motor/grafo.js — carga el grafo ACTIVO de la instancia desde SQLite
// (flujo_grafo/flujo_nodo/flujo_arista) a una forma en memoria cómoda para el
// intérprete. Caché de 60s (mismo patrón que _config.js) para no pegarle a la BD
// en cada mensaje. Devuelve null si no hay grafo activo+válido → fail-closed (§D.3).

const db = require('../../db_connection');

let _cache = null;
let _cacheTs = 0;
const TTL_MS = 60 * 1000;

function _parse(json) {
    try { return JSON.parse(json || '{}'); } catch (_) { return {}; }
}

// { id, giro_base, inicial, nodos:{paso:{...}}, aristas:{paso:[{...}]} } | null
function cargarGrafoActivo() {
    if (_cache && Date.now() - _cacheTs < TTL_MS) return _cache;
    _cacheTs = Date.now();
    _cache = null;

    let g;
    try {
        g = db.prepare('SELECT * FROM flujo_grafo WHERE activo = 1 AND valido = 1 ORDER BY version DESC LIMIT 1').get();
    } catch (_) {
        // tabla ausente (BD sin migración 0065) → sin motor, router viejo.
        return null;
    }
    if (!g) return null;

    const nodosRaw   = db.prepare('SELECT * FROM flujo_nodo WHERE id_grafo = ?').all(g.id);
    const aristasRaw = db.prepare('SELECT * FROM flujo_arista WHERE id_grafo = ? ORDER BY paso, orden').all(g.id);

    const nodos = {};
    let inicial = null;
    for (const n of nodosRaw) {
        nodos[n.paso] = {
            paso: n.paso, tipo: n.tipo, frase_clave: n.frase_clave,
            accion_entrada: n.accion_entrada, render: n.render, params: _parse(n.params_json),
            es_inicial: !!n.es_inicial, pos_x: n.pos_x ?? null, pos_y: n.pos_y ?? null,
        };
        if (n.es_inicial) inicial = n.paso;
    }
    const aristas = {};
    for (const a of aristasRaw) {
        (aristas[a.paso] = aristas[a.paso] || []).push({
            orden: a.orden, label: a.label, input: a.input, destino: a.destino,
            accion: a.accion, params: _parse(a.params_json),
        });
    }

    _cache = { id: g.id, giro_base: g.giro_base, inicial, nodos, aristas };
    return _cache;
}

// Invalida la caché (tras guardar un grafo desde Prime, Fase 5).
function invalidar() { _cache = null; _cacheTs = 0; }

module.exports = { cargarGrafoActivo, invalidar };
