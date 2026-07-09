// modulosDefaults.js — ÚNICA fuente de verdad de los módulos que arrancan
// APAGADOS por defecto (hasta activarse explícitamente desde el dashboard).
// ═══════════════════════════════════════════════════════════════
// Antes esta lista vivía duplicada en dos procesos distintos:
//   · bot/flows/_config.js        → moduloActivo() (lo que hace el bot)
//   · dashboard/routes/primeConfig.js → GET /api/modulo/:clave (lo que ve el panel)
// y se desincronizaron (el dashboard no incluía pago_real/estafeta_real/
// reconexion_auto/llm, así que reportaba "activo" módulos que el bot trataba
// como apagados). Centralizar aquí elimina ese drift: ambos la importan.
//
// Nota: los métodos de entrega pickup/paquetería arrancan ENCENDIDOS (no
// están aquí) para no cambiar instalaciones existentes; solo el repartidor
// arranca apagado. Un módulo NO listado aquí ⇒ default encendido.
'use strict';

const DEFAULT_OFF = [
    'puntos_activo',
    'pago_real_activo',
    'estafeta_real_activo',
    'reconexion_auto_activo',
    'pago_multimetodo_activo',
    'entrega_repartidor_activo',
    'pos_activo',
    'facturacion_activo',
    'citas_activo',
    'llm_activo',
    // Look minimalista: el panel arranca sin emojis (iconos de línea);
    // el toggle en Módulos permite reactivarlos por instancia.
    'emojis_dashboard_activo',
    // Asientos contables automáticos (ERP Fase 6) — se enciende cuando el
    // negocio quiere contabilidad; apagado no cambia nada del flujo.
    'contabilidad_activo',
    // RRHH/nómina — módulo opcional (una pyme sin RH opera igual sin él)
    'rrhh_activo',
];

module.exports = { DEFAULT_OFF };
