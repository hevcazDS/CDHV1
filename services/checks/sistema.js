// sistema.js — Salud del sistema: frescura de backups, purga de imágenes,
// vigilancia del reloj y alerta de CAC.
// Extraído de services/stockWatcher.js (refactor sin cambio de comportamiento).
'use strict';
const fs  = require('fs');
const path = require('path');
const { db, log, _valorConfig, _insertCola } = require('./_shared');

const BACKUP_REGISTRO_PATH = process.env.BACKUP_REGISTRO_PATH || path.join(__dirname, '..', '..', 'scripts', '.backup_registro.json');
const BACKUP_MAX_EDAD_MS   = 36 * 3_600_000; // 36h — el backup de DB corre a las 11:00 todos los días

// El backup de DB (scripts/backup.js) es la única copia fuera del servidor.
// Antes de hoy, si el proceso que lo hospeda no llegaba a las 11:00 (caída,
// reinicio) nadie se enteraba — esto lo detecta y avisa por correo.
// Alerta de eficiencia de adquisición (finanzas P1): si el CAC de los últimos 7
// días sube >20% vs la media de 30 días, avisa al operador — la pauta pierde
// eficiencia antes de que sea pérdida. Requiere gasto de publicidad fechado en
// la cuenta 602 (si no hay, calla). Dedup diario. Ver AUDITORIA_SALUD_NEGOCIO.md §5.
function checkCacIneficiente() {
    const asesorTel = _valorConfig('operador_telefono', process.env.ASESOR_WHATSAPP);
    if (!asesorTel) return 0;
    const mkt = (dias) => {
        try { return db.prepare(`SELECT COALESCE(SUM(dd.debe - dd.haber),0) g FROM asientos a JOIN asientos_detalle dd ON dd.id_asiento=a.id WHERE dd.cuenta='602' AND a.fecha > date('now','localtime','-${dias} days')`).get().g || 0; }
        catch (_) { return 0; }
    };
    const nuevos = (dias) => {
        try { return db.prepare(`SELECT COUNT(*) n FROM clientes WHERE date(creado_en) > date('now','localtime','-${dias} days')`).get().n || 0; }
        catch (_) { return 0; }
    };
    const g7 = mkt(7), n7 = nuevos(7), g30 = mkt(30), n30 = nuevos(30);
    if (!(n7 > 0) || !(g7 > 0) || !(n30 > 0) || !(g30 > 0)) return 0;   // sin datos → callar
    const cac7 = g7 / n7, cac30 = g30 / n30;
    if (cac7 <= cac30 * 1.20) return 0;
    try {
        const ya = db.prepare("SELECT id FROM cola_notificaciones WHERE asunto='Alerta CAC' AND datetime(creada_en) > datetime('now','-23 hours','localtime') LIMIT 1").get();
        if (ya) return 0;
    } catch (_) {}
    const subio = Math.round((cac7 / cac30 - 1) * 100);
    try {
        _insertCola(asesorTel, 'Alerta CAC',
            `⚠️ El costo de adquirir clientes subió ${subio}% esta semana ($${cac7.toFixed(0)} vs $${cac30.toFixed(0)} promedio del mes). Revisa tu pauta/campaña antes de que sea pérdida.`,
            'alerta_cac');
        return 1;
    } catch (e) { log.debug('No se pudo encolar alerta CAC: ' + e.message); return 0; }
}

function checkBackupReciente() {
    let registro;
    try {
        if (!fs.existsSync(BACKUP_REGISTRO_PATH)) { log.warn('Sin registro de backups todavía (.backup_registro.json no existe)'); return; }
        registro = JSON.parse(fs.readFileSync(BACKUP_REGISTRO_PATH, 'utf8'));
    } catch (e) { log.warn('No se pudo leer registro de backups: ' + e.message); return; }

    const ultimo = registro.ultimo_backup_db ? new Date(registro.ultimo_backup_db).getTime() : 0;
    const edadMs = Date.now() - ultimo;
    if (ultimo && edadMs < BACKUP_MAX_EDAD_MS && registro.ultimo_backup_db_ok !== false) return; // todo bien

    const yaAlertadoHoy = db.prepare("SELECT id FROM cola_emails WHERE tipo='alerta_backup' AND date(creada_en)=date('now','localtime') LIMIT 1").get();
    if (yaAlertadoHoy) return;

    const dest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS || process.env.EMAIL_USER;
    if (!dest) { log.error('Backup de DB atrasado/falló y no hay EMAIL_PERSONAL/EMAIL_USER configurado para alertar'); return; }
    log.error('Backup de DB atrasado o falló — último intento: ' + (registro.ultimo_backup_db || 'nunca'));
    try {
        db.prepare("INSERT INTO cola_emails (destinatarios, asunto, html_body, estatus, tipo) VALUES (?, 'Backup de la base de datos atrasado', ?, 'pendiente', 'alerta_backup')")
            .run(JSON.stringify([dest]), '<p>El backup diario de la base de datos no se ha completado en las últimas 36 horas.</p><p>Último intento registrado: ' + (registro.ultimo_backup_db || 'nunca') + '</p>');
    } catch (e) { log.warn('No se pudo encolar alerta de backup: ' + e.message); }
}

// Purga imágenes de clientes viejas, pero SOLO las que ya están confirmadas
// en el registro de backup como enviadas — nunca borra algo que no se sabe
// si ya quedó respaldado fuera del servidor.
const IMG_DIR = path.join(__dirname, '..', '..', 'bot', 'imagenes_clientes');
const IMG_PURGA_EDAD_MS = 30 * 24 * 3_600_000; // 30 días de vida en servidor
function purgarImagenesAntiguas() {
    if (!fs.existsSync(IMG_DIR)) return;
    let registro;
    try { registro = JSON.parse(fs.readFileSync(BACKUP_REGISTRO_PATH, 'utf8')); }
    catch (_) { return; } // sin registro de backup confirmado, no se borra nada
    const yaRespaldadas = new Set(registro.enviados || []);
    const ahora = Date.now();
    let borradas = 0;
    for (const f of fs.readdirSync(IMG_DIR)) {
        if (f.startsWith('.') || !yaRespaldadas.has(f)) continue;
        try {
            const ruta = path.join(IMG_DIR, f);
            if (ahora - fs.statSync(ruta).mtimeMs > IMG_PURGA_EDAD_MS) { fs.unlinkSync(ruta); borradas++; }
        } catch (e) { log.debug('No se pudo purgar ' + f + ': ' + e.message); }
    }
    if (borradas) log.info(`Purgadas ${borradas} imágenes de clientes ya respaldadas (>30 días)`);
}

// ── Vigilancia del reloj del sistema ─────────────────────────────────────
// La app no puede impedir que un admin cambie el reloj del SO, pero SÍ puede
// detectar que retroceda (el vector para evadir el cierre contable / backdatear
// asientos). Guarda el máximo timestamp visto; si el reloj cae >10 min por
// debajo (tolerancia para NTP/DST), lo registra en la bitácora forense y
// alerta a Prime (una vez al día). No baja el máximo, así el retroceso sigue
// marcado hasta que el tiempo real lo alcance.
function checkRelojSistema() {
    const ahora = Date.now();
    const ultimo = parseInt(db.prepare("SELECT valor FROM configuracion WHERE clave='reloj_ultimo_visto'").get()?.valor || '0', 10) || 0;
    if (ultimo && ahora < ultimo - 10 * 60 * 1000) {
        const ya = db.prepare("SELECT id FROM cola_emails WHERE tipo='alerta_reloj' AND date(creada_en)=date('now','localtime') LIMIT 1").get();
        if (!ya) {
            const det = 'de ' + new Date(ultimo).toISOString() + ' a ' + new Date(ahora).toISOString();
            log.error('[reloj] El reloj del sistema RETROCEDIÓ ' + det + ' — posible manipulación de fecha');
            try {
                db.prepare('INSERT INTO configuracion_log (clave, valor_anterior, valor_nuevo, usuario) VALUES (?,?,?,?)')
                  .run('reloj_retrocedido', new Date(ultimo).toISOString(), new Date(ahora).toISOString(), 'sistema');
            } catch (_) {}
            const dest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS || process.env.EMAIL_USER;
            if (dest) {
                try {
                    db.prepare("INSERT INTO cola_emails (destinatarios, asunto, html_body, estatus, tipo) VALUES (?, 'Alerta: el reloj del sistema retrocedió', ?, 'pendiente', 'alerta_reloj')")
                      .run(JSON.stringify([dest]), '<p>El reloj del servidor retrocedió ' + det + '.</p><p>Esto puede indicar una manipulación de la fecha para backdatear operaciones. Verifica el reloj/NTP del servidor.</p>');
                } catch (_) {}
            }
        }
    }
    if (ahora > ultimo) {
        try { db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('reloj_ultimo_visto', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(String(ahora)); } catch (_) {}
    }
    return 0;
}

module.exports = {
    checkCacIneficiente, checkBackupReciente, purgarImagenesAntiguas, checkRelojSistema,
};
