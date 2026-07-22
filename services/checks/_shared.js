// _shared.js — helpers/estado compartido entre services/checks/*.js
// Extraído de services/stockWatcher.js (refactor sin cambio de comportamiento):
// mismas funciones/constantes, mismo `db`/`log`, solo movidas de sitio.
'use strict';
const db  = require('../../bot/db_connection');
const log = require('../../bot/logger')('stockWatcher');

// Lee flags de módulos del dashboard (tabla configuracion)
function _flagActivo(clave) {
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        if (!r) return clave !== 'puntos_activo';
        return r.valor === '1' || r.valor === 'true';
    } catch(_) { return true; }
}

// Lee un valor de texto de `configuracion` (no flag on/off) -- usado para
// ajustes que prime puede sobreescribir desde el dashboard sin tocar .env,
// como el teléfono del operador (antes solo ASESOR_WHATSAPP).
function _valorConfig(clave, fallback) {
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        return (r && r.valor) ? r.valor : fallback;
    } catch(_) { return fallback; }
}

// Inserta en cola_notificaciones con un tag de `campana` para poder medir
// conversión real por campaña (ver /api/metricas/campanas) — si la columna
// todavía no existe en producción, cae al INSERT sin ella y el envío de
// WhatsApp sigue funcionando igual.
// Solo campañas de marketing respetan el opt-out; transaccionales salen siempre
const _CAMPANAS_MARKETING = new Set([
    'recompra',
    'carrito_abandonado_2h', 'carrito_abandonado_24h',
    'oferta_por_vencer', 'oferta_por_vencer_24h',
    'reactivacion_dormidos',
]);
function _optOutMarketing(tel) {
    try {
        return !!db.prepare('SELECT 1 FROM clientes WHERE telefono=? AND marketing_opt_out=1').get(tel);
    } catch (_) { return false; }
}

// INMUTABLE mientras se use whatsapp-web.js (número personal, no API oficial).
// Rango de separación entre mensajes de un mismo batch automático.
// NO reducir: es lo que evita el ban. Solo se relaja al migrar a Meta Business API.
const _STAGGER_MIN = 60;   // 1 min mínimo
const _STAGGER_MAX = 240;  // 4 min máximo → rango total 1-5 min aleatorio

// offsetSeg > 0 → insertar como 'programado' con enviar_despues_de en el futuro.
// Los mensajes transaccionales 1:1 pasan offsetSeg=0 (o sin él) → 'pendiente' inmediato.
function _insertCola(tel, asunto, cuerpo, campana, offsetSeg) {
    if (_CAMPANAS_MARKETING.has(campana) && _optOutMarketing(tel)) return;
    const cuando = (offsetSeg > 0)
        ? new Date(Date.now() + offsetSeg * 1000).toISOString().replace('T', ' ').slice(0, 19)
        : null;
    try {
        if (cuando) {
            db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,enviar_despues_de,campana) VALUES ('whatsapp',?,?,?,'programado',?,?)`).run(tel, asunto, cuerpo, cuando, campana || null);
        } else {
            db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,campana) VALUES ('whatsapp',?,?,?,'pendiente',?)`).run(tel, asunto, cuerpo, campana || null);
        }
    } catch (_) {
        if (cuando) {
            db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,enviar_despues_de) VALUES ('whatsapp',?,?,?,'programado',?)`).run(tel, asunto, cuerpo, cuando);
        } else {
            db.prepare(`INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,?,?,'pendiente')`).run(tel, asunto, cuerpo);
        }
    }
}

module.exports = {
    db, log,
    _flagActivo, _valorConfig, _insertCola, _optOutMarketing,
    _CAMPANAS_MARKETING, _STAGGER_MIN, _STAGGER_MAX,
};
