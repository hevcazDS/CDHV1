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

    // ── RENDER (Fase 3): envuelven el código de render existente para reproducir
    //    prompts DINÁMICOS byte-idénticos. Devuelven string. El intérprete las
    //    llama vía nodo.render. NO deciden topología ni tocan dinero. ──────────
    render_menu: (ctx) => shared.menuPrincipal(ctx.tel),

    // ── CRM (Fase 3 del CRM): la conversación alimenta el pipeline SIN código.
    //    Un flujo del lienzo puede mover etapa / crear tarea / dejar nota. Son
    //    acciones de DATOS del cliente — jamás envían mensajes masivos (esa
    //    frontera vive en /api/masivo y campañas, con gate humano). ──────────
    crm_cambiar_etapa: (ctx, params = {}) => {
        const ETAPAS = ['lead', 'contactado', 'cotizado', 'ganado', 'perdido'];
        if (!ETAPAS.includes(params.etapa)) return { resultado: 'no', data: {} };
        const cli = shared.db.prepare('SELECT id, etapa FROM clientes WHERE telefono=?').get(ctx.tel);
        if (!cli) return { resultado: 'no', data: {} };
        shared.db.prepare('UPDATE clientes SET etapa=? WHERE id=?').run(params.etapa, cli.id);
        try { shared.db.prepare('INSERT INTO crm_etapas (id_cliente, de, a, creado_por) VALUES (?,?,?,?)').run(cli.id, cli.etapa || null, params.etapa, 'bot'); } catch (_) {}
        return { resultado: 'ok', data: {} };
    },
    crm_crear_tarea: (ctx, params = {}) => {
        const cli = shared.db.prepare('SELECT id FROM clientes WHERE telefono=?').get(ctx.tel);
        if (!cli || !params.titulo) return { resultado: 'no', data: {} };
        const vence = Number(params.dias_vence) > 0
            ? new Date(Date.now() + Number(params.dias_vence) * 86400000).toISOString().slice(0, 10) : null;
        shared.db.prepare('INSERT INTO crm_tareas (id_cliente, titulo, tipo, vence_en, creado_por) VALUES (?,?,?,?,?)')
            .run(cli.id, String(params.titulo).slice(0, 300), 'seguimiento', vence, 'bot');
        return { resultado: 'ok', data: {} };
    },
    crm_agregar_nota: (ctx, params = {}) => {
        const cli = shared.db.prepare('SELECT id FROM clientes WHERE telefono=?').get(ctx.tel);
        if (!cli) return { resultado: 'no', data: {} };
        const texto = String(params.texto || ctx.raw || '').trim().slice(0, 2000);
        if (!texto) return { resultado: 'no', data: {} };
        shared.db.prepare('INSERT INTO crm_notas (id_cliente, contenido, creado_por) VALUES (?,?,?)').run(cli.id, texto, 'bot');
        return { resultado: 'ok', data: {} };
    },

    // ── COTIZACIÓN + TIEMPO DE ENTREGA — APOYO al bot, NO selladas ──────────────
    // Contestan "¿cuánto me sale?" y "¿cuándo llega?" SIN escalar. Solo LECTURA:
    // nunca graban pedido ni cobran (el dinero sigue por la ruta sellada
    // marcar-pagado). Gated por su módulo (default OFF): apagado → 'inactivo', para
    // que el autor enrute a un fallback (ej. pasar con asesor). El TEXTO que ve el
    // cliente NO vive aquí: lo pone la frase de la pieza (t(), 4 tonos, editable)
    // interpolando los slots que estas acciones devuelven. Regla de negocio: solo
    // el flete puede decirse "gratis", jamás el precio del producto.
    cotizar: (ctx) => {
        if (!require('../_config').moduloActivo('cotizacion_activo')) return { resultado: 'inactivo', data: {} };
        const carrito = ctx.data.carrito || [];
        if (!carrito.length) return { resultado: 'vacio', data: {} };
        const subtotal = shared.totalCarrito(carrito);
        const envio    = shared.calcularFlete(subtotal);
        const total    = subtotal + envio;
        const n = carrito.reduce((s, i) => s + (i.cantidad || 1), 0);
        return { resultado: 'ok', data: {
            cotizacion_n: n,
            cotizacion_subtotal: subtotal.toFixed(2),
            cotizacion_envio: envio === 0 ? 'gratis' : ('$' + envio.toFixed(2)),   // "gratis" solo aquí (flete)
            cotizacion_total: total.toFixed(2),
        } };
    },
    tiempo_entrega: (ctx) => {
        if (!require('../_config').moduloActivo('tiempo_entrega_activo')) return { resultado: 'inactivo', data: {} };
        try {
            const r = shared.estafeta.calcularFechaEntrega();   // respeta config estafeta_dias_entrega, no domingos
            return { resultado: 'ok', data: {
                eta_fecha: shared.estafeta._formatDateHuman(r.fechaEntregaObj),   // "miércoles 19 de julio"
                eta_fecha_iso: r.fechaEntrega,
            } };
        } catch (_) { return { resultado: 'no', data: {} }; }
    },

    // ── CITA + ANTICIPO (Fase 4) — SELLADAS. El anticipo es un pedido normal por
    //    la misma ruta de dinero (§E.1); el porcentaje viene del grafo (params),
    //    el CÓMO se cobra es intocable. barbería-sin-anticipo cae en 'sin_cobro'. ──
    crear_cita: (ctx) => {
        const id = require('../citasFlow').registrarCita(ctx.data, ctx.tel);
        return { resultado: id ? 'ok' : 'no', data: { cita_id: id } };
    },
    cobrar_anticipo: (ctx, params = {}) => {
        const precio     = ctx.data.cita_servicio_precio || 0;
        const porcentaje = params.porcentaje;
        // Defensa en profundidad (el linter ya exige porcentaje>0): sin monto/porcentaje
        // no se cobra — la barbería sin anticipo pasa por aquí sin cobrar.
        if (!(porcentaje > 0) || !(precio > 0)) return { resultado: 'sin_cobro', data: {} };
        const anticipo = +(precio * porcentaje / 100).toFixed(2);
        const saldo    = +(precio - anticipo).toFixed(2);
        const carrito  = [{ id: ctx.data.cita_servicio_id, name: ctx.data.cita_servicio, price: anticipo, cantidad: 1 }];
        const r = shared.grabarPedidoAnticipoCita({ ...ctx.data, carrito, total: anticipo }, ctx.tel);
        // Liga el anticipo en columnas NUEVAS (0065), sin pisar citas.id_pedido (cobro de mostrador).
        if (ctx.data.cita_id) shared.db.prepare('UPDATE citas SET anticipo=?, saldo_pendiente=? WHERE id=?').run(anticipo, saldo, ctx.data.cita_id);
        return { resultado: 'cobrar', data: { anticipo, saldo, link: r.linkUrl, folio: r.folio } };
    },
};

// ── M2: catálogo con metadata HUMANA (lo que el lienzo muestra en la paleta).
// Una entrada por acción del registro. `sellada` = dinero/inventario/relevo:
// invocable desde el grafo, lógica intocable; sus params se limitan a la
// whitelist (§D). `salidas` = los `resultado` posibles (para cables resultado:x).
const CATALOGO = {
    buscar_producto:  { nombre: 'Buscar producto',        desc: 'Busca en el catálogo lo que el cliente escribió', salidas: ['hay', 'vacio'], sellada: false },
    agregar_carrito:  { nombre: 'Agregar al carrito',     desc: 'Mete al carrito el producto que el cliente está viendo', salidas: ['ok', 'no', 'escalar'], sellada: false },
    aplicar_cupon:    { nombre: 'Aplicar cupón',          desc: 'Valida el código de cupón que escribió el cliente', salidas: ['ok', 'no'], sellada: false },
    cargar_dias_cita: { nombre: 'Cargar días de cita',    desc: 'Consulta qué días hay agenda disponible', salidas: ['hay', 'vacio'], sellada: false },
    render_menu:      { nombre: 'Mostrar el menú',        desc: 'Muestra el menú principal del negocio (texto dinámico)', salidas: [], sellada: false, esRender: true },
    crm_cambiar_etapa:{ nombre: 'CRM: mover etapa',       desc: 'Mueve al cliente de etapa en el pipeline (ej. a "cotizado")', salidas: ['ok', 'no'], sellada: false, params: ['etapa'] },
    crm_crear_tarea:  { nombre: 'CRM: crear tarea',       desc: 'Deja una tarea de seguimiento para el equipo', salidas: ['ok', 'no'], sellada: false, params: ['titulo', 'dias_vence'] },
    crm_agregar_nota: { nombre: 'CRM: guardar nota',      desc: 'Guarda lo que escribió el cliente como nota en su ficha', salidas: ['ok', 'no'], sellada: false, params: ['texto'] },
    cotizar:          { nombre: 'Cotizar el carrito',     desc: 'Calcula subtotal + envío + total del carrito para que el bot lo diga (informativo, no cobra). Rellena {cotizacion_total}, {cotizacion_subtotal}, {cotizacion_envio}, {cotizacion_n}', salidas: ['ok', 'vacio', 'inactivo'], sellada: false },
    tiempo_entrega:   { nombre: 'Tiempo de entrega',      desc: 'Calcula para cuándo llegaría el envío. Rellena {eta_fecha} (ej. "miércoles 19 de julio")', salidas: ['ok', 'no', 'inactivo'], sellada: false },
    grabar_pedido_pickup: { nombre: 'Cobrar pedido (pickup) 🔒', desc: 'Graba el pedido para recoger en tienda — misma ruta de dinero de siempre', salidas: ['ok'], sellada: true },
    grabar_pedido_envio:  { nombre: 'Cobrar pedido (envío) 🔒',  desc: 'Graba el pedido con envío a domicilio — misma ruta de dinero de siempre', salidas: ['ok'], sellada: true },
    grabar_pedido_split:  { nombre: 'Cobrar pedido (mixto) 🔒',  desc: 'Graba el pedido parte pickup / parte envío', salidas: ['ok'], sellada: true },
    escalar:          { nombre: 'Pasar con un asesor 🔒',  desc: 'Registra al cliente en la cola de atención humana', salidas: ['escalado'], sellada: true, params: ['motivo'] },
    crear_cita:       { nombre: 'Agendar la cita 🔒',      desc: 'Registra la cita con los datos ya recolectados', salidas: ['ok', 'no'], sellada: true },
    cobrar_anticipo:  { nombre: 'Cobrar anticipo 🔒',      desc: 'Cobra un % del servicio como anticipo (requiere porcentaje)', salidas: ['cobrar', 'sin_cobro'], sellada: true, params: ['porcentaje'] },
};

// run(nombre, ctx, params) — dispatcher que usa el intérprete. Lanza si la acción
// no existe → el catch del intérprete cae fail-closed al router viejo (§D.3).
async function run(nombre, ctx, params = {}) {
    const fn = ACTIONS[nombre];
    if (typeof fn !== 'function') throw new Error('acción de motor desconocida: ' + nombre);
    return await fn(ctx, params);
}

module.exports = { ACTIONS, run, CATALOGO };
