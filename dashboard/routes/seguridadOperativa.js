'use strict';
// PIN de autorización (administrador/prime lo configuran) y ZONA DE PELIGRO
// de prime: reset total de la instancia (deja la tienda limpia y reabre el
// onboarding). El respaldo manual también es prime-only.
const autorizacion = require('../autorizacion');

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

module.exports = function seguridadOperativaRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession, log, hashPassword, safeEqual, pm2 } = ctx;

    // GET estado del PIN (¿hay uno configurado?)
    if (p === '/api/autorizacion/pin' && req.method === 'GET') {
        if (!requireSession(req, res)) return;
        return json(res, { configurado: autorizacion.hayPin(db) });
    }
    // PUT: configurar/cambiar el PIN — administrador y prime
    if (p === '/api/autorizacion/pin' && req.method === 'PUT') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                autorizacion.setPin(db, JSON.parse(body || '{}').pin);
                log.info('[seguridad] PIN de autorización actualizado');
                return json(res, { ok: true });
            } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
        });
    }

    // ZONA DE PELIGRO — prime re-valida su contraseña + texto BORRAR.
    // Borra TODO lo operativo, conserva solo usuarios prime y reabre onboarding.
    if (p === '/api/prime/reset-instancia' && req.method === 'POST') {
        const ses = requireSession(req, res, ['prime']);
        if (!ses) return;
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
                        // bypass de los triggers de inmutabilidad (0030) — LOGUEADO
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

    // Respaldo manual — prime-only (administrador NO)
    // Secreto de instancia (para envolver la clave del modo 'bajo').
    const _leerSecreto = () => {
        try { return require('fs').readFileSync(require('path').join(__dirname, '..', '.instancia_secret'), 'utf8').trim(); }
        catch (_) { return 'sin-secreto'; }
    };
    const _cb = require('../../services/cryptoBackup');

    // GET estado del cifrado de respaldos
    if (p === '/api/prime/backup-cifrado' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const modo = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_cifrado_modo'").get()?.valor || 'off';
        const armado = modo !== 'alto' || !!_cb.claveArmada();
        return json(res, { modo, armado });
    }
    // PUT configurar el modo. 'alto': body.master → deriva, guarda SOLO el
    // salt, ARMA la clave y la DEVUELVE una vez (para apuntar). 'bajo': clave
    // aleatoria envuelta con el secreto de instancia en la BD. 'off': limpia.
    if (p === '/api/prime/backup-cifrado' && req.method === 'PUT') {
        const ses = requireSession(req, res, ['prime']);
        if (!ses) return;
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
                    // Se devuelve la clave derivada UNA vez para que el dueño la
                    // apunte/fotografíe. No se guarda en ningún lado.
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
                // off
                set('backup_cifrado_modo', 'off');
                db.prepare("DELETE FROM configuracion WHERE clave IN ('backup_salt','backup_key_wrapped')").run();
                _cb.desarmar();
                return json(res, { ok: true, modo: 'off' });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }
    // POST armar la clave 'alto' tras un reinicio (re-deriva con la maestra).
    if (p === '/api/prime/backup-cifrado/armar' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
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

    if (p === '/api/prime/respaldo-manual' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            const modo = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_cifrado_modo'").get()?.valor || 'off';
            const env = { ...process.env };
            // modo alto: pasar la clave armada al proceso hijo por env (única
            // forma de que backup.js —proceso aparte— la use; nunca a disco)
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

    // POST /api/prime/restaurar-bd — sube un respaldo (base64), lo descifra
    // (auto-detecta gz vs cifrado), valida que sea SQLite, y lo deja en
    // staging para el swap-on-boot (db_connection lo aplica al reiniciar,
    // nunca reemplaza un archivo abierto). NO toca la sesion de WhatsApp.
    // Para respaldos cifrados manda 'clave_hex' (la que apuntaste) — sobrevive
    // aunque la BD actual este destruida.
    if (p === '/api/prime/restaurar-bd' && req.method === 'POST') {
        const sesR = requireSession(req, res, ['prime']);
        if (!sesR) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const yo = db.prepare('SELECT * FROM usuarios WHERE username=?').get(sesR.username);
                if (!yo || hashPassword(String(d.password || ''), yo.salt) !== yo.password_hash) {
                    return json(res, { ok: false, error: 'Contrasena de Prime incorrecta' }, 403);
                }
                // Anti-DoS: tope de 400 MB en el base64 ANTES de decodificar
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
                const SQLITE_HDR = Buffer.from('53514c69746520666f726d6174203300', 'hex'); // "SQLite format 3\0"
                if (!raw.subarray(0, 16).equals(SQLITE_HDR)) {
                    return json(res, { ok: false, error: 'El archivo no es una base de datos SQLite valida' }, 400);
                }
                const DB_PATH = process.env.DB_PATH || require('path').join(__dirname, '..', '..', 'bot', 'jugueteria.db');
                // Validar la integridad real del SQLite antes de dejarlo en staging
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
                require('../../services/configAudit').logCambio(db, 'restauracion_bd', new Date().toISOString(), sesR.username);
                return json(res, { ok: true, msg: 'Respaldo validado (' + (raw.length / 1024 / 1024).toFixed(1) + ' MB). Reinicia el sistema para aplicarlo; el original se guarda como respaldo.', requiere_reinicio: true });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // POST /api/prime/whatsapp/purgar-sesion — borra .wwebjs_auth/.wwebjs_cache
    // (HS-503: sesión corrupta o en conflicto). Prime + contraseña + 'BORRAR'.
    // Desvincula el número: el siguiente arranque pide QR limpio.
    if (p === '/api/prime/whatsapp/purgar-sesion' && req.method === 'POST') {
        const sesW = requireSession(req, res, ['prime']);
        if (!sesW) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                if (d.confirmacion !== 'BORRAR') return json(res, { ok: false, error: "Escribe BORRAR en 'confirmacion'" }, 400);
                const u = db.prepare('SELECT * FROM usuarios WHERE username=?').get(sesW.username);
                if (!u || hashPassword(String(d.password || ''), u.salt) !== u.password_hash) {
                    return json(res, { ok: false, error: 'Contraseña incorrecta' }, 403);
                }
                log.warn('[HS-503] Purga de sesión de WhatsApp solicitada por ' + sesW.username);
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

    return next();
};
