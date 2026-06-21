// estafetaService.js
// Servicio de guías Estafeta.
// Fase 1 (actual): simula número de guía y calcula fechas reales (sin domingos).
// Fase 2 (futura): descomentar _callEstafetaAPI() para conectar con API real.
//
// Regla de entrega: 2 días hábiles. Estafeta NO trabaja domingos.
// Si la fecha de entrega cae domingo → se mueve al lunes siguiente.

'use strict';

const db   = require('../bot/db_connection');
const path = require('path');
const log  = require('../bot/logger')('estafetaService');
const { moduloActivo } = (() => {
    try { return require('../bot/flows/_config'); }
    catch(_) { return { moduloActivo: () => false }; }
})();

// ── Constantes ────────────────────────────────────────────────────────────
const DIAS_ENTREGA   = 2;          // fallback si configuracion.estafeta_dias_entrega no existe
const HORA_CORTE     = 14;         // si el pedido entra después de las 2pm, sale al día siguiente

// Días hábiles configurables desde Prime (dashboard/server.js
// /api/prime/estafeta-dias-entrega) — Estafeta no confirma sábados de forma
// fiable y en fechas como navidad los pedidos se retrasan días extra.
function _diasEntregaConfigurados() {
    try {
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='estafeta_dias_entrega' LIMIT 1").get();
        const n = r ? Number(r.valor) : DIAS_ENTREGA;
        return Number.isInteger(n) && n >= 1 ? n : DIAS_ENTREGA;
    } catch (_) {
        return DIAS_ENTREGA;
    }
}
const REMITENTE = {
    nombre:   'Julio Cepeda Jugueterías',
    cp:       '78000',
    ciudad:   'San Luis Potosí',
    estado:   'SLP',
    telefono: '4441234567',
};

// ── Cálculo de fechas hábiles ──────────────────────────────────────────────
/**
 * Devuelve fecha de entrega estimada sumando días hábiles.
 * Estafeta: no trabaja domingos (día 0).
 * No consideramos festivos por ahora — se puede agregar más adelante.
 */
function calcularFechaEntrega(diasHabiles = _diasEntregaConfigurados(), fechaBase = new Date()) {
    const ahora    = fechaBase;
    const esTarde  = ahora.getHours() >= HORA_CORTE;

    // Si es tarde o domingo, el paquete sale el siguiente día hábil
    let fechaEnvio = new Date(ahora);
    fechaEnvio.setHours(0, 0, 0, 0);

    if (esTarde || fechaEnvio.getDay() === 0) {
        fechaEnvio.setDate(fechaEnvio.getDate() + 1);
    }
    // Si la fecha de envío cae domingo, mover al lunes
    if (fechaEnvio.getDay() === 0) fechaEnvio.setDate(fechaEnvio.getDate() + 1);

    // Sumar días hábiles (saltando domingos)
    let diasSumados = 0;
    let fechaEntrega = new Date(fechaEnvio);
    while (diasSumados < diasHabiles) {
        fechaEntrega.setDate(fechaEntrega.getDate() + 1);
        if (fechaEntrega.getDay() !== 0) diasSumados++;  // 0 = domingo
    }

    return {
        fechaEnvio:    _formatDate(fechaEnvio),
        fechaEntrega:  _formatDate(fechaEntrega),
        fechaEnvioObj: fechaEnvio,
        fechaEntregaObj: fechaEntrega,
    };
}

function _formatDate(d) {
    return d.toISOString().slice(0, 10);
}

function _formatDateHuman(d) {
    const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    const meses = ['enero','febrero','marzo','abril','mayo','junio',
                   'julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const fecha = typeof d === 'string' ? new Date(d + 'T12:00:00') : d;
    return `${dias[fecha.getDay()]} ${fecha.getDate()} de ${meses[fecha.getMonth()]}`;
}

// ── Generación de número de guía simulado ──────────────────────────────────
function _generarNumeroGuia() {
    // Formato Estafeta real: 22 dígitos. Simulado: EST-SIM-XXXXXXXX
    const row = db.prepare("SELECT prefijo, ultimo_folio, longitud FROM series_folios WHERE tipo='guia_estafeta'").get();
    if (!row) return `EST-SIM-${Date.now()}`;
    const n = row.ultimo_folio + 1;
    db.prepare("UPDATE series_folios SET ultimo_folio=? WHERE tipo='guia_estafeta'").run(n);
    const num = String(n).padStart(row.longitud, '0');
    return `${row.prefijo}${num}`;
}

function _generarFolioInterno(idPedido) {
    const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `GE-${hoy}-${String(idPedido).padStart(6, '0')}`;
}

// ── URL de rastreo ─────────────────────────────────────────────────────────
function urlRastreoSimulado(numeroGuia) {
    // Cuando sea real: https://www.estafeta.com/herramientas/rastreo?guia=XXXXX
    return `https://rastreo.julio-cepeda-bot.local/guia/${numeroGuia}`;
}

// ── Crear guía ─────────────────────────────────────────────────────────────
/**
 * Genera y registra una guía de envío para un pedido.
 *
 * @param {object} params
 *   idPedido, idEnvio (de tabla envios),
 *   destNombre, destCalle, destColonia, destCiudad, destEstado, destCp, destTelefono,
 *   contenido, pesoKg, altoCm, anchoCm, largoCm, valorDeclarado
 *
 * @returns {object} { numeroGuia, folioInterno, fechaEnvio, fechaEntrega,
 *                     fechaEnvioHuman, fechaEntregaHuman, urlRastreo, esSimulada }
 */
function crearGuia(params) {
    if (moduloActivo('estafeta_real_activo')) return _crearGuiaReal(params);

    const {
        idPedido, idEnvio = null,
        destNombre, destCalle = '', destColonia = '',
        destCiudad = '', destEstado = '', destCp = '', destTelefono = '',
        contenido = 'Juguete', pesoKg = 1.0,
        altoCm = 20, anchoCm = 20, largoCm = 30,
        valorDeclarado = 0,
    } = params;

    // Calcular fechas
    const { fechaEnvio, fechaEntrega, fechaEnvioObj, fechaEntregaObj } = calcularFechaEntrega();

    const numeroGuia   = _generarNumeroGuia();
    const folioInterno = _generarFolioInterno(idPedido);
    const urlRastreo   = urlRastreoSimulado(numeroGuia);

    // Guardar en DB
    const info = db.prepare(`
        INSERT INTO guias_estafeta (
            id_envio, id_pedido, numero_guia, folio_interno,
            dest_nombre, dest_calle, dest_colonia, dest_ciudad, dest_estado, dest_cp, dest_telefono,
            peso_kg, alto_cm, ancho_cm, largo_cm, contenido, valor_declarado,
            fecha_envio_est, fecha_entrega_est, estatus, es_simulada
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'generada',1)
    `).run(
        idEnvio || 0, idPedido, numeroGuia, folioInterno,
        destNombre, destCalle, destColonia, destCiudad, destEstado, destCp, destTelefono,
        pesoKg, altoCm, anchoCm, largoCm, contenido, valorDeclarado,
        fechaEnvio, fechaEntrega
    );

    // Registrar log de estatus inicial
    if (idEnvio) {
        try {
            db.prepare(`
                INSERT INTO estatus_envio_log (id_envio, estatus, descripcion, ubicacion)
                VALUES (?, 'generada', 'Guía generada — en espera de recolección', ?)
            `).run(idEnvio, `${REMITENTE.ciudad}, ${REMITENTE.estado}`);
        } catch(e) { log.debug('No se pudo registrar log de estatus de envío: ' + e.message); }
    }

    // Actualizar tabla envios si tenemos idEnvio
    if (idEnvio) {
        db.prepare(`
            UPDATE envios SET
                numero_guia            = ?,
                url_rastreo            = ?,
                fecha_envio            = ?,
                fecha_entrega_estimada = ?,
                estatus                = 'guia_generada'
            WHERE id = ?
        `).run(numeroGuia, urlRastreo, fechaEnvio, fechaEntrega, idEnvio);
    }

    return {
        numeroGuia,
        folioInterno,
        fechaEnvio,
        fechaEntrega,
        fechaEnvioHuman:   _formatDateHuman(fechaEnvioObj),
        fechaEntregaHuman: _formatDateHuman(fechaEntregaObj),
        urlRastreo,
        esSimulada: true,
    };
}

// ── Consultar guía ─────────────────────────────────────────────────────────
function consultarGuia(numeroGuia) {
    return db.prepare(`
        SELECT g.*, p.cliente, p.ciudad_envio
        FROM guias_estafeta g
        JOIN pedidos p ON p.id_pedido = g.id_pedido
        WHERE g.numero_guia = ?
    `).get(numeroGuia);
}

function consultarGuiaPorPedido(idPedido) {
    return db.prepare(
        'SELECT * FROM guias_estafeta WHERE id_pedido = ? ORDER BY id DESC LIMIT 1'
    ).get(idPedido);
}

// Fase 2 (futura): conectar con la API real de Estafeta una vez existan
// credenciales. Hasta entonces, encender estafeta_real_activo solo falla
// alto en vez de generar una guía simulada haciéndola pasar por real.
function _crearGuiaReal(params) {
    throw new Error('estafeta_real_activo está activo pero no hay integración real con Estafeta configurada todavía');
}

// ── Actualizar estatus (para cuando se integre webhook real) ───────────────
function actualizarEstatusGuia(numeroGuia, nuevoEstatus, descripcion = '', ubicacion = '') {
    const guia = db.prepare('SELECT * FROM guias_estafeta WHERE numero_guia = ?').get(numeroGuia);
    if (!guia) return false;

    db.prepare("UPDATE guias_estafeta SET estatus = ? WHERE numero_guia = ?").run(nuevoEstatus, numeroGuia);

    if (guia.id_envio) {
        db.prepare(`
            INSERT INTO estatus_envio_log (id_envio, estatus, descripcion, ubicacion)
            VALUES (?, ?, ?, ?)
        `).run(guia.id_envio, nuevoEstatus, descripcion, ubicacion);
    }
    return true;
}

// ── Exportar ──────────────────────────────────────────────────────────────
module.exports = {
    crearGuia,
    consultarGuia,
    consultarGuiaPorPedido,
    actualizarEstatusGuia,
    calcularFechaEntrega,
    urlRastreoSimulado,
    _formatDateHuman,
    REMITENTE,
};
