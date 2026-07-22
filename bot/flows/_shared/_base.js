// ═══════════════════════════════════════════════════════
//  _base.js — núcleo compartido del split de _shared.js
// ═══════════════════════════════════════════════════════
// Requires externos (servicios, db, config), el enum de estados S,
// constantes de horario/flete, folio, e inventario. Todo lo demás en
// bot/flows/_shared/*.js requiere este archivo en vez de re-requerir los
// módulos de bajo nivel directamente — así solo este archivo carga las
// rutas relativas "profundas" (../../..), y el resto usa './_base'.
// Extraído mecánicamente de bot/flows/_shared.js (mismo código, mismo
// orden de ejecución al cargar) — ver PLAN_V3.md ítem de split.

// ── Flows y logger ─────────────────────────────────────────────
let _MessageMedia = null;
try { _MessageMedia = require('whatsapp-web.js').MessageMedia; } catch(_) {}

const puntosHandler  = (() => { try { return require('../../handlers/puntosHandler'); } catch(_) { return null; } })();
const referidosService = (() => {
    try { return require('../../handlers/referidosService'); }
    catch(_) { return { calcularDescuentoReferido: () => ({ aplica: false, descuento: 0 }), marcarDescuentoReferidoUsado: () => {} }; }
})();
const mensajeService = (() => { try { return require('../../../services/mensajeService'); } catch(_) { return { marcarOutcome: () => {} }; } })();
const log            = (() => { try { return require('../../logger')('handler');    } catch(_) { return { info:console.log, warn:console.warn, error:console.error, debug:()=>{} }; } })();

const sessionManager  = require('../../sessionManager');
const estafeta        = require('../../../services/estafetaService');
const emailSvc        = require('../../../services/emailService');
const db              = require('../../db_connection');
const { registrarErrorDB } = require('../../dbErrorLog');
const stockService    = require('../../../services/stockService');
// Sistema de tonos (A/B/C/D) y módulos activables desde el dashboard
const { t, moduloActivo, getValor, vocab } = (() => {
    try { return require('../_config'); }
    catch(_) { return { t: () => '', moduloActivo: () => true, getValor: (_c, fb) => fb, vocab: () => ({ negocio: 'Julio Cepeda Jugueterías', negocio_corto: 'Julio Cepeda', item: 'juguete', items: 'juguetes', emoji: '🧸' }) }; }
})();
// Presets de giro (vocabulario + menú adaptativo). Tolerante: si falla el
// require, el menú adaptativo simplemente nunca se activa (menú completo).
const giros = (() => { try { return require('../_giros'); } catch(_) { return { menuDeGiro: () => null }; } })();

// ═══════════════════════════════════════════════════════
//  PASOS
// ═══════════════════════════════════════════════════════
const S = {
    MENU:           'MENU',
    SEARCHING:      'SEARCHING',
    VIEW_PRODUCT:   'VIEW_PRODUCT',
    SHOW_CART:      'SHOW_CART',
    WIZARD_Q1:      'WIZARD_Q1',
    WIZARD_Q2:      'WIZARD_Q2',
    WIZARD_Q3:      'WIZARD_Q3',
    ASK_CP:         'ASK_CP',
    SPLIT_DELIVERY: 'SPLIT_DELIVERY',     // ← carrito mixto: elegir cómo dividir
    DELIVERY:       'DELIVERY',
    PICKUP_CONFIRM: 'PICKUP_CONFIRM',
    SPLIT_CONFIRM:  'SPLIT_CONFIRM',      // ← confirmar los dos pedidos separados
    CONFIRM_DIR_GUARDADA: 'CONFIRM_DIR_GUARDADA', // ← ofrecer reusar última dirección guardada
    ASK_NOMBRE:     'ASK_NOMBRE',
    ASK_CALLE:      'ASK_CALLE',
    ASK_COLONIA:    'ASK_COLONIA',
    ASK_CIUDAD:     'ASK_CIUDAD',
    ASK_REF:        'ASK_REF',
    CONFIRM_ORDER:  'CONFIRM_ORDER',
    ADD_MORE:        'ADD_MORE',
    ASESOR:          'ASESOR',
    LISTA_ESPERA:    'LISTA_ESPERA',
    CSAT:            'CSAT',
    DEVOLUCION:      'DEVOLUCION',
    OFERTAS:         'OFERTAS',
    CUPON:           'CUPON',
    REFERIDOS:       'REFERIDOS',
    PAGO_METODO:     'PAGO_METODO',
    CITA_SERVICIO:   'CITA_SERVICIO',
    CITA_FECHA:      'CITA_FECHA',
    CITA_HORA:       'CITA_HORA',
    CITA_CONFIRMA:   'CITA_CONFIRMA',
    CITA_GESTION:    'CITA_GESTION',
    CITA_REAG_FECHA: 'CITA_REAG_FECHA',
    CITA_REAG_HORA:  'CITA_REAG_HORA',
    VARIANTE:        'VARIANTE',
    PAGO_COMPROBANTE: 'PAGO_COMPROBANTE',
    MESA_ABRIR:      'MESA_ABRIR',
    MESA_CONSUMO:    'MESA_CONSUMO',
};

// ═══════════════════════════════════════════════════════
//  CONSTANTES
// ═══════════════════════════════════════════════════════
// Horario de atención por instancia (configuracion horario_inicio/fin, en
// hora 0-23; defaults = los de siempre de Julio Cepeda)
function _horaCfg(clave, fb) {
    const v = parseInt(getValor(clave, fb), 10);
    return Number.isInteger(v) && v >= 0 && v <= 23 ? v : parseInt(fb, 10);
}
function _fmtHora(h) { return (h % 12 || 12) + ':00 ' + (h < 12 ? 'am' : 'pm'); }
const HORARIO          = _fmtHora(_horaCfg('horario_inicio', '11')) + ' – ' + _fmtHora(_horaCfg('horario_fin', '20'));
const HORARIO_ASESOR   = HORARIO + ', todos los días';

function enHorario() {
    const h = new Date().getHours();
    return h >= _horaCfg('horario_inicio', '11') && h < _horaCfg('horario_fin', '20');
}
function msgHorarioAsesor() {
    if (enHorario()) return 'Un asesor te contactará en cuanto esté disponible (normalmente en menos de 15 min en horario). ¡Gracias! ' + (vocab().emoji || '');
    return 'Estamos fuera de horario. 🌙\n⏰ Nuestro horario es *' + HORARIO_ASESOR + '*.\nHemos registrado tu solicitud y te contactaremos al inicio del siguiente horario.';
}
const _RE_DEVOLUCION = /devolver|devolv|devoluci[oó]n|devuelta|cambiar.*producto|cambio.*producto|quiero.*devolver|quiero.*cambiar|repetido|duplicado|ya.*tenía|me.*llegó.*mal|llegó.*incorrecto|no.*funciona|está.*roto|está.*dañado|garantia|garantía|me.*equivoqué|pedido.*mal|llegó.*dañado|producto.*dañado|dañado/i;
const UMBRAL_ENVIO_GRA = 699;
const COSTO_ENVIO_STD  = 99;
const MAX_MISMO_PROD   = 2;   // default; el tope REAL sale de config por giro (abarrotes/carnicería venden 6 refrescos, no 2)
// Tope de unidades del mismo producto sin escalar a asesor. Configurable
// (configuracion.max_unidades_producto) — juguetería mantiene 2, abarrotes/
// carnicería/ferretería suben a 20-99. Lee de la cache de config del bot.
function maxMismoProd() {
    return Math.max(1, parseInt(getValor('max_unidades_producto', String(MAX_MISMO_PROD)), 10) || MAX_MISMO_PROD);
}

function calcularFlete(precioTotal, costoEnvFijo = null) {
    if (costoEnvFijo !== null) return costoEnvFijo;
    return precioTotal >= UMBRAL_ENVIO_GRA ? 0 : COSTO_ENVIO_STD;
}

// ═══════════════════════════════════════════════════════
//  FOLIO
// ═══════════════════════════════════════════════════════
function generarFolio(tipo = 'pedido') {
    const row = db.prepare('SELECT prefijo, ultimo_folio, longitud FROM series_folios WHERE tipo = ?').get(tipo);
    if (!row) return `${tipo.toUpperCase()}-${Date.now()}`;
    const n = row.ultimo_folio + 1;
    db.prepare('UPDATE series_folios SET ultimo_folio = ? WHERE tipo = ?').run(n, tipo);
    return `${row.prefijo}${String(n).padStart(row.longitud, '0')}`;
}

// ═══════════════════════════════════════════════════════
//  COBERTURA
// ═══════════════════════════════════════════════════════
function buscarCobertura(cp) {
    const cpNum = cp.replace(/\D/g, '');
    if (cpNum.length < 2) return null;
    const pre2 = cpNum.substring(0, 2);
    const rows  = db.prepare('SELECT * FROM cobertura WHERE activa=1').all();
    for (const r of rows) {
        if (r.cp && r.cp.startsWith(pre2)) return r;
    }
    return null;
}

// ═══════════════════════════════════════════════════════
//  INVENTARIO
// ═══════════════════════════════════════════════════════
function stockEnSucursal(idProducto, estado) {
    const row = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(idProducto, estado);
    return row ? (row.stock || 0) : 0;
}
function stockGlobal(idProducto) {
    // Fuente de verdad: tabla inventarios (suma nacional por producto).
    // Las columnas productos.stock_* son un cache que puede estar desincronizado.
    const row = db.prepare('SELECT COALESCE(SUM(stock),0) AS total FROM inventarios WHERE id_producto=?').get(idProducto);
    return row ? (row.total || 0) : 0;
}

/**
 * Versión por lotes de stockEnSucursal+stockGlobal — una sola query de cada
 * tipo para N productos en vez de 2N. Retorna Map<idProducto, {local, total}>.
 */
function stockBatch(ids, estado) {
    const map = new Map(ids.map(id => [id, { local: 0, total: 0 }]));
    if (!ids.length) return map;
    const ph = ids.map(() => '?').join(',');
    const totales = db.prepare(
        `SELECT id_producto, COALESCE(SUM(stock),0) AS total FROM inventarios WHERE id_producto IN (${ph}) GROUP BY id_producto`
    ).all(...ids);
    for (const r of totales) map.get(r.id_producto).total = r.total;
    if (estado) {
        const locales = db.prepare(
            `SELECT id_producto, COALESCE(SUM(stock),0) AS local FROM inventarios WHERE id_producto IN (${ph}) AND sucursal=? GROUP BY id_producto`
        ).all(...ids, estado);
        for (const r of locales) map.get(r.id_producto).local = r.local;
    }
    return map;
}

module.exports = {
    _MessageMedia,
    puntosHandler,
    referidosService,
    mensajeService,
    log,
    sessionManager,
    estafeta,
    emailSvc,
    db,
    registrarErrorDB,
    stockService,
    t,
    moduloActivo,
    getValor,
    vocab,
    giros,
    S,
    HORARIO,
    HORARIO_ASESOR,
    enHorario,
    msgHorarioAsesor,
    _RE_DEVOLUCION,
    UMBRAL_ENVIO_GRA,
    COSTO_ENVIO_STD,
    MAX_MISMO_PROD,
    maxMismoProd,
    calcularFlete,
    generarFolio,
    buscarCobertura,
    stockEnSucursal,
    stockGlobal,
    stockBatch,
};
