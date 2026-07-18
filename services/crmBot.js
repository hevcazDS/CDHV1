'use strict';
// crmBot — alimentación del pipeline CRM DESDE la conversación del bot (P0 de
// AUDITORIA_BOT_CRM.md). El bot ya tenía las acciones (crm_cambiar_etapa/nota) pero
// inertes (solo por motor de flujo, OFF). Esto las cablea a puntos fijos del código:
//   · primer mensaje de un lead      → 'contactado'
//   · pedido PAGADO (marcar-pagado)  → 'ganado'
//   · carrito abandonado con motivo  → nota + 'perdido'
//   · cotización en el chat          → 'cotizado' (+score)
//
// SOLO DATOS: etapa / nota / lead_score. NUNCA mensajes ni cobros (el dinero sigue
// por marcar-pagado; los masivos por campanaLanzar con gate humano). Idempotente y
// FAIL-SOFT: un error aquí jamás debe tumbar el flujo del cliente. Gated por
// crm_pipeline_activo (default ON — un CRM con chat debe registrar el avance; se
// apaga en Módulos, igual que Contabilidad).

const ETAPAS = ['lead', 'contactado', 'cotizado', 'ganado', 'perdido'];
// Orden de avance del embudo. 'perdido' es terminal lateral (mismo rango que ganado
// pero solo se entra explícito). El bot solo AVANZA; no retrocede ni degrada un ganado.
const RANGO = { lead: 0, contactado: 1, cotizado: 2, ganado: 3, perdido: 3 };

function _activo() {
    try { return require('../bot/flows/_config').moduloActivo('crm_pipeline_activo'); }
    catch (_) { return false; }
}

function _cliente(db, idOrTel) {
    try {
        if (typeof idOrTel === 'number') return db.prepare('SELECT id, etapa FROM clientes WHERE id=?').get(idOrTel);
        const tel = String(idOrTel || '').replace(/@.*$/, '');
        if (!tel) return null;
        return db.prepare('SELECT id, etapa FROM clientes WHERE telefono=?').get(tel);
    } catch (_) { return null; }
}

// Avanza la etapa del cliente solo si REPRESENTA UN AVANCE real (no retrocede, no
// revive/degrada un 'ganado'); 'perdido' requiere permitirPerdido. Devuelve true si
// cambió. Registra en crm_etapas con creado_por='bot'.
function avanzarEtapa(db, idOrTel, etapa, { permitirPerdido = false } = {}) {
    if (!_activo() || !ETAPAS.includes(etapa)) return false;
    const c = _cliente(db, idOrTel);
    if (!c) return false;
    const actual = c.etapa || 'lead';
    if (actual === etapa) return false;
    if (actual === 'ganado') return false;                        // un ganado no lo toca el bot
    if (etapa === 'perdido') { if (!permitirPerdido) return false; }
    else if (RANGO[etapa] <= RANGO[actual]) return false;         // solo hacia adelante
    try {
        db.prepare('UPDATE clientes SET etapa=? WHERE id=?').run(etapa, c.id);
        db.prepare("INSERT INTO crm_etapas (id_cliente, de, a, creado_por) VALUES (?,?,?, 'bot')").run(c.id, c.etapa || null, etapa);
        return true;
    } catch (_) { return false; }
}

function agregarNota(db, idOrTel, texto) {
    if (!_activo()) return false;
    const c = _cliente(db, idOrTel);
    if (!c || !String(texto || '').trim()) return false;
    try { db.prepare("INSERT INTO crm_notas (id_cliente, contenido, creado_por) VALUES (?,?, 'bot')").run(c.id, String(texto).trim().slice(0, 2000)); return true; }
    catch (_) { return false; }
}

// Sube el lead_score en caliente (señal de compra en la charla). El batch nocturno
// de stockWatcher lo normaliza igual; esto solo prioriza HOY al lead caliente.
function subirScore(db, idOrTel, delta) {
    if (!_activo() || !(delta > 0)) return false;
    const c = _cliente(db, idOrTel);
    if (!c) return false;
    try { db.prepare('UPDATE clientes SET lead_score = COALESCE(lead_score,0) + ? WHERE id=?').run(delta, c.id); return true; }
    catch (_) { return false; }
}

module.exports = { avanzarEtapa, agregarNota, subirScore, ETAPAS };
