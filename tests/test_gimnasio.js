'use strict';
// tests/test_gimnasio.js — preset del giro GIMNASIO (reusa citas+suscripción+pos,
// sin motor nuevo). Ancla el cableado para que un refactor no lo tire.
//   node tests/test_gimnasio.js
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';
const assert = require('assert');
const g = require('../bot/flows/_giros');
const md = require('../bot/flows/modulosDefaults');
const gf = require('../bot/flows/giroFlows');
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

t('vocab del gimnasio: clase/clases/💪', () => {
    const v = g.getGiro('gimnasio').vocab;
    assert.deepStrictEqual({ item: v.item, items: v.items, emoji: v.emoji }, { item: 'clase', items: 'clases', emoji: '💪' });
});

t('menú de servicio (ofrece citas/reservar clase, sin wizard de regalo)', () => {
    const menu = g.menuDeGiro('gimnasio');
    assert(menu.includes('citas') && !menu.includes('wizard'));
});

t('módulos por giro: membresía (suscripción) + clases (citas) + suplementos (pos)', () => {
    const m = md.MODULOS_POR_GIRO.gimnasio;
    assert(m.includes('suscripcion_activo') && m.includes('citas_activo') && m.includes('pos_activo'));
});

t('flujos del giro incluyen el de citas (reservar/gestionar clase)', () => {
    const steps = gf.flowsDeGiro('gimnasio').flatMap(f => f.STEPS || []);
    assert(steps.includes('CITA_SERVICIO') && steps.includes('CITA_GESTION'));
});

t('el giro aparece en el catálogo de giros (onboarding lo listará)', () => {
    assert(g.getGiro('gimnasio').label.includes('Gimnasio'));
});

console.log('\n' + ok + '/5 OK — preset gimnasio (citas + suscripción + pos, cero motor nuevo).');
process.exit(ok === 5 ? 0 : 1);
