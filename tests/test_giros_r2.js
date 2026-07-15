'use strict';
// tests/test_giros_r2.js — ronda 2 de auditoría de giros: (1) órdenes de
// servicio CRUD, (2) anticipo de cita al confirmar (config-driven), (3) con
// pct=0 el flujo de cita queda byte-idéntico (sin pedido).
//   node tests/test_giros_r2.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
let ok = 0;
const t = (n, fn) => { const r = fn(); if (r && r.then) return r.then(() => { ok++; console.log('✅ ' + n); }); ok++; console.log('✅ ' + n); };

(async () => {
    // ── 1) Órdenes de servicio ──
    await t('orden de servicio: crear + completar con evidencia', () => {
        const { crear, actualizar } = require('../dashboard/routes/ordenesServicio')._test;
        let out = null;
        const ctx = { db, json: (res, d) => { out = d; }, readJson: (req, res, cb) => cb(req._body) };
        crear({ _body: { cliente_nombre: 'Doña Mary', telefono: '5218110000009', descripcion: 'Cambiar 3 breakers', id_empleado: null } }, null, ctx, { ses: { username: 'test' } });
        assert(out.ok && /^OS-/.test(out.folio));
        const id = out.id;
        actualizar({ _body: { estatus: 'completada', trabajo_realizado: 'Se cambiaron 3 breakers y se revisó el centro de carga' } }, null, ctx, { params: [String(id)] });
        const o = db.prepare('SELECT * FROM ordenes_servicio WHERE id=?').get(id);
        assert.strictEqual(o.estatus, 'completada');
        assert(o.cerrado_en, 'completada debe sellar cerrado_en');
        assert(/breakers/.test(o.trabajo_realizado));
    });

    // ── 2) Anticipo al confirmar cita (config-driven) ──
    // citas cada hora, config 50%; el fixture trae 'Corte de cabello' $150.
    for (const [k, v] of [['citas_activo', '1'], ['citas_anticipo_pct', '50'], ['citas_hora_inicio', '10'], ['citas_hora_fin', '19']])
        db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?,?)').run(k, v);
    require('../bot/flows/_config').invalidarCache();

    const citasFlow = require('../bot/flows/citasFlow');
    const sm = require('../bot/sessionManager');
    const S = require('../bot/flows/_shared').S;
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    await t('confirmar cita con 50%: pedido de anticipo + link + saldo en la cita', async () => {
        const U = 'anticipo@c.us';
        sm.updateSession(U, S.CITA_CONFIRMA, {
            cita_servicio: 'Corte de cabello', cita_servicio_id: 4, cita_servicio_precio: 150,
            cita_fecha: manana, cita_hora: '11:00', cita_label: 'Mañana',
        });
        const pedAntes = db.prepare('SELECT COUNT(*) n FROM pedidos').get().n;
        const r = await citasFlow.handle({ userId: U, action: '1', raw: '1', step: S.CITA_CONFIRMA,
            data: sm.getSession(U).data, tel: '5218110000010' });
        assert(/anticipo del 50%/.test(r), 'la confirmación debe traer el anticipo: ' + r.slice(0, 120));
        assert(/\$75\.00/.test(r), '150 × 50% = $75');
        assert(/paypal|http/.test(r), 'debe traer el link de pago');
        assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM pedidos').get().n, pedAntes + 1, 'un pedido de anticipo');
        const cita = db.prepare('SELECT anticipo, saldo_pendiente FROM citas ORDER BY id DESC LIMIT 1').get();
        assert.strictEqual(cita.anticipo, 75);
        assert.strictEqual(cita.saldo_pendiente, 75);
    });

    await t('con pct=0: confirmación SIN anticipo ni pedido (byte-idéntico)', async () => {
        db.prepare("UPDATE configuracion SET valor='0' WHERE clave='citas_anticipo_pct'").run();
        require('../bot/flows/_config').invalidarCache();
        const U = 'sinanticipo@c.us';
        sm.updateSession(U, S.CITA_CONFIRMA, {
            cita_servicio: 'Corte de cabello', cita_servicio_id: 4, cita_servicio_precio: 150,
            cita_fecha: manana, cita_hora: '12:00', cita_label: 'Mañana',
        });
        const pedAntes = db.prepare('SELECT COUNT(*) n FROM pedidos').get().n;
        const r = await citasFlow.handle({ userId: U, action: '1', raw: '1', step: S.CITA_CONFIRMA,
            data: sm.getSession(U).data, tel: '5218110000011' });
        assert(!/anticipo/.test(r), 'sin anticipo en el mensaje');
        assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM pedidos').get().n, pedAntes, 'sin pedido nuevo');
    });

    console.log('\n' + ok + '/3 OK — ronda 2: órdenes de servicio + anticipo configurable.');
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
})().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });
