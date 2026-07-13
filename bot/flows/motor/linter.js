'use strict';
// bot/flows/motor/linter.js — valida un grafo ANTES de marcarlo activo (§D.2).
// Corre en el endpoint de guardado (Fase 5), NUNCA en runtime: un grafo solo
// llega a producción con valido=1. Un grafo inválido jamás se interpreta (§D.3).

// Acciones que cobran un anticipo parcial: exigen params.porcentaje > 0. Es la
// regla anti-"vender gratis" (§D.2 #4). grabar_pedido_* cobra el carrito completo
// (monto siempre presente), no lleva porcentaje.
const ACCIONES_ANTICIPO = new Set(['cobrar_anticipo']);

// grafo: { inicial, nodos:{paso:{...}}, aristas:{paso:[{...}]} }
function validar(grafo) {
    const errs = [];
    if (!grafo || !grafo.nodos || !Object.keys(grafo.nodos).length) {
        return { ok: false, errs: ['grafo vacío'] };
    }
    const pasos = new Set(Object.keys(grafo.nodos));

    // 0) nodo inicial presente y existente
    if (!grafo.inicial || !pasos.has(grafo.inicial)) {
        errs.push('sin nodo inicial (es_inicial) válido');
    }

    // 1) destino colgante — toda arista apunta a un nodo real (§D.2 #2)
    for (const [orig, aristas] of Object.entries(grafo.aristas || {})) {
        for (const a of aristas) {
            if (!pasos.has(a.destino)) errs.push(`destino colgante: ${orig} → ${a.destino}`);
            // 4) anti-"vender gratis": acción de anticipo sin porcentaje (§D.2 #4)
            if (a.accion && ACCIONES_ANTICIPO.has(a.accion) && !((a.params || {}).porcentaje > 0)) {
                errs.push(`cobro de anticipo sin porcentaje: ${orig} → ${a.destino}`);
            }
        }
    }
    for (const n of Object.values(grafo.nodos)) {
        if (n.accion_entrada && ACCIONES_ANTICIPO.has(n.accion_entrada) && !((n.params || {}).porcentaje > 0)) {
            errs.push(`cobro de anticipo sin porcentaje: nodo ${n.paso}`);
        }
    }

    // 2) nodo huérfano — inalcanzable por BFS desde el inicial (excepto el inicial) (§D.2 #1).
    //    Los nodos DELEGADOS se eximen: enrutan por el código del flow viejo (updateSession),
    //    no por aristas del grafo, así que su "alcanzabilidad" no es visible en la topología.
    if (grafo.inicial && pasos.has(grafo.inicial)) {
        const alcanzables = _bfs(grafo, grafo.inicial);
        for (const p of pasos) {
            if (alcanzables.has(p)) continue;
            if (grafo.nodos[p] && grafo.nodos[p].params && grafo.nodos[p].params.delegar) continue;
            errs.push(`nodo huérfano: ${p}`);
        }
    }

    // ponytail: faltan §D.2 #3 (ciclo sin salida vía Tarjan), #5 (nodo sistema
    // modificado vs flujo_nodo_sistema_ref) y #6 (toda rama de cobro → terminal).
    // Se agregan en Fase 5 cuando el editor puede PRODUCIR esas violaciones y la
    // tabla de referencia de nodos-sistema exista. Hoy no hay grafo que lintar.

    return { ok: errs.length === 0, errs };
}

function _bfs(grafo, inicial) {
    const visto = new Set([inicial]);
    const cola = [inicial];
    while (cola.length) {
        const p = cola.shift();
        for (const a of grafo.aristas[p] || []) {
            if (!visto.has(a.destino)) { visto.add(a.destino); cola.push(a.destino); }
        }
    }
    return visto;
}

module.exports = { validar };
