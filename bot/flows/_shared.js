// ═══════════════════════════════════════════════════════
//  _shared.js — punto de entrada delgado (re-export) del split en
//  bot/flows/_shared/*.js. Mismo API pública que antes del split (mismas
//  claves, mismos valores) — ningún call site (`require('./_shared')` /
//  `require('../flows/_shared')`) necesita cambiar. Ver PLAN_V3.md.
//
//  Dominios:
//    _base.js     — requires externos, S (enum de pasos), constantes de
//                    horario/flete, folio, cobertura, inventario.
//    busqueda.js  — searchProducts/wizardSearch (búsqueda de productos).
//    carrito.js   — matemática de carrito, cupones, partición pickup/envío.
//    clientes.js  — alta/actualización de cliente y dirección guardada.
//    pagos.js     — instrucciones y selección interactiva de método de pago.
//    pedidos.js   — grabado de pedido (las 4 rutas grabarPedido* + folio/link).
//    menu.js      — formato de resultados + menú principal adaptativo.
//    tagging.js   — auto-tagging de clientes.
//    escalada.js  — escalada a asesor (cola de atención).
//    handler.js   — logEvento + mostrarCarrito (usados por el router).
// ═══════════════════════════════════════════════════════
const base      = require('./_shared/_base');
const busqueda  = require('./_shared/busqueda');
const carrito   = require('./_shared/carrito');
const clientes  = require('./_shared/clientes');
const pagos     = require('./_shared/pagos');
const pedidos   = require('./_shared/pedidos');
const menu      = require('./_shared/menu');
const tagging   = require('./_shared/tagging');
const escalada  = require('./_shared/escalada');
const handler   = require('./_shared/handler');

module.exports = {
    enHorario: base.enHorario,
    msgHorarioAsesor: base.msgHorarioAsesor,
    calcularFlete: base.calcularFlete,
    generarFolio: base.generarFolio,
    boostStock: busqueda.boostStock,
    limpiarQuery: busqueda.limpiarQuery,
    searchProducts: busqueda.searchProducts,
    wizardSearch: busqueda.wizardSearch,
    buscarCobertura: base.buscarCobertura,
    stockEnSucursal: base.stockEnSucursal,
    stockGlobal: base.stockGlobal,
    agregarAlCarrito: carrito.agregarAlCarrito,
    totalCarrito: carrito.totalCarrito,
    aplicarCupon: carrito.aplicarCupon,
    validarStockMultiple: carrito.validarStockMultiple,
    partirCarrito: carrito.partirCarrito,
    formatParticion: carrito.formatParticion,
    resumenEscenariosMixtos: carrito.resumenEscenariosMixtos,
    formatCarrito: carrito.formatCarrito,
    upsertCliente: clientes.upsertCliente,
    insertarLinkPago: pedidos.insertarLinkPago,
    instruccionesPagoMulti: pagos.instruccionesPagoMulti,
    bloquePago: pagos.bloquePago,
    pagoMetodosActivos: pagos.pagoMetodosActivos,
    menuPago: pagos.menuPago,
    instruccionPago: pagos.instruccionPago,
    registrarMetodoPago: pagos.registrarMetodoPago,
    debePreguntarMetodoPago: pagos.debePreguntarMetodoPago,
    insertarPedidoConCarrito: pedidos.insertarPedidoConCarrito,
    grabarPedidoPickup: pedidos.grabarPedidoPickup,
    grabarPedidoEnvio: pedidos.grabarPedidoEnvio,
    grabarPedidoAnticipoCita: pedidos.grabarPedidoAnticipoCita,
    grabarPedidoSplit: pedidos.grabarPedidoSplit,
    grabarPedidoPickupUnificado: pedidos.grabarPedidoPickupUnificado,
    formatProducts: menu.formatProducts,
    menuPrincipal: menu.menuPrincipal,
    resolverOpcionMenu: menu.resolverOpcionMenu,
    menuEsAdaptativo: menu.menuEsAdaptativo,
    menuItemsActivos: menu.menuItemsActivos,
    tagCliente: tagging.tagCliente,
    quitarTag: tagging.quitarTag,
    registrarEscalada: escalada.registrarEscalada,
    puntosHandler: base.puntosHandler,
    log: base.log,
    sessionManager: base.sessionManager,
    estafeta: base.estafeta,
    emailSvc: base.emailSvc,
    db: base.db,
    stockService: base.stockService,
    S: base.S,
    HORARIO: base.HORARIO,
    HORARIO_ASESOR: base.HORARIO_ASESOR,
    _RE_DEVOLUCION: base._RE_DEVOLUCION,
    UMBRAL_ENVIO_GRA: base.UMBRAL_ENVIO_GRA,
    COSTO_ENVIO_STD: base.COSTO_ENVIO_STD,
    MAX_MISMO_PROD: base.MAX_MISMO_PROD,
    maxMismoProd: base.maxMismoProd,
    _STOPWORDS: busqueda._STOPWORDS,
    _MessageMedia: base._MessageMedia,
    t: base.t,
    moduloActivo: base.moduloActivo,
    getValor: base.getValor,
    vocab: base.vocab,
    mostrarCarrito: handler.mostrarCarrito,
    logEvento: handler.logEvento,
    buscarDireccionGuardada: clientes.buscarDireccionGuardada,
    iniciarCapturaDireccion: clientes.iniciarCapturaDireccion,
};
