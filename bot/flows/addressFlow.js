// flows/addressFlow.js — Estados: ASK_NOMBRE, ASK_CALLE, ASK_COLONIA, ASK_CIUDAD, ASK_REF
// Cada flow es independiente: un error aquí se captura en el router
// y NO tumba el resto del bot. Frases con sistema de tonos via t().
'use strict';
const shared = require('./_shared');
const {
    enHorario,
    msgHorarioAsesor,
    calcularFlete,
    generarFolio,
    boostStock,
    limpiarQuery,
    searchProducts,
    wizardSearch,
    buscarCobertura,
    stockEnSucursal,
    stockGlobal,
    agregarAlCarrito,
    totalCarrito,
    aplicarCupon,
    validarStockMultiple,
    partirCarrito,
    formatParticion,
    resumenEscenariosMixtos,
    formatCarrito,
    upsertCliente,
    insertarLinkPago,
    insertarPedidoConCarrito,
    grabarPedidoPickup,
    grabarPedidoEnvio,
    grabarPedidoSplit,
    grabarPedidoPickupUnificado,
    formatProducts,
    menuPrincipal,
    tagCliente,
    quitarTag,
    registrarEscalada,
    puntosHandler,
    log,
    sessionManager,
    estafeta,
    emailSvc,
    db,
    stockService,
    S,
    HORARIO,
    HORARIO_ASESOR,
    _RE_DEVOLUCION,
    UMBRAL_ENVIO_GRA,
    COSTO_ENVIO_STD,
    MAX_MISMO_PROD,
    _STOPWORDS,
    _MessageMedia,
    t,
    moduloActivo,
    mostrarCarrito,
} = shared;

const STEPS = [S.CONFIRM_DIR_GUARDADA, S.ASK_NOMBRE, S.ASK_CALLE, S.ASK_COLONIA, S.ASK_CIUDAD, S.ASK_REF];

// Construye el resumen final (split o envío normal) y avanza la sesión.
// Compartido entre S.ASK_REF (captura desde cero) y S.CONFIRM_DIR_GUARDADA
// (reuso de dirección guardada) para no duplicar esta lógica dos veces.
function construirResumenDireccion(userId, newData) {
    const ref = newData.referencia || '';

    // ── Modo split: pickup + envío por separado ───────────────────────────
    if (newData.metodo === 'split') {
        const carritoPickup = newData.carritoPickup || [];
        const carritoEnvio  = newData.carritoEnvio  || [];
        const subtotalPickup = totalCarrito(carritoPickup);
        const subtotalEnvio  = totalCarrito(carritoEnvio);
        const fleteEnvio     = calcularFlete(subtotalEnvio, newData.costoEnvFijo || null);
        sessionManager.updateSession(userId, S.SPLIT_CONFIRM, newData);
        return (
            `📋 *Resumen de tus dos pedidos:*\n\n` +
            `🏪 *Pickup — ${newData.ciudad_cob}*\n` +
            `${formatParticion(carritoPickup,'pickup')}\n` +
            `💰 Total pickup: *$${subtotalPickup.toFixed(2)} MXN*\n\n` +
            `🚚 *Envío a domicilio*\n` +
            `${formatParticion(carritoEnvio,'envio')}\n` +
            `📍 ${newData.nombre} · ${newData.calle}, ${newData.colonia}, ${newData.ciudad}\n` +
            (ref ? `Ref: ${ref}\n` : '') +
            `📦 Flete: ${fleteEnvio===0?'*¡GRATIS!*':`*$${fleteEnvio} MXN*`}\n` +
            `💰 Total envío: *$${(subtotalEnvio+fleteEnvio).toFixed(2)} MXN*\n\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `💵 *Gran total: $${(subtotalPickup+subtotalEnvio+fleteEnvio).toFixed(2)} MXN*\n\n` +
            `1️⃣  ✅ Confirmar ambos pedidos\n` +
            `2️⃣  🔙 Ver otras opciones`
        );
    }

    // ── Modo envío normal ─────────────────────────────────────────────────
    const carrito  = newData.carrito || (newData.selectedProduct ? [{ ...newData.selectedProduct, cantidad:1 }] : []);
    const subtotal = totalCarrito(carrito);
    const costoEn  = calcularFlete(subtotal, newData.costoEnvFijo || null);
    try { shared.logEvento('direccion_capturada', (newData.ciudad || '') + ' ' + (newData.cp || ''), tel); } catch (_) {} // embudo (CRO)
    sessionManager.updateSession(userId, S.CONFIRM_ORDER, { ...newData, carrito });
    return (
        `📋 *Resumen de tu pedido:*\n\n` +
        `${formatCarrito(carrito, costoEn)}\n\n` +
        `📍 *Dirección de entrega:*\n` +
        `${newData.nombre}\n` +
        `${newData.calle}, ${newData.colonia}\n` +
        `${newData.ciudad}, ${newData.estado_cob || ''} CP ${newData.cp}\n` +
        (ref ? `Ref: ${ref}\n` : '') +
        `\n1️⃣  ✅ Confirmar y pagar\n2️⃣  ✏️ Corregir dirección\n3️⃣  🏷️ Tengo un cupón\n4️⃣  ❌ Cancelar`
    );
}

async function handle(ctx) {
    const { userId, session, message, client, raw, action, step, data, tel } = ctx;

    if (step === S.CONFIRM_DIR_GUARDADA) {
        const guardada = data.direccionGuardada || {};
        if (action === '1' || ['si','sí','usar','confirmar'].includes(action) || action.includes('usar esta')) {
            const { direccionGuardada, ...resto } = data;
            const newData = {
                ...resto,
                nombre: guardada.nombre || data.nombre,
                calle: guardada.calle,
                colonia: guardada.colonia,
                ciudad: guardada.ciudad,
                estado_cob: guardada.estado || data.estado_cob,
                cp: guardada.cp || data.cp,
                referencia: guardada.referencia || '',
            };
            return construirResumenDireccion(userId, newData);
        }
        if (action === '2' || action.includes('otra')) {
            const { direccionGuardada, ...resto } = data;
            sessionManager.updateSession(userId, S.ASK_NOMBRE, resto);
            return `¿Cuál es tu *nombre completo*?`;
        }
        return `Responde con 1 _(usar esta dirección)_ o 2 _(usar otra dirección)_.`;
    }

    if (step === S.ASK_NOMBRE) {
        if (raw.length < 3) return `Por favor escribe tu nombre completo.`;
        upsertCliente(tel, raw);
        sessionManager.updateSession(userId, S.ASK_CALLE, { ...data, nombre:raw });
        return `📍 ¿Cuál es tu *calle y número*?\n_Ej: Av. Venustiano Carranza 1023_`;
    }
    if (step === S.ASK_CALLE) {
        if (raw.length < 3) return `Por favor escribe tu calle y número.`;
        sessionManager.updateSession(userId, S.ASK_COLONIA, { ...data, calle:raw });
        return `🏘️ ¿Cuál es tu *colonia*?`;
    }
    if (step === S.ASK_COLONIA) {
        if (raw.length < 2) return `Por favor escribe tu colonia.`;
        sessionManager.updateSession(userId, S.ASK_CIUDAD, { ...data, colonia:raw });
        return `🏙️ ¿Cuál es tu *ciudad*?`;
    }
    if (step === S.ASK_CIUDAD) {
        if (raw.length < 2) return `Por favor escribe tu ciudad.`;
        sessionManager.updateSession(userId, S.ASK_REF, { ...data, ciudad:raw });
        return `📌 ¿Alguna *referencia* para el domicilio?\n_(Entre calles, color de fachada, etc. — o escribe *ninguna*)_`;
    }
    if (step === S.ASK_REF) {
        const ref = (['ninguna','no','n/a'].includes(action)) ? '' : raw;
        return construirResumenDireccion(userId, { ...data, referencia: ref });
    }

    // ── CONFIRM_ORDER ─────────────────────────────────────
    return undefined; // estado no manejado por este flow
}

module.exports = { handle, STEPS };
