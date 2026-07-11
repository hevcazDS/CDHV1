'use strict';
// PIN de autorización (administrador/prime lo configuran) y ZONA DE PELIGRO
// de prime: reset total de la instancia, cifrado/respaldo/restauración de BD y
// purga de la sesión de WhatsApp. Migrado al patrón declarativo del tronco:
// pin GET → gate global; pin PUT → gerente; todo lo demás → prime. Las
// operaciones destructivas revalidan la CONTRASEÑA de prime en el handler (más
// fuerte que el PIN), por eso no usan pin:true.
const autorizacion = require('../autorizacion');
const construirModulo = require('./_construirModulo');
const _cb = require('../../services/cryptoBackup');

const TABLAS_RESET = [
    // operación
    'pedido_detalle', 'links_pago', 'guias_estafeta', 'devoluciones', 'pedidos',
    'carritos_abandonados', 'cola_atencion', 'conversaciones', 'mensajes',
    'cola_notificaciones', 'cola_emails', 'valoraciones', 'log_eventos',
    'lista_espera', 'alertas_reabasto', 'preventa_clientes', 'preventas',
    'sesiones_bot', 'chats_iniciados', 'puntos_cliente', 'regalos_lealtad',
    'promociones', 'tickets_venta', 'clientes',
    // catálogo e inventario
    'ubicaciones_inventario', 'inventario_movimientos', 'inventarios',
    'productos_similares', 'productos', 'categorias', 'sucursales',
    // ERP
    'asientos_detalle', 'asientos', 'cuentas_pagar', 'ordenes_compra_detalle',
    'ordenes_compra', 'proveedores', 'historial_costos', 'solicitudes_compra',
    'cortes_caja', 'nominas', 'horarios_empleado', 'empleados',
    'vision_revisiones', 'metodos_pago', 'series_folios', 'contadores_caso',
];

// Secreto de instancia (para envolver la clave del modo 'bajo').
const _leerSecreto = () => {
    try { return require('fs').readFileSync(require('path').join(__dirname, '..', '.instancia_secret'), 'utf8').trim(); }
    catch (_) { return 'sin-secreto'; }
};

// GET /api/autorizacion/pin — ¿hay PIN configurado? (cualquier sesión)
function pinGet(req, res, ctx) {
    return ctx.json(res, { configurado: autorizacion.hayPin(ctx.db) });
}

// PUT /api/autorizacion/pin — configurar/cambiar el PIN (gerente+)
function pinPut(req, res, ctx) {
    const { db, json, readBody, log } = ctx;
    return readBody(req, body => {
        try {
            autorizacion.setPin(db, JSON.parse(body || '{}').pin);
            log.info('[seguridad] PIN de autorización actualizado');
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

// POST /api/prime/reset-instancia — ZONA DE PELIGRO: prime revalida contraseña
// + texto BORRAR. Borra todo lo operativo, conserva usuarios prime.
function resetInstancia(req, res, ctx, { ses }) {
    const { db, json, readBody, log, hashPassword, safeEqual } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            if (String(d.confirmacion || '').toUpperCase() !== 'BORRAR') {
                return json(res, { ok: false, error: 'Escribe BORRAR para confirmar' }, 400);
            }
            const yo = db.prepare('SELECT * FROM usuarios WHERE username=?').get(ses.username);
            if (!yo || !safeEqual(hashPassword(String(d.password || ''), yo.salt), yo.password_hash)) {
                return json(res, { ok: false, error: 'Contraseña incorrecta' }, 401);
            }
            let borradas = 0;
            db.pragma('foreign_keys = OFF');
            try {
                db.transaction(() => {
                    try { require('../../services/configAudit').logCambio(db, 'mantenimiento_bd', '1', ses.username); } catch (_) {}
                    try { db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('mantenimiento_bd','1') ON CONFLICT(clave) DO UPDATE SET valor='1'").run(); } catch (_) {}
                    for (const t of TABLAS_RESET) {
                        try { db.prepare('DELETE FROM ' + t).run(); borradas++; } catch (_) {}
                    }
                    try { db.prepare("DELETE FROM configuracion WHERE clave='mantenimiento_bd'").run(); } catch (_) {}
                    db.prepare("DELETE FROM usuarios WHERE rol != 'prime'").run();
                    db.prepare("DELETE FROM configuracion").run();
                })();
            } finally { db.pragma('foreign_keys = ON'); }
            log.warn('[PELIGRO] Instancia reseteada por ' + ses.username + ' (' + borradas + ' tablas)');
            return json(res, { ok: true, tablas: borradas, msg: 'Instancia limpia. El onboarding se reabrirá para crear la tienda de cero.' });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/prime/backup-cifrado — estado del cifrado de respaldos
function backupCifradoGet(req, res, ctx) {
    const { db, json } = ctx;
    const modo = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_cifrado_modo'").get()?.valor || 'off';
    const armado = modo !== 'alto' || !!_cb.claveArmada();
    return json(res, { modo, armado });
}

// PUT /api/prime/backup-cifrado — configurar el modo (alto/bajo/off)
function backupCifradoPut(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const modo = d.modo;
            const set = (k, v) => db.prepare("INSERT INTO configuracion (clave,valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(k, v);
            require('../../services/configAudit').logCambio(db, 'backup_cifrado_modo', modo, ses.username);
            if (modo === 'alto') {
                if (!d.master || String(d.master).length < 8) return json(res, { ok: false, error: 'La contraseña maestra debe tener al menos 8 caracteres' }, 400);
                const salt = _cb.nuevoSalt();
                const key = _cb.derivar(d.master, salt);
                set('backup_cifrado_modo', 'alto'); set('backup_salt', salt);
                db.prepare("DELETE FROM configuracion WHERE clave='backup_key_wrapped'").run();
                _cb.armar(key);
                return json(res, { ok: true, modo, clave_derivada: key.toString('hex'), aviso: 'Apunta o fotografía esta clave AHORA. No se vuelve a mostrar y no se guarda. Si pierdes la contraseña maestra Y esta clave, los respaldos serán irrecuperables.' });
            }
            if (modo === 'bajo') {
                const key = _cb.nuevaClave();
                set('backup_cifrado_modo', 'bajo');
                set('backup_key_wrapped', _cb.envolverConSecreto(key, _leerSecreto()));
                db.prepare("DELETE FROM configuracion WHERE clave='backup_salt'").run();
                _cb.desarmar();
                return json(res, { ok: true, modo });
            }
            set('backup_cifrado_modo', 'off');
            db.prepare("DELETE FROM configuracion WHERE clave IN ('backup_salt','backup_key_wrapped')").run();
            _cb.desarmar();
            return json(res, { ok: true, modo: 'off' });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/prime/backup-cifrado/armar — re-derivar la clave 'alto' tras reinicio
function backupCifradoArmar(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const salt = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_salt'").get()?.valor;
            if (!salt) return json(res, { ok: false, error: 'El cifrado alto no está configurado' }, 400);
            _cb.armar(_cb.derivar(String(d.master || ''), salt));
            return json(res, { ok: true, armado: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/prime/respaldo-manual — dispara backup.js (proceso aparte)
function respaldoManual(req, res, ctx) {
    const { db, json, log } = ctx;
    try {
        const modo = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_cifrado_modo'").get()?.valor || 'off';
        const env = { ...process.env };
        if (modo === 'alto') {
            const k = _cb.claveArmada();
            if (!k) return json(res, { ok: false, error: 'El cifrado alto no está armado — ingresa la contraseña maestra primero' }, 400);
            env.BACKUP_KEY_HEX = k.toString('hex');
        }
        require('child_process').execFile(process.execPath, [require('path').join(__dirname, '..', '..', 'scripts', 'backup.js'), 'db'], { timeout: 120000, env },
            (err) => log[err ? 'warn' : 'info']('[respaldo manual] ' + (err ? err.message : 'enviado')));
        return json(res, { ok: true, msg: 'Respaldo en proceso' + (modo !== 'off' ? ' (cifrado)' : '') + ' — llegará al correo configurado' });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// POST /api/prime/restaurar-bd — sube respaldo (base64), descifra/valida SQLite
// y lo deja en staging para el swap-on-boot. Revalida contraseña de prime.
function restaurarBd(req, res, ctx, { ses }) {
    const { db, json, readBody, hashPassword } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const yo = db.prepare('SELECT * FROM usuarios WHERE username=?').get(ses.username);
            if (!yo || hashPassword(String(d.password || ''), yo.salt) !== yo.password_hash) {
                return json(res, { ok: false, error: 'Contrasena de Prime incorrecta' }, 403);
            }
            const _b64 = String(d.archivo_base64 || '');
            if (_b64.length > 400 * 1024 * 1024) return json(res, { ok: false, error: 'Archivo demasiado grande (>300 MB de BD)' }, 413);
            let blob = Buffer.from(_b64, 'base64');
            if (blob.length < 32) return json(res, { ok: false, error: 'Archivo vacio o invalido' }, 400);
            const zlib = require('zlib');
            let gz;
            if (blob[0] === 0x1f && blob[1] === 0x8b) {
                gz = blob;
            } else {
                let key = null;
                if (d.clave_hex) key = Buffer.from(String(d.clave_hex), 'hex');
                else {
                    const salt = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_salt'").get()?.valor;
                    const wrapped = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_key_wrapped'").get()?.valor;
                    if (d.master && salt) key = _cb.derivar(String(d.master), salt);
                    else if (wrapped) key = _cb.desenvolverConSecreto(wrapped, _leerSecreto());
                }
                if (!key) return json(res, { ok: false, error: 'Respaldo cifrado: manda clave_hex (la que apuntaste) o la contrasena maestra' }, 400);
                try { gz = _cb.descifrar(blob, key); }
                catch (_) { return json(res, { ok: false, error: 'No se pudo descifrar: clave incorrecta o archivo danado' }, 400); }
            }
            const raw = zlib.gunzipSync(gz);
            const SQLITE_HDR = Buffer.from('53514c69746520666f726d6174203300', 'hex');
            if (!raw.subarray(0, 16).equals(SQLITE_HDR)) {
                return json(res, { ok: false, error: 'El archivo no es una base de datos SQLite valida' }, 400);
            }
            const DB_PATH = process.env.DB_PATH || require('path').join(__dirname, '..', '..', 'bot', 'jugueteria.db');
            const _tmp = DB_PATH + '.verify';
            require('fs').writeFileSync(_tmp, raw);
            try {
                const Database = require('better-sqlite3');
                const vdb = new Database(_tmp, { readonly: true });
                const ok = vdb.prepare('PRAGMA integrity_check').get();
                vdb.close();
                if (!ok || String(Object.values(ok)[0]).toLowerCase() !== 'ok') {
                    require('fs').unlinkSync(_tmp);
                    return json(res, { ok: false, error: 'La base de datos está corrupta (integrity_check falló)' }, 400);
                }
            } catch (ve) {
                try { require('fs').unlinkSync(_tmp); } catch (_) {}
                return json(res, { ok: false, error: 'No es una base de datos SQLite abrible: ' + ve.message }, 400);
            }
            require('fs').renameSync(_tmp, DB_PATH + '.restore');
            require('../../services/configAudit').logCambio(db, 'restauracion_bd', new Date().toISOString(), ses.username);
            return json(res, { ok: true, msg: 'Respaldo validado (' + (raw.length / 1024 / 1024).toFixed(1) + ' MB). Reinicia el sistema para aplicarlo; el original se guarda como respaldo.', requiere_reinicio: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/prime/whatsapp/purgar-sesion — borra .wwebjs_auth/.wwebjs_cache
// (HS-503). Prime + contraseña + 'BORRAR'. Desvincula el número.
function purgarSesion(req, res, ctx, { ses }) {
    const { db, json, readBody, log, hashPassword, pm2 } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            if (d.confirmacion !== 'BORRAR') return json(res, { ok: false, error: "Escribe BORRAR en 'confirmacion'" }, 400);
            const yo = db.prepare('SELECT * FROM usuarios WHERE username=?').get(ses.username);
            if (!yo || hashPassword(String(d.password || ''), yo.salt) !== yo.password_hash) {
                return json(res, { ok: false, error: 'Contraseña incorrecta' }, 403);
            }
            log.warn('[HS-503] Purga de sesión de WhatsApp solicitada por ' + ses.username);
            pm2(['stop', 'bot-whatsapp'], () => {
                const fs = require('fs');
                const path = require('path');
                let borrados = [];
                for (const dir of ['.wwebjs_auth', '.wwebjs_cache']) {
                    const ruta = path.join(__dirname, '..', '..', dir);
                    try {
                        if (fs.existsSync(ruta)) { fs.rmSync(ruta, { recursive: true, force: true }); borrados.push(dir); }
                    } catch (e) { log.error('[HS-503] No se pudo borrar ' + dir + ': ' + e.message); }
                }
                try { db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('bot_estado_deseado','0') ON CONFLICT(clave) DO UPDATE SET valor='0'").run(); } catch (_) {}
                try { db.prepare("DELETE FROM configuracion WHERE clave='whatsapp_qr'").run(); } catch (_) {}
                return json(res, { ok: true, borrados, nota: 'Sesión purgada. Enciende el bot y escanea el QR limpio.' });
            });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/autorizacion/pin',              handler: pinGet },
    { metodo: 'PUT',  path: '/api/autorizacion/pin',              roles: ['gerente'], handler: pinPut },
    { metodo: 'POST', path: '/api/prime/reset-instancia',         roles: ['prime'], handler: resetInstancia },
    { metodo: 'GET',  path: '/api/prime/backup-cifrado',          roles: ['prime'], handler: backupCifradoGet },
    { metodo: 'PUT',  path: '/api/prime/backup-cifrado',          roles: ['prime'], handler: backupCifradoPut },
    { metodo: 'POST', path: '/api/prime/backup-cifrado/armar',    roles: ['prime'], handler: backupCifradoArmar },
    { metodo: 'POST', path: '/api/prime/respaldo-manual',         roles: ['prime'], handler: respaldoManual },
    { metodo: 'POST', path: '/api/prime/restaurar-bd',            roles: ['prime'], handler: restaurarBd },
    { metodo: 'POST', path: '/api/prime/whatsapp/purgar-sesion',  roles: ['prime'], handler: purgarSesion },
];

module.exports = construirModulo(RUTAS);
