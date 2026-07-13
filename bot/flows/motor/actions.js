'use strict';
// bot/flows/motor/actions.js — ÚNICO puente datos → código de negocio (Fase 1).
//
// Cada acción envuelve UNA función YA EXISTENTE de _shared.js. NADA de topología
// aquí: el intérprete (Fase 2) invoca por NOMBRE y solo conoce `resultado` (para
// ramificar aristas) y `data` (slots a fusionar en la sesión). Esa ignorancia
// deliberada es la frontera de seguridad — ver DISENO_MOTOR_FLUJO.md §A.2 / §D.
//
// Contrato: cada acción es (ctx, params) → { resultado, data }.
//   ctx  = el mismo objeto de actionHandler.js (`{ userId, tel, raw, data, ... }`).
//   data = slots a fusionar (se hace en el intérprete, aquí no se toca la sesión).
//
// INERTE en Fase 1: no hay intérprete que llame esto todavía. Es el registro que
// las Fases 2 (motor) y 3-4 (plantillas) consumen por nombre.

const shared = require('../_shared');

const ACTIONS = {
    // ── conversación (seguras de reordenar por config) ──────────────────────
    buscar_producto: (ctx) => {
        // searchProducts → { results, isFallback } (NO un array). _shared.js:163
        const r = shared.searchProducts(ctx.raw, 3, ctx.tel);
        return { resultado: r.results.length ? 'hay' : 'vacio', data: { resultados: r.results } };
    },

    agregar_carrito: (ctx) => {
        // agregarAlCarrito → { ok, escalar, carrito, ... }; PUEDE rechazar (maxMismoProd).
        // El producto en curso lo pone menuFlow en data.viewing al ver el detalle.
        const r = shared.agregarAlCarrito(ctx.data.carrito || [], ctx.data.viewing);
        if (!r.ok) return { resultado: r.escalar ? 'escalar' : 'no', data: { carrito: ctx.data.carrito || [] } };
        return { resultado: 'ok', data: { carrito: r.carrito } };
    },

    aplicar_cupon: (ctx) => {
        const r = shared.aplicarCupon(ctx.raw, ctx.data.carrito || [], ctx.data.viewing?.id);
        return { resultado: r.ok ? 'ok' : 'no', data: r.ok ? { cupon: r } : {} };
    },

    cargar_dias_cita: () => {
        const dias = require('../citasFlow').diasDisponibles();
        return { resultado: dias.length ? 'hay' : 'vacio', data: { cita_dias: dias } };
    },

    // ── SELLADAS (dinero/inventario) — params configurables, lógica intocable (§D) ──
    // El intérprete elige CUÁNDO llamarlas; el CÓMO (grabar pedido, escalar) es
    // el mismo código de producción, nunca editable por grafo.
    grabar_pedido_pickup: (ctx) => {
        const r = shared.grabarPedidoPickup(ctx.data, ctx.tel);
        return { resultado: 'ok', data: { pedido: r } };
    },
    grabar_pedido_envio: (ctx) => {
        const r = shared.grabarPedidoEnvio(ctx.data, ctx.tel);
        return { resultado: 'ok', data: { pedido: r } };
    },
    grabar_pedido_split: (ctx) => {
        const r = shared.grabarPedidoSplit(ctx.data, ctx.tel);
        return { resultado: 'ok', data: { pedido: r } };
    },
    escalar: (ctx, params = {}) => {
        // Handoff SELLADO: registra en cola_atencion + deja la sesión lista para ASESOR.
        // El SET a S.ASESOR lo hace el intérprete; aquí solo el registro (mismo código de hoy).
        shared.registrarEscalada(ctx.userId, null, params.motivo || 'motor', ctx.tel, params.tipo || 'ASESOR');
        return { resultado: 'escalado', data: {} };
    },

    // ── PENDIENTE Fase 4 ────────────────────────────────────────────────────
    // ponytail: crear_cita / cobrar_anticipo se agregan en la Fase 4 (deltas de
    // giro) con sus helpers sellados reales (registrarCita / crearAnticipoDeCita),
    // NO aquí: sin intérprete (Fase 2) no hay quién las llame y su lógica de dinero
    // aún no existe. Las columnas citas.anticipo/saldo_pendiente (migración 0065)
    // ya dejan lista la BD para cuando lleguen.
};

module.exports = { ACTIONS };
