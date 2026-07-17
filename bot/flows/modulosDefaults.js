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
    'pago_link_activo',
    'recompra_activo',
    'recordatorio_pago_activo',
    'mesas_activo',
    'citas_activo',
    'llm_activo',
    // Look minimalista: el panel arranca sin emojis (iconos de línea);
    // el toggle en Módulos permite reactivarlos por instancia.
    'emojis_dashboard_activo',
    // NOTA: contabilidad_activo antes arrancaba APAGADA y era la causa de que el
    // tablero mostrara $0 sobre un negocio con ventas reales (los asientos
    // no-opean si el módulo está off, sin backfill). Ahora arranca ENCENDIDA:
    // un ERP con ventas debe llevar sus libros. Se puede apagar en Módulos
    // (solo Prime) para negocios que no quieran contabilidad.
    // RRHH/nómina — módulo opcional (una pyme sin RH opera igual sin él)
    'rrhh_activo',
    'nomina_fiscal_activo',
    // Ventas a crédito (fiado): capa de devengado/CxC sobre el motor de flujo
    // de efectivo. Off = todos venden de contado (comportamiento actual).
    'ventas_credito_activo',
    // Recordatorio de cobranza de fiado vencido (por WhatsApp, una vez).
    'recordatorio_fiado_activo',
    // Propina: en México NO entra al costo/ingreso gravado — es solo un mensaje
    // sugerido en el ticket. Off por defecto: hay lugares donde no se da propina.
    'propina_activo',
    // Reparto de propinas/comisiones entre el personal (pestaña opt-in en POS,
    // para restaurantes y tiendas de materiales que lo pidan).
    'reparto_activo',
    // F5.1: suscripción mensual (servicios) — cobro recurrente + proyección MRR.
    'suscripcion_activo',
    // F5.2: documentos (cotizaciones/pagarés/contratos con plantillas).
    'documentos_activo',
    // F5.4: baúl de contabilidad (archivero local de CFDIs + export por lote).
    'baul_contable_activo',
    // Motor de flujo configurable por grafo (Fase 2). OFF = FLOWS de código intacto,
    // Julio Cepeda byte-idéntico. Incluso ON sin grafo activo el motor no-opea.
    'motor_flujo_activo',
    // Apoyo del bot en el lienzo: cotizar el carrito y decir el tiempo de entrega
    // (solo lectura, informativos, no cobran). Se usan como acciones del motor de
    // flujo; su diálogo vive en FRASES (cotizacion_resumen/eta_envio, 4 tonos,
    // editables). Default OFF: solo aplican si el autor los pone en su grafo.
    'cotizacion_activo',
    'tiempo_entrega_activo',
];

// Dependencias entre módulos (idea Odoo): activar la llave exige que sus
// dependencias estén activas; apagar una dependencia con dependientes
// activos se bloquea. Lo valida el toggle del dashboard.
const DEPENDE_DE = {
    facturacion_activo: ['contabilidad_activo'],
    // el picker de método de pago en el bot presupone métodos configurados,
    // pero eso ya lo resuelve el catálogo metodos_pago — sin dependencia dura
};

// Módulos que cada GIRO enciende al terminar el onboarding (una sola vez, solo
// instancias nuevas — Julio Cepeda nunca pasa por aquí). Sin esto, una barbería
// quedaba sin Citas y un restaurante sin Mesas/POS hasta descubrir Módulos.
// El dueño puede apagarlos después; esto solo es el punto de partida correcto.
// Ajustes por auditoría de ramos (2026-07-12): abarrotes/ferretería suelen
// fiar → ventas_credito; restaurante casi siempre da domicilio → repartidor;
// tatuajes cobra en mostrador → pos.
const MODULOS_POR_GIRO = {
    jugueteria:    ['pos_activo'],
    retail:        ['pos_activo'],
    abarrotes:     ['pos_activo', 'ventas_credito_activo'],
    carniceria:    ['pos_activo', 'ventas_credito_activo'],
    ferreteria:    ['pos_activo', 'ventas_credito_activo', 'documentos_activo'],  // cotiza (auditoría de giros r2)
    restaurante:   ['pos_activo', 'mesas_activo', 'entrega_repartidor_activo', 'propina_activo', 'reparto_activo'],
    servicios:     ['citas_activo', 'documentos_activo'],       // contratos/cotizaciones (r2)
    freelancer:    ['citas_activo', 'documentos_activo', 'suscripcion_activo'],  // retainer mensual + contratos (r2)
    mantenimiento: ['citas_activo'],
    barberia:      ['citas_activo', 'pos_activo'],
    tatuajes:      ['citas_activo', 'pos_activo'],
    estetica:      ['citas_activo', 'pos_activo'],
    unas:          ['citas_activo', 'pos_activo'],
    custom:        [],
};

module.exports = { DEFAULT_OFF, DEPENDE_DE, MODULOS_POR_GIRO };
