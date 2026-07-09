// giroFlows.js — HUECO para flujos específicos por giro.
// ═══════════════════════════════════════════════════════════════
// El array FLOWS de bot/actionHandler.js tiene los flujos UNIVERSALES (menú,
// carrito, pedido, dirección, asesor). Este registro permite que un giro
// agregue ESTADOS/FLUJOS propios sin tocar el router ni romper a los demás.
//
// Cómo enchufar un flujo nuevo (ejemplo: restaurante con estatus de cocina):
//   1. Crear bot/flows/restauranteFlow.js que exporte { STEPS, handle } igual
//      que los demás flujos (ver menuFlow.js como plantilla). Sus STEPS deben
//      ser estados nuevos del enum S de _shared.js (ej. S.ORDEN_PREPARANDO).
//   2. Registrarlo aquí:
//        module.exports = {
//          restaurante: [ require('./restauranteFlow') ],
//        };
//   actionHandler.js mezcla automáticamente los flujos del giro activo
//   (configuracion.giro) DESPUÉS de los universales. Vacío = sin cambios.
//
// Ejemplo del mensaje que pidió el operador ("ya tengo su orden, se comienza a
// preparar"): el restauranteFlow recibiría el pedido confirmado y respondería
// con el estado de cocina, o el dashboard marcaría "preparando"/"listo" y el
// bot avisaría por cola_notificaciones (mismo patrón que el repartidor).
'use strict';

// Mapa giro → [módulos de flujo]. Vacío por defecto: ningún giro agrega flujos
// todavía, así que el comportamiento es idéntico al actual. Es el punto de
// extensión documentado, no una feature a medias.
const _CITAS = [require('./citasFlow')];
const GIRO_FLOWS = {
    // restaurante: [ require('./restauranteFlow') ],
    servicios:     _CITAS,
    mantenimiento: _CITAS,
    barberia:      _CITAS,
    tatuajes:      _CITAS,
    estetica:      _CITAS,
    unas:          _CITAS,
};

// Devuelve los flujos extra del giro indicado (o []). Tolerante a errores de
// require para no tumbar el bot si un flujo de giro está mal.
function flowsDeGiro(giro) {
    try {
        const lista = GIRO_FLOWS[giro];
        return Array.isArray(lista) ? lista.filter(Boolean) : [];
    } catch (_) { return []; }
}

module.exports = { GIRO_FLOWS, flowsDeGiro };
